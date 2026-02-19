const adapters = {
    oracle: require('./oracle'),
    // postgres: require('./postgres'),  // потом
};

module.exports = (type) => {
    if (!adapters[type]) {
        throw new Error(
            `[newman-db] Unknown DB type: "${type}". Available: ${Object.keys(adapters).join(', ')}`
        );
    }
    return adapters[type];
};