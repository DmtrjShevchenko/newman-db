const newman = require('newman');
const http = require('http');
const { Readable } = require('stream');
const EventEmitter = require('events');
const DbRunner = require('./db-adapters/db-runner');
const fs = require('fs');
const path = require('path');

const DB_INTERCEPT_HOST = 'newman-db';

async function run(options) {
    const { ...newmanOptions } = options;

    const envEntries = parseEnvFile(options.environment);
    const hasDbSupport = Object.values(envEntries).some(e => e.type);

    const dbRunners = new Map();
    const variables = {};

    let uninstallInterceptor = null;
    if (hasDbSupport) {
        uninstallInterceptor = installDbInterceptor(dbRunners, envEntries, variables);
    }

    return new Promise((resolve, reject) => {
        const emitter = newman.run(newmanOptions);

        emitter.on('request', (err, args) => {
            if (err) return;
            try {
                const body = JSON.parse(args.response.stream.toString());
                flatten(body, 'response', variables);
            } catch (e) {}
        });

        emitter.on('beforeRequest', (err, args) => {
            if (!hasDbSupport || err) return;
            const url = args.request.url.toString();
            if (!url.startsWith('db://')) return;

            const dbName = url.slice('db://'.length).split('/')[0];
            args.request.url.update(`http://${DB_INTERCEPT_HOST}/${dbName}/__db__`);
        });

        emitter.on('done', async (err, summary) => {
            if (uninstallInterceptor) uninstallInterceptor();
            for (const runner of dbRunners.values()) {
                await runner.disconnect();
            }
            if (err) return reject(err);
            resolve(summary);
        });
    });
}

function parseEnvFile(envPath) {
    if (!envPath) return {};
    try {
        const data = JSON.parse(fs.readFileSync(path.resolve(envPath), 'utf8'));
        const result = {};
        for (const item of (data.values || [])) {
            if (item.enabled !== false && item.key) {
                result[item.key] = item;
            }
        }
        return result;
    } catch (e) {
        return {};
    }
}

async function getOrCreateRunner(dbName, envEntries, dbRunners) {
    if (dbRunners.has(dbName)) return dbRunners.get(dbName);

    const entry = envEntries[dbName];
    if (!entry || !entry.type) {
        throw new Error(
            `[newman-db] No DB config for "${dbName}". Add entry to env file: { "key": "${dbName}", "type": "oracle", "user": "...", ... }`
        );
    }

    const config = {
        type:     entry.type,
        user:     entry.user,
        password: entry.password,
        host:     entry.host,
        port:     entry.port,
        service:  entry.service,
    };

    const runner = new DbRunner(config);
    await runner.connect();
    dbRunners.set(dbName, runner);
    return runner;
}

function installDbInterceptor(dbRunners, envEntries, variables) {
    const originalRequest = http.request.bind(http);

    http.request = function (options, callback) {
        const hostname = typeof options === 'string'
            ? new URL(options).hostname
            : (options.hostname || (options.host || '').replace(/:\d+$/, ''));

        if (hostname !== DB_INTERCEPT_HOST) {
            return originalRequest(options, callback);
        }

        const urlPath = typeof options === 'string'
            ? new URL(options).pathname
            : (options.path || '/');
        const dbName = urlPath.split('/')[1];

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
                let sql = rawBody.trim();
                if (sql.startsWith('{') && sql.endsWith('}')) {
                    sql = sql.slice(1, -1).trim();
                }
                requestBody = { query: sql, params: {} };
            }

            getOrCreateRunner(dbName, envEntries, dbRunners)
                .then(runner => runner.execute(requestBody, variables))
                .then(rows => emitFakeResponse(fakeReq, 200, 'OK', { data: rows, fetchStatus: 'COMPLETE' }))
                .catch(err => {
                    console.error(`[newman-db] DB error: ${err.message}`);
                    emitFakeResponse(fakeReq, 500, 'Internal Server Error', { error: err.message });
                });
        };

        fakeReq.setTimeout  = () => fakeReq;
        fakeReq.setHeader   = () => fakeReq;
        fakeReq.getHeader   = () => undefined;
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
    fakeRes.rawHeaders = Object.entries(fakeRes.headers).flat();
    fakeRes.trailers = {};

    fakeReq.emit('response', fakeRes);
    fakeRes.push(json);
    fakeRes.push(null);
}

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
