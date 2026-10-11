// Framework-independent client. Only this module knows the response envelope.
export function owned(object, snake, camel = snake) {
  if (!object || typeof object !== "object") return undefined;
  const pascal = camel[0].toUpperCase() + camel.slice(1);
  return object[snake] ?? object[camel] ?? object[pascal];
}

export function normalize(body, status) {
  if (body === null) return { data: null, error: null, requestID: null };
  const meta = owned(body, "meta");
  const requestID =
    owned(meta, "request_id", "requestId") ?? body.request_id ?? null;
  if (status < 400)
    return { data: owned(body, "data") ?? null, error: null, requestID };
  // RFC 9457 keys stay fixed, regardless of the configured envelope naming.
  if (typeof body.status === "number" && typeof body.type === "string") {
    return {
      data: null,
      requestID,
      error: { code: body.code, message: body.detail, details: [] },
    };
  }
  const error = owned(body, "error") ?? {};
  return {
    data: null,
    requestID,
    error: {
      code: owned(error, "code") ?? "UNKNOWN_ERROR",
      message: owned(error, "message") ?? "Unrecognized API response.",
      details: (owned(error, "details") ?? []).map((detail) => ({
        field: owned(detail, "field"),
        code: owned(detail, "code"),
        message: owned(detail, "message"),
      })),
    },
  };
}

export function validateBaseURL(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTP or HTTPS URL without credentials, a query, or a fragment.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function createClient({
  baseURL,
  settings = {},
  fetchImpl = globalThis.fetch,
}) {
  const base = validateBaseURL(baseURL);
  return {
    async request(path, { method = "GET", body, signal } = {}) {
      if (!path.startsWith("/api/"))
        throw new Error("The request path must start with /api/.");
      const url = new URL(base + path);
      for (const [key, value] of Object.entries({
        naming: settings.naming,
        format: settings.format,
        default_locale: settings.defaultLocale,
        locale: settings.locale,
      })) {
        if (value) url.searchParams.set(key, value);
      }
      const headers = {};
      if (settings.language) headers["Accept-Language"] = settings.language;
      if (settings.requestID) headers["X-Request-ID"] = settings.requestID;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const started = performance.now();
      const response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(10000),
      });
      const text =
        method === "HEAD" || response.status === 204
          ? ""
          : await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error(
            `HTTP ${response.status}: the backend did not return JSON. Check the API URL.`,
          );
        }
      }
      return {
        status: response.status,
        ok: response.ok,
        body: parsed,
        raw: text,
        headers: Object.fromEntries(response.headers.entries()),
        duration: Math.round(performance.now() - started),
        request: { method, url: url.toString(), headers, body },
        ...normalize(parsed, response.status),
      };
    },
  };
}

export function asCurl(request) {
  const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
  const parts = [
    request.method === "HEAD" ? "curl -I" : `curl -i -X ${request.method}`,
    quote(request.url),
  ];
  for (const [name, value] of Object.entries(request.headers))
    parts.push(`-H ${quote(`${name}: ${value}`)}`);
  if (request.body !== undefined)
    parts.push(`--data ${quote(JSON.stringify(request.body))}`);
  return parts.join(" \\\n  ");
}
