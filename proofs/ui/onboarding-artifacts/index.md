*How onboarding design sources are proven through the bake and the browser components they use.*

# Onboarding artifact designs (UI) — proof

Proves [specs/ui/onboarding-artifacts/index.md](../../../specs/ui/onboarding-artifacts/index.md).

## Coverage model

The authoritative frames are the artifact markup and CSS, so comparing each
render with its own source would establish no implementation boundary. The
[bake proof](../../arch/onboarding/bake.md#^t-baked-content) owns the conversion
of every flat frame into its complete HTML document, the unchanged Markdown
copy, and the packaged skill files.

One real-browser seam loads freshly baked task and calendar documents with
freshly built skill and canonical assets. A fixture HTTP server replaces
Television installation and serving. Those crossings are covered by
[product acceptance](../../product/onboarding/onboarding-channels.md#^ac-fresh-install).
Module loading and custom-element upgrades remain real.

A second real-browser seam loads Company To-dos as an installed artifact of a
really-running Television server, with its store as installation left it, as
the live-list testing directive requires. It crosses the to-do store module,
the served resource SDK, and the installed store with its starting tasks
without mocks.

The assertions follow the UI testing directives: no duplicate all-artifact
markup test, manifest-validation test, or installation walk is ordered.
Styling and component motion remain with staging and their component owners.
Permanent workshop rendering is review evidence, as described below.

## Test hooks

The browser fixture uses the supported bake root options to produce disposable
documents. It substitutes no component, module loader, or browser mechanism.

The Company To-dos seam uses
[the resources proof's host-name mapping](../../product/resources/resources.md#Test hooks)
and, where an assertion names it,
[the SDK proof's network proxy](../../arch/resources/sdk.md#Test hooks).
Two assertions also act on the page's request for `/sdk/v1/resources.js`
through Playwright's request routing. One holds the request until the test
releases it, then lets it continue to the server unchanged, so the store's
first value is delayed. The other fails the request, so the module's import of
the SDK rejects. Production pages load the SDK through neither.

## Assertions

### Design-to-package boundary

[Baked content and shell](../../arch/onboarding/bake.md#^t-baked-content)
orders exact output for every authored `<slug>.frame` and `<slug>.md`,
including optional styles, canonical components, and declared skill assets.
[Input validation](../../arch/onboarding/bake.md#^t-input-contract) and
[configuration updates](../../arch/onboarding/bake.md#^t-config-update)
cover manifest validity and artifact order. These assertions remain owned by
the bake proof; this proof adds no second comparison of those outputs.

### Local-day arithmetic

- **Date shift.** The production date module maps July 8, 2026 to the viewer's local date and preserves day gaps and event clock times across month, year, and daylight-saving boundaries. The Sydney case uses a local day that differs from UTC. This proves the arithmetic in the [Productivity date behavior](../../../specs/ui/onboarding-artifacts/index.md#^productivity-relative-dates); the browser assertion below proves that the module executes in the documents — *(policy-grade test: `packages/server/test/onboarding-relative-dates.test.ts`, “shifts authored dates by whole local calendar days”)*. ^oa-ac-date-arithmetic

### Built skill assets

**Seam** — the handoff from baked Company To-dos and Today's Calendar documents
to their built sibling skill assets, crossed through real HTTP and a real
browser. Fixtures are the authored flat frames and manifests, disposable output
from the real bake, and fresh production skill, canonical and resource SDK
builds. Expected event titles come from the authored frame markup.

The fixture server sends those bytes unchanged. It serves the SDK at
`/sdk/v1/resources.js`, where Television serves it beside every artifact, so
Company To-dos' to-do store module loads it. The documents are not served as
artifact content, so the SDK refuses, and Company To-dos shows its error and
no task; the documents must still load without module-load errors. Company
To-dos' tasks render only from its store, which the
[live-list seam](#Company To-dos as a live list) installs. The fixture server replaces
installation and Television serving, forfeiting those crossings to
[the fresh-install assertion](../../product/onboarding/onboarding-channels.md#^ac-fresh-install).
The standard motion override is used; component CSS motion is outside this
claim and remains with the task and calendar suites. No other mechanism is
mocked. Readiness uses custom-element definitions, generated-node observation,
and stable counts across animation frames. Error observation remains active
through readiness.

The browser clock is fixed to October 2, 2026 at 08:00 in Sydney, when the UTC
date is October 1, 2026. The test asserts the source frame's authored dates,
then checks concrete shifted dates and the calendar header after upgrade.

- Company To-dos, which cannot use its store outside artifact content, shows no task, and the message in its page header says that it cannot use its store and gives the reason from the SDK's `not-artifact-page` refusal. The calendar upgrades and renders every authored event. Both documents complete without module-load or custom-element errors. These are the browser outcomes required by [the UI testing directives](../../../specs/ui/onboarding-artifacts/index.md#Testing) for the declared [skill dependencies](../../../specs/ui/onboarding-artifacts/index.md#Per-artifact-notes), and the error of [Company To-dos' problem states](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store-problems) for a page not served as artifact content — *(policy-grade test: `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts`, “authored task and calendar documents load their built assets, and the calendar shows its story dates relative to the viewer's local day”)*. ^oa-ac-skill-assets
- On that known local day, the calendar starts on October 2, 2026, its rendered header names that day, and every event retains its authored time on that date. These browser results prove the [Productivity date behavior](../../../specs/ui/onboarding-artifacts/index.md#^productivity-relative-dates) for Today's Calendar; Company To-dos' date line and due dates are [the live-list seam](#^oa-ac-todo-render)'s — *(policy-grade test: `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts`, “authored task and calendar documents load their built assets, and the calendar shows its story dates relative to the viewer's local day”)*. ^oa-ac-relative-dates

### Company To-dos as a live list

**Seam** — the handoff from the installed Company To-dos document's to-do
store module to the resource SDK and the artifact's own store, crossed
through a really-running in-process Television server and a real browser. The
fixtures are disposable output from the real bake of the authored Productivity
channel, which the server installs through the real onboarding installer over
temporary storage, so the store and its starting tasks, with their dates moved
to the installation day, come from the declared starting value. The test
takes the installation day from the installed store, where the starting tasks
authored on the story day are due, and fixes the browser's clock to that local
day. Changes from outside the page go through the store's administrative
routes with the shared client, as `tv resource json` makes them. The browser
reaches the server at a plain-HTTP host name that is not `localhost`, through
the network proxy where an assertion names it, and two assertions hold or fail
the SDK's download, as [declared above](#Test hooks). The standard motion
override is used; no other mechanism is mocked. Each assertion also finds no
uncaught error in the page.

- The page header is the list's previous sibling and its date line names the
  installation day in the `Wednesday, July 8` form. The list shows the
  starting tasks in the sections *Earlier*, *Today* and *Upcoming*, in that
  order: the task four days before the installation day under *Earlier*, the
  three due that day under *Today* in key order, and the two after it under
  *Upcoming* in due-date order. Each row shows its task's title, note,
  project and tags as the store holds them; each checkbox upgrades with a real
  input named from its row's title and is unchecked; each due date renders
  without the invalid-date result, the earlier one as overdue. This proves the
  starting content of
  [Company To-dos' store](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store),
  [its rendering](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-live)
  and [its header's place](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-layout),
  as the browser outcomes of [the UI testing directives](../../../specs/ui/onboarding-artifacts/index.md#Testing)
  for the task document —
  *(policy-grade test: `packages/server/test/e2e/onboarding-company-todos.spec.ts` “renders the installed starting tasks from the store in their sections under a header that directly precedes the list”)*. ^oa-ac-todo-render
- While the page's request for the SDK is held, the list shows no task; once
  it is released and the store's first value has arrived, the tasks show with
  every checkbox enabled. Checking a task stores `true` at its
  `tasks/<key>/done`, as the server's store shows, and unchecking it stores
  `false`; after the page reloads, each checkbox shows what the store holds.
  This proves the toggling and enabling of
  [Company To-dos' rendering](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-live)
  and the empty list before the first value of
  [its problem states](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store-problems) —
  *(policy-grade test: `packages/server/test/e2e/onboarding-company-todos.spec.ts` “shows no task until the store's first value, saves each toggle as the task's done, and shows the stored state after a reload”)*. ^oa-ac-todo-store
- With the page open, changes from outside appear without a reload: a task
  pushed with a due date of the installation day appears under *Today* with
  its title and metadata; setting another task's `done` to `true` checks it
  where it stands; changing a task's `due` to a later day moves it to
  *Upcoming*, and changing its `title` changes its row; a task pushed without
  `due` appears under *Someday*; removing a task removes its row; an entry
  without a `title` shows nothing, and a task whose `due` is not a calendar
  date shows under *Someday*; removing every task shows the placeholder, and
  pushing one again shows it. This proves that
  [Company To-dos renders the store live](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-live)
  as an agent changes it —
  *(policy-grade test: `packages/server/test/e2e/onboarding-company-todos.spec.ts` “shows tasks added, changed, completed and removed from outside without a reload”)*. ^oa-ac-todo-live
- With the store's `content.json` replaced by bytes that are not JSON and the
  server restarted, the page loads with no task shown, the message in the
  page header says that it cannot use its store and gives the reason from the
  SDK's `unavailable` refusal, and the file is unchanged. On a page opened
  through the artifact's share link at `read-write`, once its checkboxes are
  enabled, revoking the link shows the same message with the reason from the
  SDK's `no-store` refusal and disables every checkbox, and the list keeps
  what it last showed. This proves the case of
  [Company To-dos' problem states](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store-problems)
  in which the page cannot use the store, as it loads and later, with the
  list keeping what it last showed —
  *(policy-grade test: `packages/server/test/e2e/onboarding-company-todos.spec.ts` “when it cannot use its store, shows the error in the header, at load with no task and when its share link is revoked later with the list as it last showed”)*. ^oa-ac-todo-store-lost
- With the page's request for the SDK failed, the list shows no task, and the
  message in the page header says that the page cannot use its store because
  the resource SDK could not be loaded; nothing is written to the store. This proves the case of
  [Company To-dos' problem states](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store-problems)
  in which the SDK does not load —
  *(policy-grade test: `packages/server/test/e2e/onboarding-company-todos.spec.ts` “when the SDK fails to load, shows no task and the error”)*. ^oa-ac-todo-store-no-sdk
- On a page opened through the artifact's share link at `read-write`, through
  the network proxy holding traffic in both directions, a task's checkbox is
  toggled and the link's level is changed to `read`. On release, the server
  refuses the save, the checkbox returns to what the store holds, the message
  in the page header gives the reason from the `read-only` refusal, every
  checkbox stays enabled, and the store is unchanged. Once the page has heard
  the level change, toggling a second task's checkbox, which the SDK refuses
  before showing it, returns that checkbox the same way with the same error.
  After the link's level is changed back to `read-write` and the page has
  heard it, toggling a checkbox stores it and the message goes. This proves the
  refused save of
  [Company To-dos' problem states](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store-problems) —
  *(policy-grade test: `packages/server/test/e2e/onboarding-company-todos.spec.ts` “returns a refused save's checkbox to the stored state and shows the error, keeping every checkbox enabled, until a later toggle is saved”)*. ^oa-ac-todo-store-refused
- Through the network proxy, holding only the page's write messages, a task's
  checkbox is toggled and the proxy then severs the page's connection and
  refuses new ones. The checkbox returns to what the store holds, the message
  in the page header says that the page is disconnected, every checkbox is
  disabled, and no error is shown. Another client marks a second task done
  meanwhile. When the proxy accepts again, the message is hidden, every
  checkbox is enabled, the second task shows as done and the first as the
  store holds it, and a toggle is then saved. This proves the disconnected
  state of
  [Company To-dos' problem states](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store-problems),
  the checkboxes' enabling while
  [connected](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-live),
  and the message's place in
  [the header](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-layout) —
  *(policy-grade test: `packages/server/test/e2e/onboarding-company-todos.spec.ts` “while disconnected, says so in the header with every checkbox disabled and no error, and follows the store again when the connection returns”)*. ^oa-ac-todo-store-disconnected

Every way the page can lose its store, such as its artifact's deletion while
the page is open, reaches the module as the same subscription error as the
two cases above, with its own code, and the module shows it in the same way,
so it needs no browser case of its own; a module that branched on the code
would need a case per branch. An installed Company To-dos always has a store,
and a store of another type cannot arise while `json` is the only type. A
page not served as artifact content, where the SDK loads and refuses, is the
[skill-assets assertion](#^oa-ac-skill-assets)'s case. The gap that
`tv-tasks`' page styles put between a header and the list is the skill's,
proven by its own suite for a header that ends with its subtitle or with a
message, as Company To-dos' does
(`packages/skills/skills/tv-tasks/test/e2e/task-header.e2e.test.ts`). The
frame's spacing of its message below the date line is styling, judged in
review under [UI testing policy](../../../specs/arch/testing-policy.md#^ui-styling-out).
The assertions above prove only the structure both depend on.

The installer proof owns configured-or-default page creation. The artifact
product and architecture proofs own document loading, isolation, interaction,
and theme reload. The task and calendar suites own full component behavior;
this seam establishes that these authored documents and their packaged
dependencies work together.

## Staging boundary

The [permanent workshop](../../../specs/ui/onboarding-artifacts/index.md#Staging)
contains thirteen standalone documents and four channel views. It uses the
authored frames and Markdown, manifest order and page settings, and the stage
and artifact-frame compositions. Workshop imports supply task and calendar
source components; the Markdown view uses the product Markdown pipeline.
These source previews are distinct from the built-asset seam above.

Availability, source composition, and preview dependency wiring are assessed
in implementation review. Under [staging policy](../../../specs/staging.md#Staging-code),
staging has no automated harness. This proof orders no staging test suite or
manual QA procedure. Visual styling is judged in staging and review under
[UI testing policy](../../../specs/arch/testing-policy.md#^ui-styling-out).

The permanent entries are declared in [frameset.json](../../../frameset.json).
The [manifest adapter](../../../frames/lib/onboarding.ts),
[artifact environment](../../../frames/lib/onboarding-artifact.ts), and
[Markdown adapter](../../../frames/lib/onboarding-markdown.ts) are the
implementation-review evidence for source and dependency selection. Browser
inspection loaded all seventeen entries and their nested documents without
page or request errors. Visual review covered the welcome at 800px, 360px,
300px, and 230px in light and dark appearances, and the upgraded task and
calendar documents. The 300px and 230px views had no horizontal overflow.
Shared appearance/theme changes reached the nested documents, and tab changes
preserved task state. These observations establish preview behavior, not the
built-asset delivery covered above.

Calendar event-title contrast was also reviewed with source and packaged
assets in light and dark appearances under the default and Nord themes. The
shared calendar stylesheet uses dark ramp ink against the documented light
event palettes; the workshop supplies no color override.
