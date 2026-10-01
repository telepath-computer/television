// Skillbench v1 — read-only (specs/arch/skills/skillbench.md). Loads the
// eval config named by ?eval=<repo-rel path>, lists its jobs, shows the
// active job's artifact at the selected size with its prompt alongside.

const $ = (sel) => document.querySelector(sel);

const evalPath = new URLSearchParams(location.search).get("eval");

let state = { dir: "", jobs: [], sizes: [], active: null, size: null };

function fail(message) {
  const empty = $(".artifact-empty");
  empty.textContent = message;
  empty.hidden = false;
  $(".artifact").hidden = true;
}

async function boot() {
  if (!evalPath) {
    fail("No eval config — load /skillbench/?eval=<path to eval.json>");
    return;
  }
  const [evalRes, sizesRes] = await Promise.all([
    fetch(`/skillbench/api/eval?path=${encodeURIComponent(evalPath)}`),
    fetch("/skillbench/sizes.json"),
  ]);
  if (!evalRes.ok) {
    const error = await evalRes.json().catch(() => ({}));
    fail(error.error ?? `Failed to load ${evalPath}`);
    return;
  }
  if (!sizesRes.ok) {
    fail("Failed to load sizes.json");
    return;
  }
  const data = await evalRes.json();
  state.dir = data.dir;
  // Jobs with output first (config order preserved); not-run jobs at the bottom.
  state.jobs = [...data.jobs.filter((j) => j.hasOutput), ...data.jobs.filter((j) => !j.hasOutput)];
  if (state.jobs.length === 0) {
    fail("This eval config has no jobs");
    return;
  }
  state.sizes = (await sizesRes.json()).sizes;
  state.size = state.sizes[0];

  const select = $(".size");
  for (const size of state.sizes) {
    const option = document.createElement("option");
    option.textContent = size.label;
    select.append(option);
  }
  select.addEventListener("change", () => {
    state.size = state.sizes[select.selectedIndex];
    render();
  });

  state.active = state.jobs.find((j) => j.hasOutput) ?? state.jobs[0] ?? null;
  renderJobs();
  render();
}

function renderJobs() {
  const list = $(".jobs");
  list.replaceChildren();
  for (const job of state.jobs) {
    const row = document.createElement("li");
    row.textContent = job.name;
    if (!job.hasOutput) {
      row.classList.add("no-output");
      const suffix = document.createElement("span");
      suffix.className = "not-run";
      suffix.textContent = " — not run yet";
      row.append(suffix);
    }
    row.addEventListener("mousedown", () => {
      state.active = job;
      renderJobs();
      render();
    });
    if (job === state.active) row.classList.add("active");
    list.append(row);
  }
}

function render() {
  const job = state.active;
  const iframe = $(".artifact");
  const empty = $(".artifact-empty");
  $(".prompt").value = job ? job.prompt : "";
  if (!job) return;

  iframe.width = state.size.width;
  iframe.height = state.size.height;
  iframe.style.width = `${state.size.width}px`;
  iframe.style.height = `${state.size.height}px`;

  if (job.hasOutput) {
    empty.hidden = true;
    iframe.hidden = false;
    iframe.title = `${job.name} — eval output`;
    const segments = [state.dir, job.cwd, "index.html"]
      .join("/")
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    iframe.src = `/skillbench/files/${segments}`;
  } else {
    iframe.hidden = true;
    iframe.removeAttribute("src");
    empty.hidden = false;
  }
}

boot().catch((error) => fail(String(error)));
