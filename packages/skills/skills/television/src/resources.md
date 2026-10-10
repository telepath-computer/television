# JSON stores: data every viewer and the agent share

A *JSON store* is a small database that Television keeps on its server, inspired by Firebase's Realtime Database. It keeps an artifact's data durably, shares it live with every client viewing the artifact, and lets you read and write it through the `tv` CLI while the person uses the page.

An artifact's state can live elsewhere too. `localStorage`, cookies and IndexedDB do not work in artifacts, because artifacts run under the CSP sandbox. Touching them, or `sessionStorage`, throws `SecurityError`, so code that cannot avoid touching them, such as a library, has to catch the exception. Television offers no storage that stays in one browser. A Markdown artifact can also act as shared, synchronized, editable state, which the person edits in Television and you edit on disk, but it is editable only within Television: shared through a share link, it is read-only, unlike a JSON store. It also lacks the presentational flexibility and interactivity of an HTML page. State can also live in a third-party API or another external service the artifact integrates with. Which fits depends on the artifact's design, its use and the person, so you decide; for a to-do list, the standard choice is a JSON store.

A JSON store is Television's first type of *resource*: data the server keeps for artifacts. Every HTML artifact has its own JSON store, which its page uses from the resource SDK and you use from the shell with `tv resource json`.

## Every artifact has its own store

Every HTML artifact has its own JSON store, with nothing to create or bind. Its page gets the store from the resource SDK that the server serves:

```js
import { getStore, ref, onValue } from "/sdk/v1/resources.js";

// The store holds: { tasks: { <key>: { title: string, required; done: boolean, required } } }.
// The page checks tasks off; an agent adds tasks.
const db = getStore();
```

Document the store's data in a comment next to that call, as above and as the example below does: each field's type and whether it is required, what the page writes and what agents write. The comment travels with the artifact's files and changes with the code that defines the data, so read it before you write to an artifact's store.

The SDK finds the artifact from the page's own address, so the page needs no setup and no ID, and the call makes no request. Until something writes to the store it has no value: a snapshot of its root has `exists()` false, and the first write creates it. Only artifacts this server serves from its own files have a store; on the page of an artifact that has none, the store's first operation fails with the code `no-store`. SDK errors are `Error` objects with a string `code`, such as `read-only`, `no-store`, `disconnected`, `invalid-path` or `invalid-value`, and a message for people.

## Use the store from the page

