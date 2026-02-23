const getAdapter = require('.');

class DbRunner {
    constructor(dbConfig) {
        this.config = dbConfig;
        this.adapter = getAdapter(dbConfig.type);
    }

    async connect() {
        await this.adapter.connect(this.config);
    }

    async disconnect() {
        await this.adapter.disconnect();
    }

    interpolate(value, variables) {
        return String(value).replace(/\{\{(.+?)\}\}/g, (_, key) => {
            const val = variables[key.trim()];
            if (val === undefined) console.warn(`[newman-db] Variable {{${key.trim()}}} not found`);
            return val ?? '';
        });
    }

    coerce(val) {
        if (val === '' || val === null || val === undefined) return null;
        const n = Number(val);
        return Number.isFinite(n) ? n : val;
    }

    resolveParams(params, variables) {
        const resolved = {};
        for (const [key, val] of Object.entries(params)) {
            resolved[key] = this.coerce(this.interpolate(val, variables));
        }
        return resolved;
    }

    async execute(body, variables) {
        const { query, params = {} } = body;
        if (!query) throw new Error('[newman-db] Request body must contain "query" field');

        const resolvedParams = this.resolveParams(params, variables);

        console.log(`[newman-db] SQL: ${query}`);
        if (Object.keys(resolvedParams).length > 0) {
            console.log(`[newman-db] Params: ${JSON.stringify(resolvedParams)}`);
        }

        return await this.adapter.execute(query, resolvedParams);
    }
}

module.exports = DbRunner;
