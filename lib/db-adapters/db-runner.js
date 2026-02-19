const getAdapter = require('./db-adapters');

class DbRunner {
    constructor(dbConfig) {
        this.config = dbConfig;
        this.adapter = getAdapter(dbConfig.type);
        this.lastResponse = {};  // храним переменные из предыдущих ответов
    }

    async connect() {
        await this.adapter.connect(this.config);
    }

    async disconnect() {
        await this.adapter.disconnect();
    }

    isDbRequest(url) {
        return url && url.toString().startsWith('db://');
    }

    // Подставляем {{переменные}} в SQL запрос
    interpolate(query, variables) {
        return query.replace(/\{\{(.+?)\}\}/g, (_, key) => {
            const val = variables[key.trim()];
            if (val === undefined) console.warn(`[newman-db] Variable {{${key.trim()}}} not found`);
            return val || '';
        });
    }

    async execute(url, variables) {
        const query = this.interpolate(
            url.toString().replace('db://', ''),
            variables
        );
        console.log(`[newman-db] SQL: ${query}`);
        const rows = await this.adapter.execute(query);
        return rows;
    }
}

module.exports = DbRunner;