The store's functions are inspired by Firebase's Realtime Database, so they will look familiar if you know that API. What they do is described here, and the store keeps your data in its own ways, which [the differences below](#where-the-store-differs-from-firebase) list:

- `ref(db, path)` and `child(ref, path)` make references to paths such as `items/abc/done`.
- `get(ref)` reads once. `onValue(ref, callback)` delivers the current value first, then again after every change. `onChildAdded`, `onChildChanged` and `onChildRemoved` report an object's children in key order, so pushed children arrive in the order they were created. Each listener function takes an optional error callback, which hears when the page loses access, and returns a function that stops listening.
- `set(ref, value)` replaces a value. `update(ref, values)` applies several paths at once, all or nothing. `push(ref, value)` adds a child under a new key and returns its reference at once. That reference is also a promise that settles when the write is confirmed or refused, so `await` it, which gives the new child's reference, or chain `.catch(...)` onto it. `remove(ref)` deletes. `runTransaction(ref, fn)` writes what `fn` returns only if the value has not changed since `fn` saw it, and otherwise calls `fn` again with the current value, up to a limit after which it fails with `max-retries`.
- `serverTimestamp()` and `increment(n)` can stand anywhere in a value you pass to `set`, `push` or `update`, even nested inside objects; the server fills them in. A transaction's function must return plain JSON, so they cannot appear in its result.
- A snapshot has `val()`, `exists()`, `key`, `child(path)`, `forEach(fn)`, `size` and `metadata.hasPendingWrites`.

Use `push` for lists that several clients edit, so additions never collide.

## A complete example

A chores list that the people at 14 Maple Street and their agent share, on its artifact's own store. It renders the list live, adds chores with `push`, saves checkboxes with `set`, clears done chores in a transaction, shows a saving state, says when it is disconnected and disables its controls until the connection returns, and turns read-only when it is opened through a `read` share link. The `tv-tasks` skill exists for building to-do lists for a person; this example leaves it out to keep its focus on using the JSON store.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Maple Street chores</title>
  <link rel="stylesheet" href="/canonical/v2/styles.css">
  <script type="module" src="/canonical/v2/components.js"></script>
  <style>
    body { padding: 32px 32px 64px; }
    ul { list-style: none; padding: 0; }
    .done span { text-decoration: line-through; }
    /* The canonical styles give buttons a display, which would show them while hidden. */
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <header>
    <h1>Maple Street chores</h1>
    <p id="status">Loading…</p>
  </header>
  <form id="add">
    <input name="task" aria-label="New task" placeholder="New task" required>
    <button type="submit">Add</button>
  </form>
  <ul id="items"></ul>
  <button id="clear" type="button">Clear done</button>
  <p id="error" role="alert"></p>
  <script type="module">
    import {
      getStore, onAccessChanged, onConnectionStatusChanged,
      ref, onValue, push, set, runTransaction, serverTimestamp,
    } from "/sdk/v1/resources.js";

    // The store holds the list: { items: { <key>: chore } }, each chore under the key that push made.
    // A chore has these fields:
    // - title: string, required. The chore, as one short line.
    // - done: boolean, required. true once the chore is done, false until then.
    // - createdAt: number, optional. When the page added the chore, in milliseconds since 1970; the server fills it in.
    // The page adds chores with push, checks them off, and clears done ones in a transaction.
    // An agent adds chores with push, and marks one done by setting items/<key>/done to true.
    const db = getStore();
    const items = ref(db, "items");
    const form = document.querySelector("#add");
    const list = document.querySelector("#items");
    const clear = document.querySelector("#clear");
    const status = document.querySelector("#status");
    const error = document.querySelector("#error");
    let readOnly = false;
    let noAccess = false;
    let disconnected = false;
    let saved = "Loading…";

    function report(failure) {
      // A write cut off by a lost connection may still have been saved.
      error.textContent = failure.code === "disconnected"
        ? "A change may not have been saved: the connection was lost before the server confirmed it."
        : `${failure.code}: ${failure.message}`;
    }

    function showStatus() {
      status.textContent = noAccess
        ? "This page no longer has access to the list."
        : disconnected ? "Disconnected: changes are not saved until the connection returns." : saved;
    }

    // The controls that write: hidden while the page can only read, which
    // refuses writes, and disabled while disconnected, when writes fail at once.
    function applyControls() {
      form.hidden = readOnly;
      clear.hidden = readOnly;
      for (const control of [...form.elements, clear, ...list.querySelectorAll("input")]) {
        control.disabled = readOnly || disconnected;
      }
    }

    // "read" through a read-only share link, and null once the page has no
    // access at all, as after the link it was opened through is revoked.
    onAccessChanged((access) => {
      readOnly = access !== "read-write";
      noAccess = access === null;
      showStatus();
      applyControls();
    });

    onConnectionStatusChanged((current) => {
      disconnected = current === "disconnected";
      showStatus();
      applyControls();
    });

    // The current value first, then every change, this page's own writes at once.
    onValue(items, (snap) => {
      saved = snap.metadata.hasPendingWrites ? "Saving…" : "Saved";
      showStatus();
      list.replaceChildren();
      snap.forEach((item) => {
        const { title = "", done = false } = item.val() ?? {};
        const row = document.createElement("li");
        const label = document.createElement("label");
        const box = document.createElement("input");
        const text = document.createElement("span");
        box.type = "checkbox";
        box.checked = done === true;
        box.disabled = readOnly || disconnected;
        box.addEventListener("change", () => {
          set(ref(db, `items/${item.key}/done`), box.checked).catch(report);
        });
        text.textContent = title;
        row.className = done === true ? "done" : "";
        label.append(box, " ", text);
        row.append(label);
        list.append(row);
      });
    }, report);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = form.elements.task.value.trim();
      if (title === "") return;
      // The new chore shows at once; the server fills in createdAt.
      push(items, { title, done: false, createdAt: serverTimestamp() }).catch(report);
      form.reset();
    });

    clear.addEventListener("click", () => {
      // Rewrites the list only if nobody changed it meanwhile; returning undefined aborts.
      runTransaction(items, (current) => {
        if (current === undefined || current === null) return undefined;
        return Object.fromEntries(Object.entries(current).filter(([, chore]) => chore.done !== true));
      }).catch(report);
    });
  </script>
