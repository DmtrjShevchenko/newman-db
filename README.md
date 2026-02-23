# newman-db

A CLI wrapper around [Newman](https://github.com/postmanlabs/newman) that adds Oracle Database query support to Postman collection runs. Use `db://` URLs in your Postman requests to execute SQL queries and verify database state alongside your API tests.

## How it works

1. You run a Postman collection via `newman-db run`
2. After each HTTP response, the tool extracts response fields into variables (`response.id`, `response.status`, etc.)
3. Requests with a `db://` URL are intercepted — the SQL query is read from the request **body**
4. `{{variables}}` in `params` values are resolved from the Postman environment and previous responses
5. The query is executed using **bind variables** — safe from SQL injection
6. Query results are injected back as a JSON response, readable in Postman test scripts

## Installation

```bash
npm install
```

For HTML reports also install the optional reporter:

```bash
npm install newman-reporter-htmlextra
```

## Configuration

Copy `db-config.example.json` to `db-config.json` and fill in your credentials:

```json
{
  "type": "oracle",
  "user": "YOUR_DB_USER",
  "password": "YOUR_DB_PASSWORD",
  "host": "localhost",
  "port": 1521,
  "service": "ORCL"
}
```

> `db-config.json` is listed in `.gitignore` — never commit real credentials.

### Fields

| Field      | Description                                      |
|------------|--------------------------------------------------|
| `type`     | Database type. Currently only `oracle` supported |
| `user`     | Database username                                |
| `password` | Database password                                |
| `host`     | Database host                                    |
| `port`     | Database port (Oracle default: `1521`)           |
| `service`  | Oracle service name (Easy Connect format)        |

## Usage

```bash
# Run collection without DB
node bin/newman-db.js run ./collection.json

# Run with Postman environment file
node bin/newman-db.js run ./collection.json -e ./environment.json

# Run with DB verification
node bin/newman-db.js run ./collection.json -e ./environment.json --db-config ./db-config.json

# Run with HTML report
node bin/newman-db.js run ./collection.json \
  --db-config ./db-config.json \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export ./report.html
```

### CLI options

| Option                          | Description                                     |
|---------------------------------|-------------------------------------------------|
| `run <collection>`              | Path to Postman collection JSON                 |
| `-e, --environment <path>`      | Path to Postman environment JSON                |
| `--db-config <path>`            | Path to DB config JSON                          |
| `--reporters <list>`            | Comma-separated reporters (default: `cli`)      |
| `--reporter-htmlextra-export <path>` | Output path for HTML report               |

## Writing DB requests in Postman

### Request format

| Field        | Value                                      |
|--------------|--------------------------------------------|
| **Method**   | `POST` (or any — method is ignored)        |
| **URL**      | `db://<label>` — e.g. `db://oracle`        |
| **Body**     | raw / JSON                                 |

The request body must be a JSON object with two fields:

```json
{
  "query": "SELECT id, status FROM orders WHERE id = :orderId",
  "params": {
    "orderId": "{{response.id}}"
  }
}
```

### SQL injection protection

SQL parameters are **never** interpolated directly into the query string.
Instead, values are passed as **Oracle bind variables** (`:paramName` syntax),
which are handled safely by the database driver.

```json
{
  "query": "SELECT * FROM users WHERE login = :login AND role = :role",
  "params": {
    "login": "{{response.login}}",
    "role":  "{{ROLE}}"
  }
}
```

### Variable interpolation in params

`{{...}}` placeholders in `params` values are resolved from two sources:

| Source                  | Syntax               | Example                    |
|-------------------------|----------------------|----------------------------|
| Postman environment     | `{{VAR_NAME}}`       | `{{ENV_NAME}}`             |
| Previous HTTP response  | `{{response.field}}` | `{{response.order_id}}`    |

Nested response fields are flattened with dot notation:

```
Response: { "order": { "id": 42 } }
Variable: {{response.order.id}} → 42
```

String values that look like numbers are automatically coerced to numeric type
before being passed as bind variables.

### Example workflow

**Request 1** — `POST /orders`

Response:
```json
{ "id": 42, "status": "PENDING" }
```

**Request 2** — URL: `db://oracle`, Body:
```json
{
  "query": "SELECT status FROM orders WHERE id = :orderId",
  "params": { "orderId": "{{response.id}}" }
}
```

Returns:
```json
[{ "STATUS": "PENDING" }]
```

**Postman test script** for Request 2:
```javascript
const rows = pm.response.json();
pm.test('DB status matches API response', () => {
    pm.expect(rows[0].STATUS).to.equal('PENDING');
});
```

## Project structure

```
newman-db/
├── bin/
│   └── newman-db.js          CLI entry point
├── lib/
│   ├── index.js              Newman runner + DB intercept logic
│   └── db-adapters/
│       ├── index.js          Adapter factory
│       ├── oracle.js         Oracle DB adapter
│       └── db-runner.js      SQL interpolation and execution
├── db-config.json            Your local DB credentials (gitignored)
├── db-config.example.json    Config template
└── package.json
```

## Dependencies

| Package                    | Purpose                        |
|----------------------------|--------------------------------|
| `newman`                   | Postman collection runner      |
| `oracledb`                 | Oracle DB driver               |
| `commander`                | CLI argument parsing           |
| `newman-reporter-htmlextra`| HTML reports (optional)        |

## License

MIT
