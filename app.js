import { createClient, asCurl, validateBaseURL } from "./api-client.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const state = {
  view: "config",
  connected: false,
  connecting: false,
  meta: null,
  scenario: null,
  last: null,
  projects: [],
  tasks: [],
  project: null,
  page: 1,
  taskPage: 1,
  projectTotal: 0,
  taskTotal: 0,
  editor: null,
  deleting: null,
};
let toastTimer;
let loadingProjects = false;
let loadingTasks = false;
const statusLabels = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};
const fieldLabels = {
  name: "Project name",
  owner_email: "Owner email",
  title: "Task title",
  project_id: "Project",
  status: "Status",
};

try {
  const saved = localStorage.getItem("respkit-backend-url");
  if (saved) $("#base-url").value = validateBaseURL(saved);
} catch {
  /* Storage can be unavailable; the default URL still works. */
}

function settings() {
  return {
    language:
      $("#language").value === "custom"
        ? $("#custom-language").value.trim()
        : $("#language").value,
    format: $("#format").value,
    naming: $("#naming").value,
    defaultLocale: $("#default-locale").value,
    locale: $("#locale").value,
    requestID: $("#request-id").value,
  };
}

function client() {
  return createClient({
    baseURL: $("#base-url").value.trim(),
    settings: settings(),
  });
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4500);
}

