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

The assertions follow the UI testing directives: no duplicate all-artifact
markup test, manifest-validation test, or installation walk is ordered.
Styling and component motion remain with staging and their component owners.
Permanent workshop rendering is review evidence, as described below.

## Test hooks

The browser fixture uses the supported bake root options to produce disposable
documents. It substitutes no component, module loader, or browser mechanism.

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

- **Date shift.** The production module maps July 8, 2026 to the viewer's local date and preserves day gaps and event clock times across month, year, and daylight-saving boundaries. The Sydney case uses a local day that differs from UTC. This proves the arithmetic in the [Productivity date behavior](../../../specs/ui/onboarding-artifacts/index.md#^productivity-relative-dates); the browser assertion below proves that the module executes in the documents — *(policy-grade test: `packages/server/test/onboarding-relative-dates.test.ts`, “shifts authored dates by whole local calendar days”)*. ^oa-ac-date-arithmetic

### Built skill assets

**Seam** — the handoff from baked Company To-dos and Today's Calendar documents
to their built sibling skill assets, crossed through real HTTP and a real
browser. Fixtures are the authored flat frames and manifests, disposable output
from the real bake, and fresh production skill and canonical builds. Expected
task titles, due dates, and event titles come from the authored frame markup.

The fixture server sends those bytes unchanged. It replaces installation and
Television serving, forfeiting those crossings to
[the fresh-install assertion](../../product/onboarding/onboarding-channels.md#^ac-fresh-install).
The standard motion override is used; component CSS motion is outside this
claim and remains with the task and calendar suites. No other mechanism is
mocked. Readiness uses custom-element definitions, generated-node observation,
and stable counts across animation frames. Error observation remains active
through readiness.

The browser clock is fixed to October 2, 2026 at 08:00 in Sydney, when the UTC
date is October 1, 2026. The test asserts the source frame's authored dates,
then checks concrete shifted dates, task labels, and the calendar header after
upgrade.

- Every authored task checkbox upgrades with a real input named from the adjacent task title. Every authored due date renders without the invalid-date result. The calendar upgrades and renders every authored event. Both documents complete without module-load or custom-element errors. These are the browser outcomes required by [the UI testing directives](../../../specs/ui/onboarding-artifacts/index.md#Testing) for the declared [skill dependencies](../../../specs/ui/onboarding-artifacts/index.md#Per-artifact-notes) — *(policy-grade test: `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts`, “authored task and calendar documents show their story dates relative to the viewer's local day”)*. ^oa-ac-skill-assets
- On that known local day, the task heading reads `Friday, October 2` for October 2, 2026, authored July 8, 2026 due dates render as Today, and the other due dates retain their authored day offsets. The calendar starts on October 2, 2026, its rendered header names that day, and every event retains its authored time on that date. These browser results prove the [Productivity date behavior](../../../specs/ui/onboarding-artifacts/index.md#^productivity-relative-dates) — *(policy-grade test: `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts`, “authored task and calendar documents show their story dates relative to the viewer's local day”)*. ^oa-ac-relative-dates

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
