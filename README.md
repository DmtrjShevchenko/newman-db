# newman-db

A CLI wrapper around [Newman](https://github.com/postmanlabs/newman) that adds Oracle Database query support to Postman collection runs.

Use `db://` URLs in Postman requests to execute SQL and verify database state alongside your API tests — no separate test framework needed.

## Installation

```bash
npm install -g newman-db
```

Or as a project dependency:

```bash
npm install newman-db
```

For HTML reports (optional):

```bash
npm install newman-reporter-htmlextra
```

## Quick start

```bash
newman-db run ./collection.json -e ./environment.json
```

## Configuration

DB credentials live directly in the Postman environment file — no separate config file needed.

Add one entry per database to the `values` array:

```json
{
  "_postman_variable_scope": "environment",
  "values": [
    {
      "key": "MY_DB",
      "type": "oracle",
      "user": "DB_USER",
      "password": "DB_PASSWORD",
      "host": "db-host.example.com",
      "port": 1521,
      "service": "SERVICE_NAME"
    }
  ]
}
```

> Keep your environment file in `.gitignore` — never commit real credentials.
> See `colletions/default_env.example.json` for a template.

### DB entry fields

| Field      | Description                                   |
|------------|-----------------------------------------------|
| `key`      | Identifier used in `db://` URLs               |
| `type`     | Database type — currently only `oracle`       |
| `user`     | Database username                             |
| `password` | Database password                             |
| `host`     | Database host                                 |
| `port`     | Database port (Oracle default: `1521`)        |
| `service`  | Oracle service name (Easy Connect format)     |

Multiple databases can coexist in the same environment file. Each connection is established lazily on first use.

## Writing DB requests

| Field    | Value                                           |
|----------|-------------------------------------------------|
| Method   | `POST` (method is ignored)                      |
| URL      | `db://<key>` — matches the `key` in env file   |
| Body     | raw JSON                                        |

### JSON format with bind variables (recommended)

```json
{
  "query": "SELECT id, status FROM orders WHERE id = :orderId",
  "params": {
    "orderId": "{{response.id}}"
  }
}
```

Bind variables (`:name` syntax) are passed directly to the Oracle driver — safe from SQL injection.

### Raw SQL format

You can also send a plain SQL query wrapped in `{ }`:

```
{
  SELECT id, status FROM orders WHERE id = {{response.id}}
}
```

The `{ }` wrapper is stripped automatically. This format uses Postman's native `{{variable}}` substitution in the body before the request is sent.

## Response format

DB requests return a JSON object:

```json
{
  "data": [
    { "ID": 42, "STATUS": "PENDING" }
  ],
  "fetchStatus": "COMPLETE"
}
```

Column names are returned in the case used by Oracle (typically uppercase).

### Accessing results in test scripts

```javascript
const json = pm.response.json();

pm.test('fetchStatus is COMPLETE', () => {
    pm.expect(json.fetchStatus).to.eql('COMPLETE');
});

pm.test('status is PENDING', () => {
    pm.expect(json.data[0].STATUS).to.eql('PENDING');
});
```

## Variable interpolation

`{{...}}` placeholders in `params` values are resolved from two sources:

| Source                 | Syntax                | Example                  |
|------------------------|-----------------------|--------------------------|
| Postman environment    | `{{VAR_NAME}}`        | `{{BASE_URL}}`           |
| Previous HTTP response | `{{response.field}}`  | `{{response.id}}`        |

After each HTTP response, all fields are automatically extracted and available as `response.<field>`. Nested objects are flattened with dot notation:

```
Response body: { "order": { "id": 42 } }
Variable:      {{response.order.id}}  →  42
```

String values that look like numbers are coerced to numeric type before being passed as Oracle bind variables.

## Multi-DB support

Each `db://` request can target a different database:

```
db://MY_DB_1   →  connects using the "MY_DB_1" entry in env file
db://MY_DB_2   →  connects using the "MY_DB_2" entry in env file
```

## CLI reference

```bash
newman-db run <collection> [options]
```

| Option                               | Description                                  |
|--------------------------------------|----------------------------------------------|
| `-e, --environment <path>`           | Postman environment file (with DB configs)   |
| `--reporters <list>`                 | Comma-separated reporters (default: `cli`)   |
| `--reporter-htmlextra-export <path>` | Output path for HTML report                  |
| `--insecure`                         | Disable SSL certificate verification         |
| `--timeout-request <ms>`             | Request timeout in milliseconds              |

### Examples

```bash
# Run with environment and DB support
newman-db run collection.json -e environment.json

# Run with HTML report
newman-db run collection.json -e environment.json \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export ./report.html

# Run without SSL verification
newman-db run collection.json -e environment.json --insecure
```

## Project structure

```
newman-db/
├── bin/
│   └── newman-db.js          CLI entry point
├── lib/
│   ├── index.js              Newman runner + DB intercept
│   └── db-adapters/
│       ├── index.js          Adapter factory
│       ├── oracle.js         Oracle adapter (oracledb)
│       └── db-runner.js      SQL execution and variable interpolation
└── package.json
```

## Requirements

- Node.js >= 16
- Oracle Instant Client (required by `oracledb`) — see [node-oracledb installation](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html)

## License

MIT
