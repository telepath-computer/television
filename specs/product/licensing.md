*Television's licensing promises: the project is MIT and every published package and the desktop application say so, every shipped artifact carries the licenses and attributions of the third-party code and assets it redistributes, and the standard test suites block unacceptably-licensed dependencies from shipping.*

# Licensing

Television is built on many open-source packages whose licenses require that their copyright and permission notices travel with any copy of their code — including the copies inside our bundled, minified artifacts. This spec records what Television promises about its own license and about honoring those third-party requirements, in every form the product ships.

## What this owns

This spec owns the **licensing policy**: Television's own license, copyright notice, and trademark statement, the promise that shipped artifacts carry the third-party attributions they owe, the acceptability constraint on shipped dependencies' licenses (the allowlist and its recorded exceptions), and the enforcement promise. It is implementation-agnostic: how notices are generated, which build hooks and files implement the policy, and how the suite-run gate enforces it are owned by [arch/licensing.md](../arch/licensing.md).

## Television is MIT

Television's own code is licensed under the MIT license. Concretely: ^licensing-mit

- The repository root carries the MIT `LICENSE` file, the single source of the license text. Its copyright notice reads exactly `Copyright (c) 2026 Unternet PBC` — pinned here because the copyright line is legal content, product-spec authority, not an implementation choice a build engineer should guess at. ^licensing-copyright-line
- After the MIT text, separated by a blank line, the root `LICENSE` carries exactly: `The Television name and logo are trademarks of Unternet PBC and are not licensed under the MIT license.`
- Every published package carries a `LICENSE` file at its package root, and the desktop application carries one inside the app. Each copy is byte-identical to the root file, because the copy *is* the license users receive — divergent copies would mean divergent grants. ^licensing-license-files
- Every workspace manifest — published or private — declares `"license": "MIT"`. Published manifests matter most: a package on npm with no license field reads as "all rights reserved," the opposite of what we intend. Private workspaces declare it too so no manifest is ambiguous about the code's terms. ^licensing-manifest-field

## Shipped artifacts carry third-party notices

A *shipped surface* is a part of Television through which the project delivers code or assets to someone outside the project. **This spec is the authority for the product areas that require the licensing framework's attention:** ^licensing-surface-list

- the published CLI package;
- the [desktop application](./desktop-app.md), which ToDesktop builds;
- the browser client;
- the markdown view;
- the `tv-calendar` skill;
- the `tv-tasks` skill;
- the public source repository. ^licensing-source-surface

