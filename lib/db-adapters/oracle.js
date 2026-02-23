const oracledb = require('oracledb');

class OracleAdapter {
    constructor() {
        this.connection = null;
    }

    async connect(config) {
        this.connection = await oracledb.getConnection({
            user: config.user,
            password: config.password,
            connectString: `${config.host}:${config.port}/${config.service}`
        });
        console.log(`[newman-db] Oracle connected: ${config.host}/${config.service}`);
    }

    async execute(query, params = {}) {
        if (!this.connection) throw new Error('[newman-db] No DB connection');
        const result = await this.connection.execute(query, params, {
            outFormat: oracledb.OUT_FORMAT_OBJECT
        });
        return result.rows;
    }

    async disconnect() {
        if (this.connection) {
            await this.connection.close();
            this.connection = null;
            console.log('[newman-db] Oracle disconnected');
        }
    }
}

module.exports = OracleAdapter;
