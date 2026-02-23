const oracledb = require('oracledb');

let connection = null;

module.exports = {
    connect: async (config) => {
        connection = await oracledb.getConnection({
            user: config.user,
            password: config.password,
            connectString: `${config.host}:${config.port}/${config.service}`
        });
        console.log('[newman-db] Oracle connected');
    },

    execute: async (query, params = {}) => {
        if (!connection) throw new Error('[newman-db] No DB connection');
        const result = await connection.execute(query, params, {
            outFormat: oracledb.OUT_FORMAT_OBJECT
        });
        return result.rows;
    },

    disconnect: async () => {
        if (connection) {
            await connection.close();
            console.log('[newman-db] Oracle disconnected');
        }
    }
};