</body>
</html>
```

Add `?authoredForAppVersion=<version>` to the stylesheet link as the HTML artifact style section describes.

## Work on the list as the agent

You work on the same list from the shell, addressing the artifact's store by the artifact's ID and following the comment beside `getStore()`, and the page shows each change at once:

```bash
tv resource json push --artifact <artifact-id> items '{"title":"Take out the recycling","done":false}'
tv resource json set --artifact <artifact-id> items/<key>/done true
```

`<artifact-id>` is the ID that `tv create-path-artifact` printed; `tv list-artifacts` lists them. `push` prints the new chore's key as `{"key":"<key>"}`, and the second command marks that chore done. Values from the shell are plain JSON, so a chore you add has no `createdAt`; the page sets it only for the chores it adds.

## Read and change the store from the shell

```bash
tv resource json get    --artifact <artifact-id> [<path>]
tv resource json set    --artifact <artifact-id> [<path>] <value>
tv resource json update --artifact <artifact-id> [<path>] <values>
tv resource json push   --artifact <artifact-id> <path> <value>
tv resource json remove --artifact <artifact-id> <path>
tv resource json watch  --artifact <artifact-id> [<path>]
```

`get` prints `{"exists":true,"value":…}`, or `{"exists":false}` when the path has no value, as for the store of an artifact nothing has written yet. `set`, `update` and `remove` print `JSON store of artifact <artifact-id> updated.` A value is JSON text given as one argument, or read from the file `--file <path>` names, where `-` reads standard input; values given on the command line are plain JSON. `update` takes an object whose keys are paths relative to `<path>`. `watch` prints the current value, then the latest value whenever it changes, until interrupted. When changes come faster than it reads them, it skips the values in between, so once they stop its last line is what the store holds; use it to follow the current state, not to record every step.

## Do not edit a store's files directly

The server keeps each store's data in a `content.json` file under its home. Do not edit a store's files directly; change the store with `tv resource json`. A command changes only the paths it names, is validated, takes its place in order with the page's writes, and reaches every client viewing the artifact. An edit of the files replaces the whole value, can silently drop a write that a page makes meanwhile, and is overwritten by the server's next write to the store. Reading a store's `content.json` directly is fine. Editing its files is a recovery step, taken only while the server is stopped.

## A page sees its own writes at once

The SDK shows a page's write to the page's listeners at once, then sends it to the server. Listeners see the server's value with the page's unconfirmed writes applied in order. When the server refuses a write, for example because the share link the page was opened through became `read`, the write is rolled back and its promise rejects, so catch the rejection and tell the person.

A snapshot's `metadata.hasPendingWrites` is true while it includes unconfirmed writes. When the last one is confirmed, `onValue` listeners receive a snapshot with `hasPendingWrites` false even when the value did not change, so read it in an `onValue` listener to show a saving state:

```js
onValue(ref(db, "items"), (snap) => {
  status.textContent = snap.metadata.hasPendingWrites ? "Saving…" : "Saved";
});
```

Child-event callbacks are not called for a confirmation that changes no child, so watch the saving state with `onValue`. Values from `serverTimestamp()` and `increment()` are estimated at once and replaced by the server's values when it confirms.

## When the connection is lost

There is no offline mode. While the page is disconnected from its server, `get`, `set`, `update`, `remove`, `runTransaction`, `push` with a value and `getAccess` fail at once with the code `disconnected`, and a write that fails this way is never shown. When the connection is lost, the SDK rolls back the page's unconfirmed writes and rejects their promises with `disconnected`. Such a write may still have been applied, because the server may have received it before the loss, so tell the person it may not have been saved, as the example does, rather than that it was lost. Listeners stay registered, including ones added while disconnected, and the SDK reconnects on its own; each listener then hears the current value, which includes any write the server applied.

Show the person when their changes cannot be saved, and disable the controls that write until the connection returns, as the example does:

```js
onConnectionStatusChanged((current) => {
  disconnected = current === "disconnected";
  showStatus();
  applyControls();
});
```

The status is `connecting` while a connection opens, when reads and writes wait for it rather than fail; `connected` once it is open; `disconnected` from a loss until the SDK reconnects; and `idle` while the page uses nothing that needs a connection. `getConnectionStatus()` reads it without opening a connection. A status callback hears the status soon after you register it, then each change, and keeps the connection open.

## Where the store differs from Firebase

The store keeps plain JSON exactly as written:

- `set(ref, null)` stores `null`; it does not delete. Delete with `remove(ref)`, or with `deleteValue()` as an entry in `update`.
- A path with no value is different from `null`: its snapshot's `exists()` is false and its `val()` is `undefined`.
- Arrays stay arrays. You can read into one and `set` an existing element, but you insert, delete or reorder elements by writing the whole array, directly or in a transaction.
- `{}` and `[]` are stored as written. Object keys must be non-empty and contain no `/`.

## What does not exist

Some Firebase APIs that agents reach for have no counterpart here:

- Queries do not exist: there is no `orderByChild`, `orderByKey`, `orderByValue`, `limitToFirst`, `limitToLast`, `startAt`, `endAt` or `equalTo`. Read the location and sort or filter in the page.
- `onDisconnect` does not exist.
- Offline persistence does not exist, and there is no offline queue.
- There is no `initializeApp` or `getDatabase`: `getStore()` is the whole setup.

## Check the access level

A page opened through a `read` share link can read its artifact's store but not write it: the server refuses its writes with the code `read-only`, and once the page knows its level the SDK refuses them before showing them. Check the level and render a read-only view, without the controls that edit, as the example does:

```js
onAccessChanged((access) => {
  form.hidden = access !== "read-write";
});
```

Keep the example's `[hidden]` rule when you hide controls this way: the canonical styles give buttons a `display`, which overrides the `hidden` attribute, so without the rule a hidden button still shows.

`onAccessChanged` calls back with the level once the page's connection has opened, then with each change, since a share link's level can change while the page is open. The level is `"read-write"` at the artifact's own address and the link's level through a share link. It is `null` when the page's address reaches no artifact that has a store, as after the share link it was opened through is revoked, and the page then has no access at all. `getAccess()` resolves with the level once, and rejects with the code `no-store` instead of resolving with `null`.

## Share an artifact

When the person asks to share an artifact with someone, give them its share link, never the artifact's own address: anyone who can load the artifact's own address can read and write its store.

```bash
tv share-artifact --id <artifact-id>
tv share-artifact --id <artifact-id> --access read-write
tv unshare-artifact --id <artifact-id>
```

`tv share-artifact` creates the artifact's share link and prints it once for each address the server can be reached at, each of the machine's addresses when it listens on every interface, in the form `http://<host>:<port>/artifact/<share-id>/`; give the person the one whose host the people they share with can reach. A page opened through the link reaches the artifact's store at the link's level. Without `--access` the link is `read`, so share at `read-write` only when the person wants the people they share with to change the data. A Markdown artifact is shared only at `read`: its shared page is a static rendered page that no one can edit through the link, so `--access read-write` is refused for it. Running the command again with the other level changes the link's level without changing the link, and pages already open through it hear the change. Leaving out `--access` never changes a link's level: when the link is already `read-write`, the command refuses, and you give `--access read-write` to keep it or `--access read` to make it read-only. `tv unshare-artifact` revokes the link: it stops working for everyone who holds it, the pages open through it lose their access, and sharing again later gives a different link. Only artifacts this server serves from its own files can be shared, and only while the server requires its auth token.

The link never reveals the artifact's ID, as long as the artifact does not reveal it either. Keep the artifact's own links relative, such as `href="notes.html"` or `href="sub/"`, so that its ID never appears in what a share viewer receives; an absolute link to `/artifact/<artifact-id>/…` would hand it to them.

## Keep IDs and secrets out of source and data

Never put an artifact ID, share ID, token or other secret in artifact source or in the data its store holds: a share viewer's page receives the store's data as it receives the source. The SDK finds the artifact from the page's own address, so the page needs no ID, and you address the store from the shell with `--artifact`.
