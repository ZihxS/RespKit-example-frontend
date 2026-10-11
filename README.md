# RespKit example frontend

A plain HTML, CSS, and JavaScript frontend for RespKit API examples. It uses a shared HTTP contract, so the same interface can connect to Fiber, Gin, or Echo backends.

Use it with the [Fiber v3 and SQLite backend](https://github.com/ZihxS/RespKit-example-fiber-v3). Available backends are listed in [RespKit's example projects](https://github.com/ZihxS/RespKit#example-projects).

## Requirements

Node.js 22 or newer for the development server and tests. There are no npm dependencies or build steps.

## Run

From the frontend project root:

```sh
npm start
```

Open **http://127.0.0.1:5173**. The frontend connects automatically to **http://127.0.0.1:8080**.

To use another backend, open **Config → API connection**, enter its URL, and select **Connect**. The backend must implement [API_CONTRACT.md](API_CONTRACT.md) and allow the frontend's origin through CORS.

The last API URL is saved in browser storage.

## Interface

- **Config**: the initial tab; choose response settings and connect to an API.
- **Projects**: create, edit, archive, and delete projects; manage their tasks.
- **Response examples**: select an example and use **Send request** beside the select. Each option shows its HTTP method. For error examples, **Inspect error** shows the resolved code, HTTP status, and mapper.
- **Error codes**: browse built-in codes with a column for each configured language, including French. Columns follow the API catalog; missing translations show **Not translated** and use the configured fallback language at response time.

The interface uses English. In **Config**, **Message language** defaults to English and selects English, Indonesian, or French API messages. **Error format** switches between JSON and Problem Details.

**Advanced settings** contains JSON naming, default language, per-response language override, and request ID. Select **Custom header** to try an Accept-Language value with regional tags or quality values.

Zero-configuration examples use RespKit's default engine: Indonesian/English messages, Indonesian fallback, snake_case, and the JSON envelope. They show a note because Config overrides do not apply. A French-only request falls back to Indonesian in these examples. Choose **404 · Not Found** to try French with the configured engine.

Results appear under **Request result** for project/task actions and response examples. The Error codes and Config tabs do not display request results. Response headers and request contents can be expanded. Code examples are available under **Explanation and Go code**. The method comes from backend metadata: creation uses POST, No Content uses DELETE, and the HEAD example returns headers only.

Under **Privacy and fallbacks**, compare **Private internal error** with **Internal message (simulated)**. The latter shows `WithExposeInternalErrors(true)` using a fixed fictional error. The public message follows the selected language; the additional `debug_message` contains the demo text. Ordinary routes keep internal messages private.

## Server configuration

The development server accepts `PORT` and `HOST`:

```sh
PORT=5174 HOST=127.0.0.1 npm start
```

Allow the matching origin on the backend, for example `http://127.0.0.1:5174`.

For static hosting, serve these files from the same directory:

```text
index.html
styles.css
app.js
api-client.mjs
```

Serve them over HTTP or HTTPS so JavaScript modules can load. Clipboard buttons require HTTPS or localhost.

## Tests

```sh
npm run check
npm test
```

To test against a running backend:

```sh
API_URL=http://127.0.0.1:8080 npm test
```

Without `API_URL`, the HTTP integration suite is skipped. With it, tests check language selection, response formats, naming, all provided scenarios, CRUD, HEAD/204, diagnostics, and CORS. Resources created during the test are cleaned up afterward.

## Project layout

| File              | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `index.html`      | Pages, controls, and dialogs             |
| `styles.css`      | Responsive layout                        |
| `app.js`          | UI and project/task actions              |
| `api-client.mjs`  | HTTP requests and response normalization |
| `server.mjs`      | Development server                       |
| `API_CONTRACT.md` | Contract for compatible backends         |
| `tests/`          | Client and HTTP integration tests        |

The client supports snake_case, camelCase, PascalCase, and RFC 9457 errors. Application data keys are preserved.

## Troubleshooting

If the API cannot connect, check its URL, confirm that the server is running, and verify its CORS origin settings. With the default frontend address, the backend must allow `http://127.0.0.1:5173`.

If French validation messages fall back to Indonesian or English, the example backend's French catalog is missing a field translation. This demonstrates RespKit's fallback behavior. The response's Content-Language header indicates the language used.
