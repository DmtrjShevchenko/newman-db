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
    .option('--reporters <list>', 'Reporters to use', 'cli')
    .option('--reporter-htmlextra-export <path>', 'HTML report output path')
    .option('--insecure', 'Disable SSL certificate verification')
    .option('--timeout-request <ms>', 'Request timeout in milliseconds', parseInt)
    .action(async (collection, options) => {
        try {
            await run({
                collection,
                environment: options.environment,
                insecure: options.insecure || false,
                reporters: options.reporters.split(','),
                reporter: {
                    htmlextra: {
                        export: options.reporterHtmlextraExport
                    }
                },
                ...(options.timeoutRequest && { timeout: { request: options.timeoutRequest } })
            });
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

program.parse();
