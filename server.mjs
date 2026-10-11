// A buildless local server. Any static host can serve the same four assets.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/api-client.mjs", ["api-client.mjs", "text/javascript; charset=utf-8"]],
]);
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";
const server = createServer(async (request, response) => {
  try {
    const asset = assets.get(new URL(request.url, "http://localhost").pathname);
    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const data = await readFile(new URL(asset[0], import.meta.url));
    response.writeHead(200, {
      "Content-Type": asset[1],
      "Content-Length": data.length,
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unable to serve asset");
  }
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, host, () =>
  console.log(`RespKit frontend: http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close());
