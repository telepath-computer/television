// Company To-dos renders its to-do list live from its artifact's own JSON
// store, whose content the comment beside `getStore()` below describes. The
// page groups the tasks by due date relative to the viewer's local day and
// saves each checkbox toggle as its task's `done`; agents add, change and
// remove tasks with `tv resource json --artifact`, and the page shows the
// result. It has no local-only mode: the checkboxes can be used only while the
// page has the store's value, can use the store and is connected, and the one
// message in the page header says when it is disconnected or cannot use the
// store (specs/ui/onboarding-artifacts/index.md#^productivity-todo-store,
// #^productivity-todo-live, #^productivity-todo-store-problems and
// #^productivity-todo-layout).
const SECTIONS = ["Earlier", "Today", "Upcoming", "Someday"];
const DISCONNECTED = "Disconnected from the server. Changes cannot be saved until the connection returns.";
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The local calendar day of `date`, as YYYY-MM-DD. */
function localDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The task an entry describes, or null without a title; a field of the wrong type counts as absent. */
function taskOf(key, entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (typeof entry.title !== "string" || entry.title.trim() === "") return null;
  const text = (value) => (typeof value === "string" && value !== "" ? value : undefined);
  return {
    key,
    title: entry.title,
    note: text(entry.note),
    due: isCalendarDate(entry.due) ? entry.due : undefined,
    project: text(entry.project),
    tags: Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === "string") ? entry.tags : [],
    done: entry.done === true,
  };
}

function sectionOf(task, today) {
  if (task.due === undefined) return "Someday";
  if (task.due < today) return "Earlier";
  return task.due === today ? "Today" : "Upcoming";
}

/** The sections to show, in order, each with its tasks by due date and then the store's key order. */
function sectionsOf(tasks, today) {
  return SECTIONS.map((heading) => ({
    heading,
    tasks: tasks
      .filter((task) => sectionOf(task, today) === heading)
      .sort((left, right) => ((left.due ?? "") < (right.due ?? "") ? -1 : (left.due ?? "") > (right.due ?? "") ? 1 : 0)),
  })).filter((section) => section.tasks.length > 0);
}

function element(name, attributes = {}, children = []) {
  const node = document.createElement(name);
  for (const [attribute, value] of Object.entries(attributes)) node.setAttribute(attribute, value);
  node.append(...children);
  return node;
}

/** One task's row in the tv-tasks vocabulary, built whole so its checkbox takes its name from the title as it connects. */
function taskRow(task) {
  const meta = [
    ...(task.due === undefined ? [] : [element("tv-task-meta-due", { date: task.due })]),
    ...(task.project === undefined ? [] : [element("tv-task-meta-item", {}, [element("tv-icon", { name: "hash" }), task.project])]),
    ...task.tags.map((tag) => element("tv-task-meta-tag", {}, [tag])),
  ];
  const checkbox = element("tv-task-checkbox", task.done ? { checked: "" } : {});
  return element("tv-task", { id: task.key }, [
    checkbox,
    element("tv-task-body", {}, [
      element("tv-task-title", {}, [task.title]),
      ...(task.note === undefined ? [] : [element("tv-task-note", {}, [task.note])]),
      ...(meta.length === 0 ? [] : [element("tv-task-meta", {}, meta)]),
    ]),
  ]);
}

const list = typeof document === "undefined" ? null : document.querySelector("tv-task-list");
const message = typeof document === "undefined" ? null : document.querySelector("header > p.tv-error");

