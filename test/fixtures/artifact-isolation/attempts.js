// Storage and authority observations from a real artifact document. The driver
// seeds a sentinel in the shell; this page receives no token or test interface.
const desktop = typeof window.__televisionContentBridge !== "undefined";
const popup = new URL(location.href).searchParams.has("popup");
const artifactID = location.pathname.split("/")[2];
let appWindow;

function attempt(use) {
  try { use(); return "accessible"; } catch (error) { return error.name; }
}

function readWindow(target) {
  return {
    document: attempt(() => target.document.body),
    storage: attempt(() => target.localStorage.getItem("artifact-isolation-sentinel")),
    address: attempt(() => target.location.href),
  };
}

function storage() {
  return {
    localRead: attempt(() => localStorage.getItem("artifact-isolation-sentinel")),
    localWrite: attempt(() => localStorage.setItem("isolation-storage-probe", "written")),
    sessionRead: attempt(() => sessionStorage.getItem("artifact-isolation-sentinel")),
    sessionWrite: attempt(() => sessionStorage.setItem("artifact-isolation-probe", "written")),
    cookieRead: attempt(() => document.cookie),
    cookieWrite: attempt(() => { document.cookie = "artifactIsolationProbe=written"; }),
    indexedDB: attempt(() => {
      const request = indexedDB.open("artifact-isolation");
      request.onsuccess = () => request.result.close();
    }),
  };
}

function readSentinel() {
  try { return { value: localStorage.getItem("artifact-isolation-sentinel") }; }
  catch (error) { return { error: error.name }; }
}

function xhr(route, guessed) {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("GET", route);
    if (guessed) request.setRequestHeader("Authorization", "Bearer isolation-guessed-token");
    request.onload = () => resolve("readable:" + request.status);
    request.onerror = () => resolve(request.status === 0 ? "unreadable" : "readable");
    request.timeout = 5000;
    request.ontimeout = () => resolve("timeout");
    request.send();
  });
}

async function tokenRoutes() {
  // Each HTTP token-route family in isolation.md#^iso-routes.
  const routes = ["/channels", "/artifacts", "/display", "/themes",
    `/markdown/${artifactID}`, "/telemetry", "/demo-mode", "/desktop/connect-check",
    "/api/resources/v1/resources"];
  const results = {};
  await Promise.all(routes.flatMap((route) => [false, true].map(async (guessed) => {
    const headers = guessed ? { Authorization: "Bearer isolation-guessed-token" } : {};
    const fetched = fetch(route, { headers }).then((response) => "readable:" + response.status, (error) => error.name === "TypeError" ? "unreadable" : error.name);
    results[`${route} ${guessed ? "guessed" : "absent"}`] = {
      fetch: await fetched,
      xhr: await xhr(route, guessed),
    };
  })));
  return results;
}

function socket(route, guessed) {
  return new Promise((resolve) => {
    const url = new URL(route, location.href);
    url.protocol = "ws:";
    if (guessed) url.searchParams.set("token", "isolation-guessed-token");
    const connection = new WebSocket(url);
    const result = { messages: 0, closeCode: null };
    connection.onmessage = () => { result.messages++; };
    connection.onerror = () => {}; // Rejection completes at close, not a sleep.
    connection.onclose = (event) => { result.closeCode = event.code; resolve(result); };
  });
}

// What a window's storage holds under the app's token key and the sentinel's,
// where the artifact can read it, as in the desktop app's partitions.
function storedValues(target) {
  return {
    token: target.localStorage.getItem("store-television-electron"),
    sentinel: target.localStorage.getItem("artifact-isolation-sentinel"),
  };
}

async function appFrame() {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  const loaded = new Promise((resolve) => frame.onload = resolve);
  frame.src = "/";
  document.body.append(frame);
  await loaded;
  const result = readWindow(frame.contentWindow);
  const values = desktop ? storedValues(frame.contentWindow) : undefined;
  frame.remove();
  return { result, values };
}

function desktopAttempts(phase) {
  const bridge = window.__televisionContentBridge;
  const result = {
    globals: Object.fromEntries(["require", "process", "module", "Buffer", "ipcRenderer", "electron"]
      .map((name) => [name, typeof window[name]])),
    televisionGlobals: Object.getOwnPropertyNames(window).filter((name) => /television/i.test(name)).sort(),
    bridgeKeys: Object.keys(bridge).sort(),
    links: {},
  };
  // These values must be refused even with activation. The application URL
  // is attempted only on load: a genuine activated application link is allowed.
  const links = { web: "https://example.com/", file: "file:///tmp/artifact-isolation", script: "javascript:void(0)" };
  if (phase === "load") links.application = "example-app://artifact-isolation";
  for (const [name, url] of Object.entries(links)) result.links[name] = bridge.openApplicationLink(url);
  // Content messages carrying native-channel names must reach the host as
  // content messages and leave native state unchanged.
  for (const type of ["television:disconnect", "television:restart-to-install-update", "television:set-appearance-mode"]) {
    bridge.postToHost({ type, mode: "dark", channel: type });
  }
  result.appWindow = window.open("/", "_blank") === null;
  result.selfWindow = window.open(location.href, "_blank") === null;
  return result;
}

async function run(phase) {
  const results = { activated: navigator.userActivation.isActive, storage: storage() };
  // Do activation-sensitive attempts before the first await.
  if (desktop) results.desktop = desktopAttempts(phase);
  else if (!popup) {
    results.parent = readWindow(parent);
    results.topNavigation = attempt(() => { top.location = "/?isolation-navigation"; });
  }
  const requests = tokenRoutes();
  const sentinel = readSentinel();
  const sockets = Promise.all(["/events", "/acp"].flatMap((route) => [false, true].map(async (guessed) =>
    [route + (guessed ? " guessed" : " absent"), await socket(route, guessed)])));
  // text/plain is CORS-safelisted: this request really reaches authentication
  // without a preflight. The driver also checks its status and server state.
  const posted = fetch("/channels", {
    method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ name: "isolation-created-channel" }),
  }).then((response) => ({ type: response.type, status: response.status }));
  try {
    await navigator.serviceWorker.register("worker.js");
    results.serviceWorker = "registered";
  } catch (error) { results.serviceWorker = error.name; }
  if (desktop) results.values = storedValues(window);
  if (!popup) {
    const framed = await appFrame();
    results.appFrame = framed.result;
    if (desktop) results.appFrameValues = framed.values;
  }
  results.http = await requests;
  results.sentinel = sentinel;
  results.sockets = Object.fromEntries(await sockets);
  results.post = await posted;
  document.getElementById(phase).textContent = JSON.stringify(results);
}

function recordRun(phase) {
  void run(phase).catch((error) => {
    document.getElementById(phase).textContent = JSON.stringify({ error: String(error) });
  });
}
document.getElementById("check").onclick = () => recordRun("click");
document.getElementById("open-app").onclick = () => {
  appWindow = window.open("/", "_blank");
  document.getElementById("app-window").textContent = appWindow ? "opened" : "blocked";
};
document.getElementById("read-app").onclick = () => {
  document.getElementById("app-window").textContent = JSON.stringify(readWindow(appWindow));
};
document.getElementById("open-self").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("popup", "1");
  document.getElementById("self-window").textContent = window.open(url, "_blank") ? "opened" : "blocked";
};
recordRun("load");
