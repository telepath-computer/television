*How the sidebar-view skill's surface is proven: its resizable sidebar's shared width, walked in a real browser against a running server, while the skill's other points stay untested as a prototype's.*

# Sidebar view (UI) — proof

Proves [specs/ui/skills/sidebar-view/index.md](../../../../specs/ui/skills/sidebar-view/index.md).

## Coverage model

The skill is an unregistered prototype ([its architecture](../../../../specs/arch/skills/sidebar-view.md)), so no skills build emits it. The walk below serves the carried `sidebar.css` and `sidebar.js` from the skill's source folder, beside a page in the markup `SKILL.md` teaches, and no test asserts that the skill is built or published.

One acceptance walk proves the resizable boundary and the shared width. The built CLI serves the artifact. Real Chromium shows it in the app to two people who hold the server's token, and opens its `read` share link in a third browser context that holds none. The drags are real mouse input. The walk reads the stored width with `tv resource json get`, so it also proves where [the architecture](../../../../specs/arch/skills/sidebar-view.md#Storage) keeps the width. It drags past the maximum width but not below the minimum. The two views in the app use the standing CSS-motion override, and no point here involves CSS motion. Nothing else is mocked.

The other points have no tests: selection, the views it shows, label truncation, which the skill does not implement ([known gap](../../../../specs/arch/skills/sidebar-view.md#Known gap)), and the authoring points, which `SKILL.md` teaches. They have had none while the skill has been a prototype, and [its prototype boundary](../../../../specs/arch/skills/sidebar-view.md#Prototype and publication boundary) requires conformance proof for the carried files before the skill is registered. [Making skills](../../../arch/making-skills.md#^making-skills-t-authored-app-version) checks the canonical stylesheet guidance in the skill's `SKILL.md`.

## Test hooks

The walk launches Chromium with [the resources proof's host-name mapping](../../../product/resources/resources.md#Test hooks), which changes no Television mechanism.

## Assertions

- **Acceptance** (boundary: the built `tv` CLI as spawned processes and the server it starts, which requires its token, and real Chromium with three browser contexts: two open the app holding the token and show the artifact in its frame, and the third opens the artifact's `read` share link as a page of its own, holding no token; fixture: a folder artifact registered with `tv create-path-artifact`, holding the carried `sidebar.css` and `sidebar.js` copied from the skill's source folder and an `index.html` in the markup `SKILL.md` teaches; real mouse input drags the boundary; the host-name mapping is the test hook above; the standing CSS-motion override in the app's two views is the only mock): before any resize, both people's views show the sidebar at its default width, and the artifact's store holds nothing at `tv-sidebar-view/width`. Dragging the boundary past the maximum in the first person's view leaves the sidebar at its maximum width there and, without a reload, in the second person's view, and the store holds that width as a number at `tv-sidebar-view/width`. The share link's view then opens at that width. Dragging there resizes that sidebar to the pointer, while the other two views and the stored width stay as they were; after a reload, the share link's view shows the stored width again. No page reports an error. This proves the [sidebar's resizable, shared width](../../../../specs/ui/skills/sidebar-view/index.md) and [where the architecture keeps it](../../../../specs/arch/skills/sidebar-view.md#Storage) — *(policy-grade test: `test/node/sidebar-view-width.test.ts` "is shared through the artifact's store by everyone viewing it, while a read share link's viewer resizes it only for themselves")*. ^sv-ac-width