The implementation mapping — surface identifiers, build inventories, and CLI aggregation — is owned by [the architecture spec](../arch/licensing.md#^licensing-declared-surfaces) and must follow this list. The list is a reviewed product decision: adding or removing a product area that redistributes third-party material starts with a change here.

Only `tv-calendar` and `tv-tasks` among Television's four bundled skills ship JavaScript. The `television` bundle — including its `SKILL.md` and `theming.md` guidance — and `tv-table` carry only first-party instructions, so they need no licensing-framework surface. This distinction is explicit because a directory or package count cannot determine which skills require licensing attention.

Across the listed areas, third-party material arrives through bundled executables and browser code, prebuilt onboarding artifacts, installed skill files, bundled themes, and *vendored assets* tracked in Television's source tree rather than consumed as package dependencies. A clone of the public repository delivers vendored assets before any build runs, which is why the repository is a surface in its own right. The vendored-asset manifest and its contents are owned by [arch/licensing.md](../arch/licensing.md).

The promise: **every shipped surface that redistributes third-party material carries that material's license and attribution**, as its license requires (for the permissive licenses we accept, that means the real upstream copyright and permission notices — never placeholder boilerplate — and, for licenses that require it, the license text). A user who receives a Television artifact has received, with it, the notices for the third-party packages inside it — including a skill or a bundled theme after Television has copied it out of the package. ^licensing-notices-promise

**A bundled theme that includes externally licensed material redistributes third-party material.** The material can be anything a theme carries: a color scheme, an image, a font, code. Color values taken from a licensed upstream project, such as Nord, count: Television treats them as a substantial portion of that project. Television attributes each such material in three places: ^licensing-theme-material

- a text file in the theme that contains the material, such as the stylesheet holding a color scheme, opens with a comment naming the upstream project and its address, its copyright line when upstream supplies one, and its license, because a theme's files are copied and served on their own;
- the theme's folder carries a notices file with the complete license terms of every such material in it, because Television copies that folder into the user's data directory, where the user owns it;
- Television's notices for the public repository and the published CLI package list the upstream project with everything else they declare.

The theme's README links each upstream license at a fixed revision whose terms are the ones declared. For a photo licensed through a website without versioned terms, it records the photo URL, photographer, license URL, and date the retained terms were retrieved. Attribution never invents an upstream copyright holder or year.

**The notices are written for their reader.** Every notices file Television generates — wherever one exists ([it exists where there is something to declare](#^licensing-notices-when)): the repository root, the published CLI package, the desktop application, the browser bundle, bundled views, installed skills, bundled themes — is read by people outside this project: users, downstream distributors, license reviewers. Its content is plain language about what the file is and whose terms it carries. It refers to none of Television's internal processes, workflows, tooling, vocabulary, or spec documents, and it gives the reader no instructions about a file that is rebuilt on every release. Internal explanation belongs in code comments and specs — never in an artifact we hand to someone else. ^licensing-notices-audience

A notices file accompanies material that needs declaring. Where an artifact carries none, there is no file: absence means there was nothing to declare, not that something was lost. ^licensing-notices-when

**We reproduce license text; we never repair it.** A notice is the upstream terms as published, or text a person wrote into our configuration knowing it is exactly what will be rendered. Nothing in between: no decoding, reformatting, or reconstruction of a package's license by rule. When a package does not supply suitable text in its license file, a person records the exact text to render in configuration; without either source, the build fails. ^licensing-no-repair

Third-party notices are **generated at build time from what actually ships, never hand-maintained**. A hand-maintained notices file silently rots on every dependency change; a generated one updates when the dependencies do. The generation mechanism — including the committed, staleness-checked notices that cover the source-repository surface — is owned by [arch/licensing.md](../arch/licensing.md). ^licensing-generated

## Dependencies installed with their own license files

Some third-party code reaches users as whole packages, license files included, rather than through our bundles. npm fetches the packages the published CLI package declares in its `dependencies` onto the user's machine at install time, and the ToDesktop build installs the packages the desktop application declares, with their own dependencies, into the app. Their attribution self-delivers and our notices do not restate them — our notices obligation is for material that reaches users without its own license file, such as code our bundlers compile into an artifact. ^licensing-external-deps

**They are checked all the same.** Every package Television declares as a dependency of the published CLI package or of the desktop application goes through the same allowlist as bundled code: adding one is our decision, and a copyleft or otherwise unacceptable package added tomorrow would otherwise reach users with nothing to stop it. What is checked is the license those declared dependencies carry, not their own dependency trees — the gate exists to hold our decisions to the policy, not to audit upstream projects' choices. ^licensing-declared-deps

**Electron is the deliberate exception.** The ToDesktop build packages the desktop application with Electron, which Television accepts as an **upstream aggregate**: a reviewed runtime that arrives carrying its own third-party legal payload — its `LICENSE` and its Chromium credits document — on the condition that those files remain intact inside the desktop application users install. We never regenerate or replace its credits, and Chromium's internal licenses do **not** join Television's allowlist; they are Electron's to manage. ^licensing-electron-aggregate

## Ignored packages

An *ignored package* is one this system does not handle: it is not inspected, not gated, and never named in any file we generate. The ignore list is a last-resort escape hatch, used at human judgment when a package genuinely does not fit the licensing framework's processing pipeline. Difficulty obtaining a package's terms is not such a case: a person copies the terms once into the reviewed notice-text configuration. Ignoring a package scopes it out of the framework entirely, so it must never substitute for doing inconvenient attribution work. Today the list holds `skills` alone. ^licensing-ignored

An ignored package cannot be named in a generated file by any route: it is dropped where the build's output is read, and a hand-written declaration of one as vendored material is refused rather than quietly dropped, so a mistaken entry surfaces instead of hiding. ^licensing-ignored-silent-routes

Every other package we bundle or declare is *handled*, and handling has exactly two outcomes: an allowlisted license — and, for bundled code, real notice text in the artifact's notices — or a failed build. There is no third outcome, so no artifact can carry a handled package that the notices do not attribute. What a notices file reports about a package is the license terms that package carries — never how this system treated it: no handling, gate, or ignored status appears in anything we ship. ^licensing-handled-or-fail

## Shipped dependencies must be acceptably licensed

Every handled package — bundled into a shipped surface or declared as a dependency of the published CLI package or the desktop application, Electron excepted — must carry a license from Television's *license allowlist* — the recorded set of accepted licenses. The allowlist exists so that "is this dependency's license acceptable?" is a recorded decision, not a per-upgrade judgment call. Licenses that would impose obligations on Television's users beyond attribution (copyleft over our artifacts, source-disclosure demands, field-of-use limits) are not acceptable in shipped surfaces unless explicitly accepted below. ^licensing-allowlist

**This spec is the authority for the allowlist's contents.** The allowlist, bootstrapped from what Television's shipped surfaces actually contain today (including the recorded DOMPurify election):

- MIT
- ISC
- BSD-2-Clause
- BSD-3-Clause
- Apache-2.0
- OFL-1.1
- LicenseRef-Unsplash

**OFL-1.1** (the SIL Open Font License) is on that list for the vendored typeface. It is the one entry whose scope is narrower than the list implies: it carries conditions beyond attribution — the font stays under OFL, cannot be sold on its own, reserved-name rules apply to modifications — which are fine for a typeface we embed unmodified and wrong for code. So OFL-1.1 arriving on a *code* package is a decision to make, not an automatic pass. That scope is held in review, deliberately: encoding it would mean a machine deciding what is a font and asserting a file is unmodified, and neither is a judgment a checker can make. ^licensing-ofl-fonts-only

**LicenseRef-Unsplash** identifies the [Unsplash License](https://unsplash.com/license). It is accepted through the same allowlist as the other entries. The restrictions on selling images without significant modification and compiling a competing service remain part of its terms; review evaluates each new use against those terms. Ordinary attribution, retained license text, and notices requirements apply. ^licensing-unsplash

Adding a license is a policy change made here first; the machine-readable copy the tooling consumes lives in [arch/licensing.md](../arch/licensing.md) and must match this list exactly. ^licensing-allowlist-contents

- **The standard test suites enforce this.** The license gate runs as an ordinary test in the normal suites, which every broad verification and every CI run executes; a shipped dependency whose license is outside the allowlist — or cannot be determined — fails those tests. It is enforcement, not documentation: the failing gate stops the change that introduced the dependency, when the fix is cheapest. The suite wiring is owned by [arch/licensing.md](../arch/licensing.md). ^licensing-gate
- **Dual-licensed dependencies ship under a recorded *license election*** — our explicit, recorded choice of which offered license we accept the dependency under. An election is a licensing decision, so it lives in reviewed configuration, never inferred silently by tooling. ^licensing-election
- Development-time dependencies that never enter a shipped surface are outside the allowlist's scope: nothing of theirs is redistributed, so their licenses bind our development, not our users.

## Non-goals

- There is **no `tv licenses` CLI subcommand** (or flag) that prints the notices, and none is planned. The notices ship as files inside the published CLI package and the desktop application and are served next to the browser bundle; that is the whole delivery story. This is a deliberate exclusion — some CLIs offer such a command as a courtesy, and Television chooses not to carry that surface. ^licensing-no-cli-command

## Testing

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), [licensing architecture](../arch/licensing.md#Testing) owns proof that real builds produce the required inventories and that those inventories reach the license gate. Product enforcement requires the license gate to run in the standard suites against the real repository tree and the real outputs of the CLI and desktop builds and of every declared shipped surface.

Published-package acceptance must build and inspect the real npm tarball for the CLI package. Desktop acceptance must inspect an [upload directory](../arch/desktop/distribution.md#^desktop-dist-upload) generated by the real desktop build script, the directory ToDesktop builds the app from.

Browser-surface acceptance must fetch the [stable notices URL](../arch/licensing.md#^licensing-vite-intermediate) from a running Television server. Acceptance of Electron as an [upstream aggregate](#^licensing-electron-aggregate) is the desktop application's [license-file check](./desktop-app.md#Testing), which finds Electron's license files in the built app.

Acceptance of the [reader](#^licensing-notices-audience), [existence](#^licensing-notices-when), and [ignored-package](#^licensing-ignored-silent-routes) promises must inspect all real generated outputs together: the committed repository-root notices, the packed CLI tarball, the desktop upload directory, every built view and skill directory, every bundled theme folder that owes a notices file, and the notices served with the browser client.

