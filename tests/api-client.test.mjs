import test from "node:test";
import assert from "node:assert/strict";
import {
  createClient,
  normalize,
  asCurl,
  validateBaseURL,
} from "../api-client.mjs";

test("all envelope conventions preserve application keys and request IDs", () => {
  const cases = [
    {
      success: true,
      data: { owner_email: "ada@example.com" },
      meta: { request_id: "abc-1" },
    },
    {
      success: true,
      data: { owner_email: "ada@example.com" },
      meta: { requestId: "abc-1" },
    },
    {
      Success: true,
      Data: { owner_email: "ada@example.com" },
      Meta: { RequestId: "abc-1" },
    },
  ];
  for (const body of cases) {
    const result = normalize(body, 200);
    assert.equal(result.data.owner_email, "ada@example.com");
    assert.equal(result.requestID, "abc-1");
    assert.equal(result.error, null);
  }
});

test("PascalCase field details and RFC 9457 normalize without changing raw bodies", () => {
  const envelope = {
    Success: false,
    Error: {
      Code: "VALIDATION_FAILED",
      Message: "Invalid",
      Details: [{ Field: "name", Code: "MIN_LENGTH", Message: "At least 3" }],
    },
  };
  const result = normalize(envelope, 422);
  assert.deepEqual(result.error.details, [
    { field: "name", code: "MIN_LENGTH", message: "At least 3" },
  ]);
  assert.equal(envelope.Error.Code, "VALIDATION_FAILED");
  const problem = normalize(
    {
      type: "about:blank",
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      detail: "Introuvable",
      request_id: "abc",
    },
    404,
  );
  assert.equal(problem.error.message, "Introuvable");
  assert.equal(problem.requestID, "abc");
  assert.deepEqual(normalize(null, 204), {
    data: null,
    error: null,
    requestID: null,
  });
});

test("request uses a portable base URL, query policy, language header and JSON body", async () => {
  let sent;
  const api = createClient({
    baseURL: "http://localhost:8080",
    settings: {
      naming: "PascalCase",
      format: "problem_details",
      defaultLocale: "id",
      locale: "en",
      language: "fr;q=0.9,en;q=0.8",
      requestID: "abc-1",
    },
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return new Response(JSON.stringify({ Success: true, Data: { id: 1 } }), {
        status: 201,
        headers: { Location: "/api/projects/1", "Content-Language": "en" },
      });
    },
  });
  const result = await api.request("/api/projects?page=2", {
    method: "POST",
    body: { name: "Test" },
  });
  assert.equal(sent.url.searchParams.get("page"), "2");
  assert.equal(sent.url.searchParams.get("locale"), "en");
  assert.equal(sent.options.headers["Accept-Language"], "fr;q=0.9,en;q=0.8");
  assert.equal(sent.options.headers["Content-Type"], "application/json");
  assert.equal(sent.options.body, '{"name":"Test"}');
  assert.equal(result.data.id, 1);
  assert.equal(result.headers.location, "/api/projects/1");
});

test("empty 204 and HEAD are accepted while invalid JSON is reported", async () => {
  const empty = createClient({
    baseURL: "http://localhost:8080",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  assert.equal(
    (await empty.request("/api/projects/1", { method: "DELETE" })).body,
    null,
  );
  const head = createClient({
    baseURL: "http://localhost:8080",
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert.equal(
    (await head.request("/api/playground/not-found", { method: "HEAD" })).body,
    null,
  );
  const html = createClient({
    baseURL: "http://localhost:8080",
    fetchImpl: async () => new Response("<!doctype html>"),
  });
  await assert.rejects(html.request("/api/meta"), /did not return JSON/);
});

test("base URL validation and copied cURL keep untrusted text as literals", () => {
  assert.throws(() => validateBaseURL("javascript:alert(1)"));
  assert.throws(() => validateBaseURL("http://user:pass@localhost:8080"));
  assert.throws(() => validateBaseURL("http://localhost:8080?token=value"));
  assert.equal(
    validateBaseURL("http://localhost:8080/"),
    "http://localhost:8080",
  );
  const command = asCurl({
    method: "POST",
    url: "http://localhost:8080/api/projects",
    headers: { "Content-Type": "application/json" },
    body: { name: "Ada's $(echo x) `echo x`" },
  });
  assert.ok(command.includes("'\\''"));
  assert.ok(command.includes("$(echo x)"));
  assert.ok(
    asCurl({
      method: "HEAD",
      url: "http://localhost:8080/api/meta",
      headers: {},
    }).startsWith("curl -I"),
  );
});
