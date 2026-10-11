import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../api-client.mjs";

// This suite targets the shared HTTP contract, so it can also verify Gin/Echo.
const baseURL = process.env.API_URL;
test(
  "frontend client integrates with the actual backend HTTP contract",
  { skip: !baseURL },
  async (t) => {
    const languages = [
      { language: "id", phrase: "Proyek ini diarsipkan." },
      { language: "en-US,en;q=0.9", phrase: "This project is archived." },
      { language: "fr;q=0.9,en;q=0.7", phrase: "Ce projet est archivé." },
    ];
    for (const entry of languages) {
      for (const naming of ["snake_case", "camelCase", "PascalCase"]) {
        for (const format of ["envelope", "problem_details"]) {
          const api = createClient({
            baseURL,
            settings: {
              language: entry.language,
              naming,
              format,
              requestID: "frontend-test.001",
            },
          });
          const error = await api.request("/api/playground/archived", {
            method: "POST",
          });
          assert.equal(error.status, 409);
          assert.equal(error.error.code, "PROJECT_ARCHIVED");
          assert.ok(error.error.message.startsWith(entry.phrase));
          assert.equal(error.requestID, "frontend-test.001");
          const success = await api.request("/api/playground/ok");
          assert.equal(success.data.owner_email, "ada@example.com");
        }
      }
    }
    const api = createClient({
      baseURL,
      settings: { language: "en", requestID: "frontend-test.002" },
    });
    const meta = await api.request("/api/meta");
    assert.equal(meta.data.contract_version, "1.0");
    const catalog = await api.request("/api/catalog");
    assert.equal(catalog.status, 200);
    for (const item of catalog.data) {
      for (const language of ["id", "en", "fr"]) {
        assert.equal(typeof item.messages[language], "string");
      }
      assert.ok(item.messages.id);
      assert.ok(item.messages.en);
    }
    assert.equal(
      catalog.data.find((item) => item.code === "RESOURCE_NOT_FOUND").messages
        .fr,
      "La ressource demandée est introuvable.",
    );
    assert.ok(meta.data.scenarios.length >= 30);
    for (const scenario of meta.data.scenarios) {
      assert.ok(
        ["GET", "HEAD", "POST", "PUT", "DELETE"].includes(scenario.method),
      );
      const result = await api.request(`/api/playground/${scenario.id}`, {
        method: scenario.method,
      });
      assert.equal(result.status, scenario.status, scenario.id);
      if (scenario.method === "HEAD") assert.equal(result.body, null);
      if (scenario.code)
        assert.equal(result.error.code, scenario.code, scenario.id);
    }
    assert.equal(
      meta.data.scenarios.find((s) => s.id === "created").method,
      "POST",
    );
    assert.equal(
      meta.data.scenarios.find((s) => s.id === "no-content").method,
      "DELETE",
    );
    assert.equal((await api.request("/api/playground/created")).status, 404);
    for (const id of ["zero-config", "zero-config-not-found"]) {
      assert.ok(
        meta.data.scenarios.find((scenario) => scenario.id === id)
          .configuration_note,
      );
    }
    assert.equal(
      meta.data.scenarios.find((scenario) => scenario.id === "not-found")
        .configuration_note,
      undefined,
    );
    const frenchClient = createClient({
      baseURL,
      settings: {
        language: "fr",
        defaultLocale: "en",
        naming: "camelCase",
        format: "problem_details",
      },
    });
    const defaultNotFound = await frenchClient.request(
      "/api/playground/zero-config-not-found",
    );
    assert.equal(defaultNotFound.status, 404);
    assert.equal(defaultNotFound.headers["content-language"], "id");
    assert.equal(defaultNotFound.body.error.code, "RESOURCE_NOT_FOUND");
    assert.equal(defaultNotFound.error.message, "Data tidak ditemukan.");
    const frenchNotFound = await frenchClient.request(
      "/api/playground/not-found",
    );
    assert.equal(frenchNotFound.status, 404);
    assert.equal(frenchNotFound.headers["content-language"], "fr");
    assert.equal(
      frenchNotFound.headers["content-type"],
      "application/problem+json",
    );
    assert.equal(
      frenchNotFound.error.message,
      "La ressource demandée est introuvable.",
    );
    const internalDemo = meta.data.scenarios.find(
      (scenario) => scenario.id === "internal-message",
    );
    assert.equal(internalDemo.source, "synthetic");
    assert.equal(internalDemo.method, "GET");
    for (const naming of ["snake_case", "camelCase", "PascalCase"]) {
      for (const format of ["envelope", "problem_details"]) {
        const debugClient = createClient({
          baseURL,
          settings: { language: "en", naming, format },
        });
        const demo = await debugClient.request(
          "/api/playground/internal-message",
        );
        assert.equal(demo.status, 500);
        assert.equal(demo.error.code, "INTERNAL_ERROR");
        const debug =
          demo.body.debug_message ??
          demo.body.error?.debug_message ??
          demo.body.error?.debugMessage ??
          demo.body.Error?.DebugMessage;
        assert.equal(
          debug,
          "DEMO_INTERNAL_MESSAGE: this is a fictional error for the example.",
        );
        const ordinary = await debugClient.request("/api/playground/internal");
        assert.equal(ordinary.error.message, demo.error.message);
        assert.ok(
          !/debug_message|debugMessage|DebugMessage|PRIVATE_DEMO_DETAIL/.test(
            ordinary.raw,
          ),
        );
      }
    }
    const project = await api.request("/api/projects", {
      method: "POST",
      body: {
        name: `Frontend test ${crypto.randomUUID()}`,
        owner_email: "frontend@example.com",
      },
    });
    assert.equal(project.status, 201);
    assert.ok(project.headers.location);
    const projectID = project.data.id;
    let taskID;
    t.after(async () => {
      if (taskID)
        await api.request(`/api/tasks/${taskID}`, { method: "DELETE" });
      await api.request(`/api/projects/${projectID}`, { method: "DELETE" });
    });
    const invalid = await api.request("/api/projects", {
      method: "POST",
      body: { name: "a", owner_email: "bad" },
    });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.error.details.length, 2);
    const task = await api.request("/api/tasks", {
      method: "POST",
      body: { project_id: projectID, title: "Test the client", status: "todo" },
    });
    assert.equal(task.status, 201);
    taskID = task.data.id;
    const updated = await api.request(`/api/tasks/${taskID}`, {
      method: "PUT",
      body: { project_id: projectID, title: "Test completed", status: "done" },
    });
    assert.equal(updated.data.status, "done");
    assert.equal(
      (await api.request(`/api/projects/${projectID}`, { method: "DELETE" }))
        .status,
      422,
    );
    const deleted = await api.request(`/api/tasks/${taskID}`, {
      method: "DELETE",
    });
    assert.equal(deleted.status, 204);
    assert.equal(deleted.body, null);
    taskID = null;
    const head = await api.request("/api/playground/ok", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, null);
    const diagnostics = await api.request("/api/diagnostics/sqlite-unique");
    assert.equal(diagnostics.data.diagnostic.mapper, "custom.sqlite3");
    const cors = await fetch(`${baseURL}/api/projects`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "Content-Type,X-Request-ID,Accept-Language",
      },
    });
    assert.equal(
      cors.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:5173",
    );
  },
);
