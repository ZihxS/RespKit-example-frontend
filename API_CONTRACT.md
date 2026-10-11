# RespKit example HTTP contract 1.0

This application contract lets the same frontend work with Fiber, Gin, or Echo examples. Each backend implements its own routing and storage.

The client appends `/api/...` to the API URL. A URL may include a prefix: for example, `http://localhost:8080/demo` produces `/demo/api/...` endpoints.

## Response settings

Every endpoint accepts these query parameters:

| Key            | Values                              | Default    |
| -------------- | ----------------------------------- | ---------- |
| naming         | snake_case, camelCase, PascalCase   | snake_case |
| format         | envelope, problem_details           | envelope   |
| default_locale | id, en                              | id         |
| locale         | id, en, fr; empty means no override | empty      |

Invalid values return 400. Prepare immutable engine presets at startup; do not call `resp.Configure` during a request. The `zero-config*` examples use package helpers with the default engine. They support Indonesian/English, use Indonesian fallback, snake_case, and the JSON envelope, and ignore configuration queries. They still pass Accept-Language to RespKit: a French-only request falls back to Indonesian, while a header that also accepts English can select English. The regular `not-found` example uses the configured engine and supports French.

Request headers are `Accept-Language`, `X-Request-ID`, and `Content-Type: application/json` for JSON writes. The frontend uses English UI wording and selects English messages by default. The API's default locale remains Indonesian.

For all language examples, provide a custom French catalog including PROJECT_ARCHIVED and INVALID_STATUS. Omit INVALID_EMAIL from French to demonstrate fallback of the entire response to the default locale. Additional languages require updates to the presets, override validation, and frontend controls.

Success responses use `resp.OK/Created`; errors use `resp.Fail`. Payloads below describe the contents of `data`. The frontend accepts snake_case, camelCase, and PascalCase for RespKit-owned keys. Application keys remain snake_case.

RFC 9457 errors use `application/problem+json` with `type/title/status/detail/code`, plus `request_id` when valid. The current RespKit version omits field details in Problem Details. HEAD returns the same status and headers without a body. A 204 response also has no body.

CORS must allow the frontend origin, GET/HEAD/POST/PUT/DELETE/OPTIONS, and the request headers above. Expose `Content-Language`, `Location`, `WWW-Authenticate`, `Retry-After`, and `Vary`. RespKit sets Content-Language and Vary; the application supplies authentication and rate limit headers.

## Metadata and catalog

`GET /api/meta` returns 200 with:

```json
{
  "contract_version": "1.0",
  "framework": "Fiber v3",
  "respkit_version": "1.1.0",
  "storage": "SQLite / mattn-go-sqlite3",
  "scenarios": [
    {
      "id": "ok",
      "method": "GET",
      "group": "Response helpers",
      "title": "200 · OK",
      "description": "A success envelope.",
      "status": 200,
      "source": "application",
      "snippet": "return api.OK(c, project)"
    }
  ],
  "notes": [
    "RespKit formats responses. The application provides routing and CRUD."
  ]
}
```

Each scenario must include a `method`: GET, HEAD, POST, PUT, or DELETE. The frontend displays that method in the example option and uses it when sending the request.

An optional English `configuration_note` is displayed below the request controls. Provide it for both zero-configuration examples to explain their defaults and language support.

Use English for scenario groups, titles, descriptions, snippets, and notes. A scenario's `code` is optional and identifies its public error code. Supported `source` values are application, sentinel, runtime, sqlite-runtime, and synthetic. The frontend labels synthetic examples as **Simulated**.

Reuse the Fiber example's scenario IDs and metadata to run the same contract suite. Adapt Go snippets to the backend's native framework context.

`GET /api/catalog` returns 200 with an array of built-in error codes. Extend `Engine.Catalog()` with the application's custom language catalogs:

```text
{code, http_status, messages: {id, en, fr, ...}}
```

This catalog includes built-in codes only. Every item includes all configured locale keys. Preserve the built-in Indonesian/English translations and include the actual custom translations; use an empty string for a missing translation instead of substituting a fallback message. The frontend builds language columns from these keys, displays language names in English, and marks missing messages as **Not translated**. The catalog is independent of the current request language and fallback selection.

## Projects

Model:

```text
{id: integer, name: string, owner_email: string, archived: boolean, created_at: RFC3339 UTC string}
```

IDs are positive. Trim names before validation; require at least three Unicode code points and case-sensitive uniqueness. owner_email must be an email address without a display name. archived defaults to false.

PUT replaces all mutable fields. Omitted fields use their zero values and are validated.