if (list && message) {
  const dateLine = document.querySelector("header > p:not(.tv-error)");
  if (dateLine) {
    dateLine.textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  let status = "connecting";
  let hasValue = false;
  /** Why the page cannot use the store; once set, it stands until the page reloads. */
  let unusable = null;
  /** Why the last refused save was refused, until a toggle made after it is saved. */
  let refused = null;
  let toggles = 0;
  let refusedAt = 0;
  /** Each shown task's done state as the page last heard it, its own unconfirmed saves included. */
  let done = new Map();
  /** What the shown rows say, but for their done state, so a change of done alone updates rows in place. */
  let shown = null;

  const renderState = () => {
    const usable = hasValue && unusable === null && status === "connected";
    for (const checkbox of list.querySelectorAll("tv-task tv-task-checkbox")) checkbox.toggleAttribute("disabled", !usable);
    const text = unusable ?? refused ?? (status === "disconnected" ? DISCONNECTED : null);
    message.hidden = text === null;
    message.textContent = text ?? "";
  };

  const renderTasks = (snapshot) => {
    const tasks = [];
    snapshot.child("tasks").forEach((child) => {
      const task = taskOf(child.key, child.val());
      if (task !== null) tasks.push(task);
    });
    const sections = sectionsOf(tasks, localDay(new Date()));
    const layout = JSON.stringify(sections.map(({ heading, tasks: rows }) => [heading, rows.map(({ done: _done, ...rest }) => rest)]));
    done = new Map(tasks.map((task) => [task.key, task.done]));
    if (layout === shown) {
      // Only done states changed: update the rows in place, keeping focus where it is.
      for (const row of list.querySelectorAll("tv-task")) {
        row.querySelector("tv-task-checkbox")?.toggleAttribute("checked", done.get(row.id) === true);
      }
      return;
    }
    shown = layout;
    list.replaceChildren(
      ...(sections.length === 0
        ? [element("tv-task-placeholder", {}, ["No tasks"])]
        : sections.map(({ heading, tasks: rows }) =>
          element("tv-task-section", {}, [element("header", {}, [element("h2", {}, [heading])]), ...rows.map(taskRow)]))),
    );
  };

  const reasonOf = (error) => (error instanceof Error ? error.message : String(error));
  const cannotUse = (reason) => {
    unusable = `Company To-dos cannot use its store: ${reason}`;
    renderState();
  };

  const useStore = (sdk) => {
    // The store holds the list: { "tasks": { <key>: <task> } }. The starting
    // tasks have readable keys; a task an agent adds with push is stored under
    // the key that push makes. A task is an object with these fields:
    // - title: string, required, not empty. A short imperative line.
    // - note: string, optional. One brief line.
    // - due: string, optional. A calendar date, YYYY-MM-DD.
    // - project: string, optional. Shown with a # icon.
    // - tags: array of strings, optional. A few short labels.
    // - done: boolean, optional. true when the task is done; false or absent when it is not.
    // The page writes only a task's done, when the person checks the task off
    // or unchecks it. Agents write everything else: they add tasks with push,
    // change and complete them with set, and remove them, by the artifact's ID.
    // The page leaves out an entry without a title, and treats a field of the
    // wrong type, or a due that is not a calendar date, as absent.
    const root = sdk.ref(sdk.getStore());
    sdk.onConnectionStatusChanged((current) => {
      status = current;
      renderState();
    });
    sdk.onValue(
      root,
      (snapshot) => {
        hasValue = true;
        renderTasks(snapshot);
        renderState();
      },
      (error) => cannotUse(reasonOf(error)),
    );

    list.addEventListener("toggle", (event) => {
      const row = event.target.closest("tv-task");
      if (!row || !row.id) return;
      const checkbox = event.target;
      const toggle = ++toggles;
      let saving;
      try {
        saving = sdk.set(sdk.child(root, `tasks/${row.id}/done`), event.checked);
      } catch (error) {
        saving = Promise.reject(error);
      }
      saving.then(
        () => {
          if (toggle > refusedAt) refused = null;
          renderState();
        },
        (error) => {
          // The box shows again what the page last heard: while the page hears
          // the store, the SDK's rollback of this save, or the state before it
          // when the SDK refused it without showing it; once the page has lost
          // the store, what the box last showed. A save lost with the
          // connection shows as the disconnected state, not as an error.
          checkbox.toggleAttribute("checked", done.get(row.id) === true);
          if (error?.code !== "disconnected") {
            refused = `Company To-dos could not save to its store: ${reasonOf(error)}`;
            refusedAt = toggle;
          }
          renderState();
        },
      );
    });
  };

  renderState();
  import("/sdk/v1/resources.js").then(
    (sdk) => {
      try {
        useStore(sdk);
      } catch (error) {
        // Off an artifact page every SDK function refuses with not-artifact-page.
        cannotUse(reasonOf(error));
      }
    },
    () => cannotUse("the resource SDK could not be loaded."),
  );
}
