const OracleAdapter = require('./oracle');

const adapterClasses = {
    oracle: OracleAdapter,
};

module.exports = (type) => {
    const AdapterClass = adapterClasses[type];
    if (!AdapterClass) {
        throw new Error(
            `[newman-db] Unknown DB type: "${type}". Available: ${Object.keys(adapterClasses).join(', ')}`
        );
    }
    return new AdapterClass();
};