| Method | Path                             | Result                                                                                |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | /api/projects?page=1&page_size=6 | 200 `{items: Project[], pagination: {page, page_size, total}}`                        |
| GET    | /api/projects/:id                | 200 Project; 404 if missing                                                           |
| POST   | /api/projects                    | Body `{name, owner_email, archived?}` → 201 Project with Location `/api/projects/:id` |
| PUT    | /api/projects/:id                | Body `{name, owner_email, archived}` → 200 Project                                    |
| DELETE | /api/projects/:id                | 204; 404 if missing; 422 if tasks still belong to the project                         |

Duplicate names produce RESOURCE_ALREADY_EXISTS / 409 through the SQLite mapper. Invalid input produces VALIDATION_FAILED / 422 with field details FIELD_REQUIRED, MIN_LENGTH (`Params.min = "3"`), and INVALID_EMAIL.

## Tasks

Model:

```text
{id: integer, project_id: integer, title: string, status: "todo"|"doing"|"done", created_at: RFC3339 UTC string}
```

Trim titles before validation; require at least three Unicode code points. project_id must be positive. An empty status defaults to todo.

| Method | Path                                       | Result                                                                                               |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| GET    | /api/tasks?project_id=1&page=1&page_size=6 | 200 `{items: Task[], pagination: {page, page_size, total}}`; project_id 0 or omitted lists all tasks |
| GET    | /api/tasks/:id                             | 200 Task; 404 if missing                                                                             |
| POST   | /api/tasks                                 | Body `{project_id, title, status?}` → 201 Task with Location `/api/tasks/:id`                        |
| PUT    | /api/tasks/:id                             | Body `{project_id, title, status}` → 200 Task                                                        |
| DELETE | /api/tasks/:id                             | 204; 404 if missing                                                                                  |

Creating or updating a task in an archived project produces PROJECT_ARCHIVED / 409 through the domain mapper. A missing parent produces VALIDATION_FAILED / 422 from an actual SQLite foreign key violation. Invalid status produces outer VALIDATION_FAILED / 422 with an INVALID_STATUS field detail.

Pagination accepts page 1..1,000,000 and page_size 1..100. Sort IDs in ascending order. Empty items must be `[]`. Pages beyond the result set return 200 with empty items.

Invalid IDs or pagination produce BAD_REQUEST / 400. Empty, null, malformed, or incorrectly typed JSON also produces BAD_REQUEST / 400. The application must explicitly map sql.ErrNoRows from a resource lookup to 404.

## Response examples and diagnostics

`{method} /api/playground/:scenario` sends the status and code described in metadata. Use the scenario's `method` from `/api/meta`. The `created` example uses POST, `no-content` uses DELETE, `conflict` uses PUT, and `head` uses HEAD. GET examples also support HEAD. Unregistered methods return 404.

Playground operations are isolated from CRUD data. The 201 example's metadata must explain that it demonstrates creation without saving a resource.

The `internal-message` example uses GET and returns INTERNAL_ERROR / 500 with `source: "synthetic"`. It demonstrates `WithExposeInternalErrors(true)` through an isolated engine that receives only this fixed fictional error:

```text
DEMO_INTERNAL_MESSAGE: this is a fictional error for the example.
```

The public error message stays localized. JSON envelopes name the debug field according to the configured naming convention; Problem Details uses `debug_message`. Never pass request input, database errors, or failures from ordinary routes to the demo engine. All other routes keep internal messages private. The debug option is intended only for isolated local development.

`GET /api/diagnostics/:scenario` returns 200 with:

```json
{
  "diagnostic": {
    "schema_version": "1",
    "detected": true,
    "mapper": "custom.sqlite3",
    "error_code": "RESOURCE_ALREADY_EXISTS",
    "http_status": 409
  },
  "resolved_code": "RESOURCE_ALREADY_EXISTS",
  "resolved_status": 409,
  "package_inspect": {
    "schema_version": "1",
    "detected": false,
    "mapper": "fallback",
    "error_code": "INTERNAL_ERROR",
    "http_status": 500
  },
  "package_explain": {},
  "note": "The configured engine and package helpers use different configurations."
}
```

package_explain contains the full diagnostic JSON from `resp.Explain`. Optional diagnostic fields and fallback mapper names follow the installed RespKit version.

Success scenarios and marshal-fallback have no diagnostics and return 400 here. Unknown scenario IDs return 404. The canceled example is available only through diagnostics to demonstrate classification. The local CLI uses a recorder to demonstrate that Fail(context.Canceled) writes no response.

Keep causes, SQL, and driver error text out of diagnostic payloads. Unknown routes return a RespKit 404 response.

## Testing another backend

Start the replacement backend, then run this from the frontend project root:

```sh
API_URL=http://127.0.0.1:8080 npm test
```

The suite exercises actual HTTP responses without importing Fiber. It expects the archived domain example, sqlite-unique, every scenario advertised by metadata, and the CRUD/CORS behavior above.

Each backend module should also test its own framework runtime and optional mappers.