function showView(view) {
  if (!["config", "workspace", "playground", "catalog"].includes(view))
    view = "config";
  if (state.view !== view) {
    $("#inspector").hidden = true;
    state.last = null;
  }
  state.view = view;
  $$(".view").forEach((section) => {
    section.hidden = section.id !== `view-${view}`;
  });
  $$(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  history.replaceState(null, "", `#${view}`);
}

function setConnected(connected, message) {
  state.connected = connected;
  const badge = $("#connection-status");
  badge.classList.toggle("online", connected);
  badge.innerHTML = `<i></i> ${connected ? "Connected" : "Disconnected"}`;
  $("#connection-message").textContent = message;
  $("#connection-message").hidden = !message;
  $("#scenario-choice").disabled = !connected;
  $$(".needs-api").forEach((button) => {
    button.disabled = !connected;
  });
  $("#new-task").disabled = !connected || !state.project;
  $("#run-scenario").disabled = !connected || !state.scenario;
  $("#inspect-scenario").disabled =
    !connected ||
    !state.scenario?.code ||
    state.scenario?.id === "marshal-fallback";
  $("#previous-projects").disabled = !connected || state.page <= 1;
  $("#next-projects").disabled =
    !connected || state.page * 6 >= state.projectTotal;
}

function inspect(result) {
  state.last = result;
  $("#inspector").hidden = false;
  $("#request-method").textContent = result.request.method;
  $("#request-url").textContent = new URL(result.request.url).pathname;
  $("#response-time").textContent = `${result.duration} ms`;
  $("#response-state").textContent = `HTTP ${result.status}`;
  $("#response-state").classList.toggle("failed", !result.ok);
  $("#response-summary").textContent =
    result.error?.message ??
    (result.request.method === "HEAD"
      ? "Headers only; no response body."
      : result.status === 204
        ? "Request succeeded. No response body."
        : "");
  $("#response-body").textContent =
    result.body === null
      ? "(empty body)"
      : JSON.stringify(result.body, null, 2);
  const headerNames = [
    "content-type",
    "content-language",
    "location",
    "www-authenticate",
    "retry-after",
    "vary",
  ];
  $("#response-headers").innerHTML = headerNames
    .map((name) =>
      result.headers[name]
        ? `<dt>${escape(name)}</dt><dd>${escape(result.headers[name])}</dd>`
        : "",
    )
    .join("");
  $("#request-body").textContent = JSON.stringify(
    {
      url: result.request.url,
      headers: result.request.headers,
      ...(result.request.body === undefined
        ? {}
        : { body: result.request.body }),
    },
    null,
    2,
  );
  $("#copy-json").disabled = result.body === null;
  $("#copy-curl").disabled = false;
}

async function request(path, options = {}, visible = true) {
  const view = state.view;
  const showResult = visible && ["workspace", "playground"].includes(view);
  try {
    const result = await client().request(path, options);
    if (showResult && view === state.view) inspect(result);
    return result;
  } catch (error) {
    if (showResult && view === state.view) {
      $("#inspector").hidden = false;
      $("#response-state").textContent = "Connection failed";
      $("#response-state").classList.add("failed");
      $("#response-summary").textContent =
        "Check the API URL and make sure the server is running.";
      $("#response-body").textContent = "Could not connect to the API.";
      $("#request-url").textContent = path;
      $("#request-method").textContent = options.method ?? "GET";
      $("#response-time").textContent = "";
      $("#response-headers").innerHTML = "";
      $("#request-body").textContent = "—";
      $("#copy-json").disabled = true;
      $("#copy-curl").disabled = true;
      state.last = null;
    }
    throw error;
  }
}

function expectOK(result) {
  if (!result.ok)
    throw new Error(
      `${result.status} · ${result.error?.message ?? "Request failed"}`,
    );
  return result.data;
}

async function connect() {
  if (state.connecting) return;
  state.connecting = true;
  $("#connect-button").disabled = true;
  $("#base-url").disabled = true;
  $("#connect-button").textContent = "Connecting…";
  $("#inspector").hidden = true;
  state.last = null;
  setConnected(false, "");
  try {
    $("#base-url").value = validateBaseURL($("#base-url").value.trim());
    const data = expectOK(await request("/api/meta", {}, false));
    if (
      data?.contract_version !== "1.0" ||
      !Array.isArray(data.scenarios) ||
      !data.scenarios.length ||
      data.scenarios.some(
        (scenario) =>
          !["GET", "HEAD", "POST", "PUT", "DELETE"].includes(scenario.method),
      )
    )
      throw new Error(
        "This API does not support the RespKit example contract.",
      );
    state.meta = data;
    $("#backend-label").textContent = data.framework;
    try {
      localStorage.setItem("respkit-backend-url", $("#base-url").value);
    } catch {
      /* Optional persistence. */
    }
    renderScenarios();
    selectScenario(data.scenarios[0].id);
    state.page = 1;
    state.project = null;
    renderTasks();
    setConnected(true, "");
    const results = await Promise.allSettled([
      loadProjects(false),
      loadCatalog(),
    ]);
    for (const result of results)
      if (result.status === "rejected") toast(result.reason.message);
  } catch (error) {
    setConnected(
      false,
      "API disconnected. Check the API URL and make sure the server is running.",
    );
    $("#connection-settings").open = true;
    showView("config");
    $("#projects").innerHTML =
      '<p class="empty">Connect to the API to view projects.</p>';
    $("#catalog-head").innerHTML = "<th>Code</th><th>HTTP</th>";
    $("#catalog-body").innerHTML =
      '<tr><td colspan="2">Connect to the API to view error codes.</td></tr>';
  } finally {
    state.connecting = false;
    $("#connect-button").disabled = false;
    $("#base-url").disabled = false;
    $("#connect-button").textContent = "Connect";
  }
}

function renderScenarios() {
  if (!state.meta) return;
  const groups = new Map();
  for (const scenario of state.meta.scenarios) {
    if (!groups.has(scenario.group)) groups.set(scenario.group, []);
    groups.get(scenario.group).push(scenario);
  }
  $("#scenario-choice").innerHTML = [...groups]
    .map(
      ([group, items]) =>
        `<optgroup label="${escape(group)}">${items
          .map(
            (scenario) =>
              `<option value="${escape(scenario.id)}">${escape(scenario.method)} · ${escape(scenario.title)}</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("");
  if (state.scenario) $("#scenario-choice").value = state.scenario.id;
}

function selectScenario(id) {
  state.scenario = state.meta?.scenarios.find((scenario) => scenario.id === id);
  if (!state.scenario) return;
  const scenario = state.scenario;
  $("#scenario-choice").value = id;
  $("#scenario-description").textContent = scenario.description;
  $("#scenario-note").textContent = scenario.configuration_note ?? "";
  $("#scenario-note").hidden = !scenario.configuration_note;
  $("#scenario-source").hidden = scenario.source !== "synthetic";
  $("#scenario-tools").hidden = scenario.source !== "synthetic";
  $("#scenario-snippet").textContent = scenario.snippet;
  $("#run-scenario").disabled = !state.connected;
  $("#inspect-scenario").hidden =
    !scenario.code || scenario.id === "marshal-fallback";
  $("#inspect-scenario").disabled =
    !state.connected || !scenario.code || scenario.id === "marshal-fallback";
}

async function runScenario(diagnostics = false) {
  if (!state.scenario || !state.connected) return;
  const button = diagnostics ? $("#inspect-scenario") : $("#run-scenario");
  button.disabled = true;
  try {
    await request(
      `/api/${diagnostics ? "diagnostics" : "playground"}/${state.scenario.id}`,
      { method: diagnostics ? "GET" : state.scenario.method },
    );
    if (state.view === "playground")
      $("#inspector").scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
  } catch (error) {
    toast(error.message);
  } finally {
    selectScenario(state.scenario.id);
  }
}

async function loadProjects(visible = true) {
  if (loadingProjects) return;
  loadingProjects = true;
  try {
    const data = expectOK(
      await request(
        `/api/projects?page=${state.page}&page_size=6`,
        {},
        visible,
      ),
    );
    state.projects = data.items;
    state.projectTotal = data.pagination.total;
    if (!state.projects.length && state.page > 1) {
      state.page--;
      loadingProjects = false;
      return loadProjects(visible);
    }
    if (state.project)
      state.project =
        state.projects.find((project) => project.id === state.project.id) ??
        null;
    renderProjects();
    if (!state.project) renderTasks();
  } finally {
    loadingProjects = false;
  }
}

function renderProjects() {
  $("#projects").innerHTML =
    state.projects
      .map(
        (project) =>
          `<article class="project-card ${state.project?.id === project.id ? "selected" : ""}"><span class="archive-tag ${project.archived ? "" : "active-tag"}">${project.archived ? "Archived" : "Active"}</span><button class="project-select" data-select-project="${project.id}" aria-pressed="${state.project?.id === project.id}"><span class="project-title">${escape(project.name)}</span><span class="project-owner">${escape(project.owner_email)}</span><span class="select-label">View tasks →</span></button><div class="project-actions"><button class="text-button" data-edit-project="${project.id}">Edit</button><button class="text-button" data-archive-project="${project.id}">${project.archived ? "Restore" : "Archive"}</button><button class="text-button red" data-delete-project="${project.id}">Delete</button></div></article>`,
      )
      .join("") ||
    '<p class="empty">No projects yet. Create your first project.</p>';
  $("#previous-projects").disabled = state.page <= 1;
  $("#next-projects").disabled = state.page * 6 >= state.projectTotal;
  $("#new-task").disabled = !state.project;
}

async function loadTasks(visible = true) {
  if (!state.project || loadingTasks) return;
  loadingTasks = true;
  const projectID = state.project.id;
  try {
    const data = expectOK(
      await request(
        `/api/tasks?project_id=${projectID}&page=${state.taskPage}&page_size=6`,
        {},
        visible,
      ),
    );
    if (state.project?.id !== projectID) return;
    state.tasks = data.items;
    state.taskTotal = data.pagination.total;
    if (!state.tasks.length && state.taskPage > 1) {
      state.taskPage--;
      loadingTasks = false;
      return loadTasks(visible);
    }
    renderTasks();
  } finally {
    loadingTasks = false;
  }
}

function renderTasks() {
  $("#task-section").hidden = !state.project;
  $("#selected-project-label").textContent = state.project
    ? `Tasks · ${state.project.name}`
    : "Tasks";
  $("#new-task").disabled = !state.project || !state.connected;
  $("#task-pagination").hidden = !state.project;
  $("#tasks").innerHTML = !state.project
    ? ""
    : state.tasks
        .map(
          (task) =>
            `<article class="task-row"><span class="status-tag ${escape(task.status)}">${escape(statusLabels[task.status] ?? task.status)}</span><div><strong>${escape(task.title)}</strong></div><div class="task-actions"><button class="text-button" data-edit-task="${task.id}">Edit</button><button class="text-button red" data-delete-task="${task.id}">Delete</button></div></article>`,
        )
        .join("") || '<p class="empty">No tasks yet.</p>';
  $("#previous-tasks").disabled = state.taskPage <= 1;
  $("#next-tasks").disabled = state.taskPage * 6 >= state.taskTotal;
}

async function loadCatalog() {
  const catalog = expectOK(await request("/api/catalog", {}, false));
  const languages = [
    ...new Set([
      "id",
      "en",
      ...catalog.flatMap((item) => Object.keys(item.messages ?? {})).sort(),
    ]),
  ];
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  $("#catalog-head").innerHTML =
    '<th scope="col">Code</th><th scope="col">HTTP</th>' +
    languages
      .map((language) => {
        let name;
        try {
          name = names.of(language);
        } catch {
          name = language;
        }
        return `<th scope="col">${escape(name ?? language)}</th>`;
      })
      .join("");
  $("#catalog-body").innerHTML =
    catalog
      .map(
        (item) =>
          `<tr><td>${escape(item.code)}</td><td>${escape(item.http_status)}</td>${languages
            .map((language) =>
              item.messages?.[language]
                ? `<td lang="${escape(language)}">${escape(item.messages[language])}</td>`
                : '<td><span class="missing-translation" title="Uses the configured fallback language">Not translated</span></td>',
            )
            .join("")}</tr>`,
      )
      .join("") ||
    `<tr><td colspan="${languages.length + 2}">No error codes available.</td></tr>`;
}

function openEditor(kind, item = null) {
  if (!state.connected) return;
  state.editor = { kind, item };
  $("#editor-title").textContent =
    `${item ? "Edit" : "New"} ${kind === "projects" ? "project" : "task"}`;
  $("#form-errors").textContent = "";
  if (kind === "projects") {
    $("#editor-fields").innerHTML =
      `<label>Project name<input name="name" value="${escape(item?.name)}" placeholder="e.g. Documentation website" autocomplete="off"></label><label>Owner email<input name="owner_email" value="${escape(item?.owner_email)}" placeholder="ada@example.com" autocomplete="off"></label><label class="checkbox-label"><input type="checkbox" name="archived" ${item?.archived ? "checked" : ""}> Archived project</label>`;
  } else {
    $("#editor-fields").innerHTML =
      `<label>Task title<input name="title" value="${escape(item?.title)}" placeholder="e.g. Write the quickstart guide" autocomplete="off"></label><label>Project<select name="project_id">${state.projects.map((project) => `<option value="${project.id}" ${project.id === (item?.project_id ?? state.project?.id) ? "selected" : ""}>${escape(project.name)}${project.archived ? " (archived)" : ""}</option>`).join("")}</select></label><label>Status<select name="status">${["todo", "doing", "done"].map((status) => `<option value="${status}" ${status === item?.status ? "selected" : ""}>${statusLabels[status]}</option>`).join("")}</select></label>`;
  }
  $("#editor-dialog").showModal();
}

function errorText(result) {
  const error = result.error;
  if (!error) return `HTTP ${result.status}`;
  return `${error.message}${error.details.length ? "\n" + error.details.map((detail) => `${fieldLabels[detail.field] ?? detail.field}: ${detail.message}`).join("\n") : ""}`;
}

async function afterMutation() {
  // Background reloads deliberately keep the mutation response in the inspector.
  await loadProjects(false);
  if (state.project) await loadTasks(false);
}

async function saveEditor(event) {
  event.preventDefault();
  $("#save-editor").disabled = true;
  $("#form-errors").textContent = "";
  try {
    const form = new FormData($("#editor-form"));
    const { kind, item } = state.editor;
    const body =
      kind === "projects"
        ? {
            name: form.get("name"),
            owner_email: form.get("owner_email"),
            archived: form.has("archived"),
          }
        : {
            title: form.get("title"),
            project_id: Number(form.get("project_id")),
            status: form.get("status"),
          };
    const result = await request(`/api/${kind}${item ? `/${item.id}` : ""}`, {
      method: item ? "PUT" : "POST",
      body,
    });
    if (!result.ok) {
      $("#form-errors").textContent = errorText(result);
      return;
    }
    $("#editor-dialog").close();
    toast(
      item
        ? "Changes saved."
        : `${kind === "projects" ? "Project" : "Task"} created.`,
    );
    await afterMutation();
  } catch (error) {
    $("#form-errors").textContent = error.message;
    toast(error.message);
  } finally {
    $("#save-editor").disabled = false;
  }
}

function openDelete(kind, item) {
  state.deleting = { kind, item };
  $("#delete-title").textContent =
    `Delete ${kind === "projects" ? "project" : "task"}?`;
  $("#delete-message").textContent =
    `“${kind === "projects" ? item.name : item.title}” will be deleted.`;
  $("#delete-error").textContent = "";
  $("#delete-dialog").showModal();
}

async function deleteResource(event) {
  event.preventDefault();
  $("#confirm-delete").disabled = true;
  try {
    const { kind, item } = state.deleting;
    const result = await request(`/api/${kind}/${item.id}`, {
      method: "DELETE",
    });
    if (!result.ok) {
      $("#delete-error").textContent =
        kind === "projects" && result.status === 422
          ? "This project still has tasks. Delete them first."
          : errorText(result);
      return;
    }
    $("#delete-dialog").close();
    toast(`${kind === "projects" ? "Project" : "Task"} deleted.`);
    await afterMutation();
  } catch (error) {
    $("#delete-error").textContent = error.message;
  } finally {
    $("#confirm-delete").disabled = false;
  }
}

// Catch rejected event promises in one place so failed requests remain visible.
function on(selector, event, handler) {
  $(selector).addEventListener(event, (e) => {
    Promise.resolve(handler(e)).catch((error) => toast(error.message));
  });
}
$$("[data-view]").forEach((button) =>
  button.addEventListener("click", () => showView(button.dataset.view)),
);
on("#connection-form", "submit", (event) => {
  event.preventDefault();
  return connect();
});
on("#language", "change", () => {
  $("#custom-language-label").hidden = $("#language").value !== "custom";
});
on("#base-url", "input", () =>
  setConnected(false, "API URL changed. Connect again to continue."),
);
on("#scenario-choice", "change", (event) => selectScenario(event.target.value));
on("#run-scenario", "click", () => runScenario());
on("#inspect-scenario", "click", () => runScenario(true));
on("#new-project", "click", () => openEditor("projects"));
on("#new-task", "click", () => openEditor("tasks"));
on("#editor-form", "submit", saveEditor);
for (const selector of ["#close-editor", "#cancel-editor"])
  on(selector, "click", () => $("#editor-dialog").close());
on("#cancel-delete", "click", () => $("#delete-dialog").close());
on("#delete-form", "submit", deleteResource);
on("#previous-projects", "click", () => {
  if (!loadingProjects) {
    state.page--;
    return loadProjects();
  }
});
on("#next-projects", "click", () => {
  if (!loadingProjects) {
    state.page++;
    return loadProjects();
  }
});
on("#previous-tasks", "click", () => {
  if (!loadingTasks) {
    state.taskPage--;
    return loadTasks();
  }
});
on("#next-tasks", "click", () => {
  if (!loadingTasks) {
    state.taskPage++;
    return loadTasks();
  }
});
on("#projects", "click", async (event) => {
  if (!state.connected) return;
  const target = event.target.closest("button");
  if (!target) return;
  const action = Object.keys(target.dataset)[0];
  const project = state.projects.find(
    (item) => item.id === Number(target.dataset[action]),
  );
  if (!project) return;
  if (action === "selectProject") {
    if (loadingTasks) return;
    state.project = project;
    state.taskPage = 1;
    state.tasks = [];
    state.taskTotal = 0;
    renderProjects();
    renderTasks();
    await loadTasks();
  } else if (action === "editProject") openEditor("projects", project);
  else if (action === "deleteProject") openDelete("projects", project);
  else if (action === "archiveProject") {
    target.disabled = true;
    try {
      expectOK(
        await request(`/api/projects/${project.id}`, {
          method: "PUT",
          body: {
            name: project.name,
            owner_email: project.owner_email,
            archived: !project.archived,
          },
        }),
      );
      await afterMutation();
      toast(project.archived ? "Project restored." : "Project archived.");
    } finally {
      target.disabled = false;
    }
  }
});
on("#tasks", "click", (event) => {
  if (!state.connected) return;
  const target = event.target.closest("button");
  if (!target) return;
  const action = Object.keys(target.dataset)[0];
  const task = state.tasks.find(
    (item) => item.id === Number(target.dataset[action]),
  );
  if (!task) return;
  if (action === "editTask") openEditor("tasks", task);
  if (action === "deleteTask") openDelete("tasks", task);
});
on("#copy-json", "click", async () => {
  await navigator.clipboard.writeText(JSON.stringify(state.last.body, null, 2));
  toast("JSON copied.");
});
on("#copy-curl", "click", async () => {
  await navigator.clipboard.writeText(asCurl(state.last.request));
  toast("cURL copied.");
});
showView(location.hash.slice(1));
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
setConnected(false, "");
connect();
