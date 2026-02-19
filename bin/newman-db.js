#!/usr/bin/env node
const { program } = require('commander');
const { run } = require('../lib');

program
    .name('newman-db')
    .description('Newman with Oracle DB verification support')
    .version('1.0.0');

program
    .command('run <collection>')
    .description('Run a Postman collection with optional DB checks')
    .option('-e, --environment <path>', 'Postman environment file')
    .option('--db-config <path>', 'DB config JSON file')
    .option('--reporters <list>', 'Reporters to use', 'cli')
    .option('--reporter-htmlextra-export <path>', 'HTML report output path')
    .action(async (collection, options) => {
        try {
            await run({
                collection,
                environment: options.environment,
                dbConfig: options.dbConfig,
                reporters: options.reporters.split(','),
                reporter: {
                    htmlextra: {
                        export: options.reporterHtmlextraExport
                    }
                }
            });
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

program.parse();