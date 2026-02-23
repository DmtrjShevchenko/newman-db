const newman = require('newman');
const http = require('http');
const { Readable } = require('stream');
const EventEmitter = require('events');
const DbRunner = require('./db-adapters/db-runner');
const fs = require('fs');
const path = require('path');

// Фиктивный hostname — перехватчик ловит его до DNS и любого соединения
const DB_INTERCEPT_HOST = 'newman-db';

async function run(options) {
    const { dbConfig, ...newmanOptions } = options;

    let dbRunner = null;
    let uninstallInterceptor = null;

    if (dbConfig) {
        const config = typeof dbConfig === 'string'
            ? JSON.parse(fs.readFileSync(path.resolve(dbConfig), 'utf8'))
            : dbConfig;

        dbRunner = new DbRunner(config);
        await dbRunner.connect();
    }

    // Накапливаем response.* переменные для подстановки в SQL params
    const variables = {};

    if (dbRunner) {
        // Перехватываем http.request на уровне Node.js.
        // Никакого сервера — просто подмена функции в памяти процесса.
        uninstallInterceptor = installDbInterceptor(dbRunner, variables);
    }

    return new Promise((resolve, reject) => {
        const emitter = newman.run(newmanOptions);

        // После каждого HTTP ответа сохраняем поля как response.* переменные
        emitter.on('request', (err, args) => {
            if (err) return;
            try {
                const body = JSON.parse(args.response.stream.toString());
                flatten(body, 'response', variables);
            } catch (e) {
                // не JSON — пропускаем
            }
        });

        // Синхронно меняем db:// → http://newman-db/__db__
        // Всё остальное делает перехватчик http.request
        emitter.on('beforeRequest', (err, args) => {
            if (!dbRunner || err) return;
            const url = args.request.url.toString();
            if (!url.startsWith('db://')) return;

            // Must call .update() to keep request.url as a postman-collection Url instance.
            // Direct assignment (request.url = string) breaks requester.js line 430 which
            // calls request.url.update() and request.url.getHost() — methods that don't
            // exist on a plain string, causing a silent TypeError that aborts the request.
            args.request.url.update(`http://${DB_INTERCEPT_HOST}/__db__`);
        });

        emitter.on('done', async (err, summary) => {
            if (uninstallInterceptor) uninstallInterceptor();
            if (dbRunner) await dbRunner.disconnect();
            if (err) return reject(err);
            resolve(summary);
        });
    });
}

/**
 * Патчим http.request в памяти процесса.
 * Запросы к DB_INTERCEPT_HOST перехватываются — SQL выполняется через oracledb.
 * Все остальные запросы идут через оригинальный http.request без изменений.
 */
function installDbInterceptor(dbRunner, variables) {
    const originalRequest = http.request.bind(http);

    http.request = function (options, callback) {
        const hostname = typeof options === 'string'
            ? new URL(options).hostname
            : (options.hostname || (options.host || '').replace(/:\d+$/, ''));

        if (hostname !== DB_INTERCEPT_HOST) {
            return originalRequest(options, callback);
        }

        // Создаём поддельный ClientRequest
        const chunks = [];
        const fakeReq = new EventEmitter();

        if (callback) {
            fakeReq.once('response', callback);
        }

        fakeReq.write = (chunk) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return true;
        };

        fakeReq.end = (chunk) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

            const rawBody = Buffer.concat(chunks).toString('utf8');

            let requestBody;
            try {
                requestBody = JSON.parse(rawBody);
            } catch (e) {
                // Fallback: raw SQL, возможно обёрнут в {} из Postman
                let sql = rawBody.trim();
                if (sql.startsWith('{') && sql.endsWith('}')) {
                    sql = sql.slice(1, -1).trim();
                }
                requestBody = { query: sql, params: {} };
            }

            dbRunner.execute(requestBody, variables)
                .then(rows => emitFakeResponse(fakeReq, 200, 'OK', { data: rows, fetchStatus: 'COMPLETE' }))
                .catch(err => {
                    console.error(`[newman-db] DB error: ${err.message}`);
                    emitFakeResponse(fakeReq, 500, 'Internal Server Error', { error: err.message });
                });
        };

        // Методы-заглушки которые вызывает postman-request
        fakeReq.setTimeout = () => fakeReq;
        fakeReq.setHeader  = () => fakeReq;
        fakeReq.getHeader  = () => undefined;
        fakeReq.removeHeader = () => fakeReq;
        fakeReq.abort   = () => {};
        fakeReq.destroy = () => {};
        fakeReq.socket  = { remoteAddress: '127.0.0.1', encrypted: false };

        return fakeReq;
    };

    return function uninstall() {
        http.request = originalRequest;
    };
}

function emitFakeResponse(fakeReq, statusCode, statusMessage, data) {
    const json = JSON.stringify(data);
    const fakeRes = new Readable({ read() {} });
    fakeRes.statusCode    = statusCode;
    fakeRes.statusMessage = statusMessage;
    fakeRes.httpVersion   = '1.1';
    fakeRes.headers       = {
        'content-type':   'application/json',
        'content-length': String(Buffer.byteLength(json))
    };
    // postman-request's onRequestResponse calls parseResponseHeaders(response.rawHeaders)
    // which expects a flat array: ['header-name', 'value', ...]
    fakeRes.rawHeaders = Object.entries(fakeRes.headers).flat();
    fakeRes.trailers = {};

    fakeReq.emit('response', fakeRes);
    fakeRes.push(json);
    fakeRes.push(null); // конец потока
}

// { id: 1, status: 'NEW' } → { 'response.id': 1, 'response.status': 'NEW' }
function flatten(obj, prefix, result = {}) {
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        const newKey = `${prefix}.${key}`;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            flatten(val, newKey, result);
        } else {
            result[newKey] = val;
        }
    }
    return result;
}

module.exports = { run };
