const newman = require('newman');
const DbRunner = require('./db-runner');
const fs = require('fs');
const path = require('path');

async function run(options) {
    const { dbConfig, ...newmanOptions } = options;

    let dbRunner = null;

    // Если передан dbConfig — инициализируем DB
    if (dbConfig) {
        const config = typeof dbConfig === 'string'
            ? JSON.parse(fs.readFileSync(path.resolve(dbConfig), 'utf8'))
            : dbConfig;

        dbRunner = new DbRunner(config);
        await dbRunner.connect();
    }

    return new Promise((resolve, reject) => {
        const emitter = newman.run(newmanOptions);

        // Копим переменные окружения для подстановки в SQL
        const variables = {};

        // После каждого обычного запроса — сохраняем response переменные
        emitter.on('request', (err, args) => {
            if (err) return;
            try {
                const body = JSON.parse(args.response.stream.toString());
                // Плоско раскладываем response.поле → переменная
                flatten(body, 'response', variables);
            } catch (e) {
                // response не JSON — ничего страшного
            }
        });

        // Перехватываем db:// запросы
        emitter.on('beforeRequest', async (err, args) => {
            if (!dbRunner || err) return;

            const url = args.request.url.toString();
            if (!dbRunner.isDbRequest(url)) return;

            try {
                // Мёрджим переменные окружения Newman + наши response переменные
                const envVars = {};
                args.cursor.ref.environment.values.each(v => envVars[v.key] = v.value);
                Object.assign(envVars, variables);

                const rows = await dbRunner.execute(url, envVars);

                // Подменяем request на фейковый чтобы Newman не лез в сеть
                args.request.url = 'http://localhost/__db__';

                // Инжектим результат как будто это HTTP ответ
                args.response = {
                    code: 200,
                    status: 'OK',
                    stream: Buffer.from(JSON.stringify(rows)),
                    headers: {}
                };
            } catch (e) {
                console.error(`[newman-db] DB error: ${e.message}`);
            }
        });

        emitter.on('done', async (err, summary) => {
            if (dbRunner) await dbRunner.disconnect();
            if (err) return reject(err);
            resolve(summary);
        });
    });
}

// Вспомогательная функция: { id: 1, status: 'NEW' } → { 'response.id': 1, 'response.status': 'NEW' }
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