*Anonymous, opt-out product telemetry: what Television measures about how early users use it, the privacy guarantees that bound what is collected, and the disclosure and opt-out behavior users get.*

# Telemetry

## What this owns

This spec owns the **user-facing telemetry behavior**: why Television collects usage data, the privacy guarantees that bound what may ever be collected, the events and high-level properties that describe user behavior, the disclosure users receive, and the controls (opt-out, environment suppression, status reporting) they have over it.

The enablement and destination rules below govern every implementation. How events are emitted, where identity is stored, how the chosen platform is configured, and how each property is derived belong to the architecture, captured in [arch/telemetry/index.md](../arch/telemetry/index.md) while no server architecture spec yet exists. The telemetry controls and status output exposed by `tv` are owned by [product/cli.md](./cli.md), with their package integration owned by [arch/cli/index.md](../arch/cli/index.md).

## Provisional, by intent

Television is at an extremely early stage. This telemetry exists to answer one question: **is the product delivering enough value that early users come back and use it?** Retention and session activity are the primary signals; everything else supports interpreting them.

This is a deliberately provisional design, not a long-term telemetry philosophy. The project has not established a standing policy on telemetry. The current choices — collecting by default, the specific events, the opt-out model — are appropriate for a tiny early-adopter population and are expected to change. A future revision may move to opt-in, change what is measured, or revise identity. Nothing here should be read as a permanent commitment.

## Privacy guarantees

These guarantees are the hard boundary on the whole system. They constrain every present and future event.

*Telemetry* is the collection of anonymous usage data about a running Television server. A *telemetry event* is one recorded occurrence of a predefined kind of activity, carrying a fixed set of predefined properties.

- **Anonymous.** Telemetry carries no personally identifiable information. There is no name, email, account, IP address, IP-derived identity, geolocation, or device fingerprint. Network transport necessarily exposes the sending host’s IP to the receiving service; telemetry disables its use as analytics data and location enrichment.
- **No user-generated content.** Telemetry never records anything the user authored or named: not artifact paths or URLs, artifact titles, channel names, user-installed theme names, file contents, or any free text. Theme state may carry a Television-owned bundled theme ID from the closed vocabulary defined below; those IDs name packages shipped by Television, not user-authored content. The activity signals that drive sessions report only *that* a user is engaged — never what they viewed, typed, or did. ^no-ugc
- **Closed vocabulary.** Telemetry records only predefined *event names* (for example *artifact created*, *server started*) and predefined, enumerated *properties* (for example artifact kind, auth mode), numeric version triples, booleans, and integer counters (for example the number of artifacts on the server, a version number). An event or property that is not predefined cannot be sent — with a single, explicitly-documented exception, the agent-reported *installed-by agent* value (see [What we record about each event](#what-we-record-about-each-event)). ^closed-vocabulary

The closed vocabulary is the mechanism that makes "no user-generated content" a guarantee rather than a hope: because the set of events and the set of allowed property values are fixed in advance, there is no path by which a path name, URL, or title reaches the analytics platform. Where a property describes user-chosen content (an artifact's location, a theme), it is reduced to a high-level enumerated classification — never the underlying string. ^closed-vocabulary-rationale

## One telemetry user per server

Telemetry is keyed to a single anonymous identity per Television server: the *telemetry user*. The identity is created when a server first comes into existence and is stable for the life of that server's data.

A single Television server supports multiple simultaneous client connections. **All of those connections are treated as the same telemetry user** — they are not counted as separate users. Television is presently a single-user server; were it to become multi-user, this identity model would be revised (and this spec with it).

Because the telemetry user is the server, **unique-user, DAU, and MAU figures count active servers, not individual people** — appropriate while each user runs their own server. A *session* (below) is the finer-grained signal of a single span of active engagement within a server-user.

## When telemetry is sent and where it goes

Telemetry in npm releases is **active by default**. The early-stage goal of measuring retention across a small population depends on data from servers whose operators have not gone out of their way to enable anything. This is the central reason telemetry is opt-out rather than opt-in at this stage. `DO_NOT_TRACK` respects the cross-vendor convention users already rely on. Development and CI suppression keep internal and automated activity out of real-user metrics.

This section is the sole authority for telemetry enablement and destination. Apply these four rules in order; the first matching rule wins. Browser and desktop clients report content-free signals to their Television server, whose decision governs delivery; CLI skill installation uses the same rules. ^telemetry-rules

1. **Stored opt-out, DNT, or CI: suppress capture.** A stored opt-out suppresses subsequent activity. Disabling records the final transition described below when telemetry was otherwise enabled. Enabled `DO_NOT_TRACK` or `CI` prohibits all delivery to either project, including that transition and tests.
2. **Explicit test mode: send only to the test project (484904).** Tests use the single `TV_TELEMETRY_TEST` flag. It is a test-suite control, not a developer telemetry mode; the manually invoked live-delivery suite runs outside CI. This rule also works on a developer host and with an ordinary build.
3. **Production build on an unmarked host: send to the production project (482022).** Production eligibility comes solely from the build-time bake: `TV_NPM_RELEASE=1` produces the production marker. The npm publication pipeline opts in; ordinary builds and source runs do not. The host must have no `~/.tv-developer` marker.
4. **Otherwise: send nothing.** In particular, ordinary builds and marked production installations remain silent outside explicit tests.

`DO_NOT_TRACK`, `CI`, and `TV_TELEMETRY_TEST` recognize `1`, `true`, and `yes`, ignoring case and surrounding whitespace; other values are off. `TV_NPM_RELEASE` is build-time only and requires exactly `1`. `NODE_ENV`, `TELEVISION_TELEMETRY_BUILD`, and `TV_TELEMETRY_DEV` have no telemetry effect. The release flag is an explicit build choice, not proof of package authenticity. ^telemetry-flags

The developer marker lives in the operating-system home, independently of the selected Television data home. It is checked at telemetry startup. `TELEVISION_DEVELOPER_HOME`, when supplied, selects that home; otherwise the operating-system home is used. Persisted services capture the installing user's resolved operating-system home and check its marker on every boot. The marker's telemetry purpose is suppression, never test-project routing. ^developer-host-project-guard

Persisted services preserve the install-time values of `DO_NOT_TRACK`, `CI`, and `TV_TELEMETRY_TEST`. Changing a later shell's environment does not reconfigure a running service. ^telemetry-service-environment

A user disables telemetry with `tv telemetry disable` and re-enables it with `tv telemetry enable`. The change takes effect for that server and persists. These commands require a running server and cannot override the rules above. Disabling records the final transition described under [Opting out is itself recorded](#opting-out-is-itself-recorded). ^cli-control

`tv status` reports `active`, `opted-out`, `suppressed`, or `unavailable`, a suppression reason, GUID presence, and region `us`. An unavailable runtime reports `unavailable`. Otherwise environment suppression takes precedence over stored opt-out: reasons are checked as `do-not-track`, `ci`, then (outside test mode) `development` for a nonproduction build or `developer-host` for a marked production build. Without environment suppression, the stored setting determines `opted-out` or `active`. ^status-visible

### Disclosure

Users installing the npm release must be made aware that telemetry is on by default and how to turn it off, without having to read source. The disclosure surfaces below explain the [authoritative rules](#^telemetry-rules) in user-facing language; they do not define additional enablement rules.

- **Repository README.** A visible disclosure immediately before the npm installation commands tells direct installers that npm releases send anonymous, content-free usage telemetry to PostHog by default, links the privacy notice, and shows how to suppress collection before the first command with `DO_NOT_TRACK=1`. It also identifies `tv telemetry disable` for a running server and `tv status` for checking state. ^disclose-readme
- **Privacy notice (`PRIVACY.md` at the repository root).** A short public notice linked from the README explains the purpose, collection categories, anonymous identifiers, excluded personal/content data, PostHog destination and controls under the authoritative rules. It states that our partner ToDesktop builds and distributes the desktop app, has its own policies, and may or may not collect IP addresses when people download the app; Television does not report on that download data or correlate it with its anonymous telemetry. The notice summarizes product behavior; this spec remains authoritative. Changes to the notice require human review. ^disclose-privacy
- **[Administrator guide](../arch/cli/admin-guide.md) (`docs/guides/television-admin-guide.md`).** The admin guide is a standalone document, not the Television skill, that the agent explicitly loads when it installs or upgrades Television. It owns proactive user disclosure on **first install only**: the agent tells the user that telemetry is on by default, anonymous, content-free, used to understand early usage and improve Television, and can be disabled with `DO_NOT_TRACK=1` or `tv telemetry disable`; `tv status` reports the current state. The user's telemetry choice persists in server storage across upgrades, so the agent does not repeat the proactive disclosure during an upgrade. ^disclose-admin-guide
- **Television skill (`packages/skills/skills/television/src/skill-intro.md`).** The skill states that telemetry exists. It says that `tv status` shows the current state and that `tv telemetry enable|disable` and `DO_NOT_TRACK` control telemetry. This information lets an agent with the skill loaded answer or act when the user asks to inspect or control telemetry. ^disclose-skill
- **CLI.** When `tv serve` (including `--persist`) or a successful `tv skills install` runs with `<home>/state/telemetry.json` absent beforehand and rule 3 selecting production telemetry, stderr gets exactly one brief line: “Fully anonymized telemetry is enabled by default. Opt out: tv telemetry disable.” Existing `<home>/state/telemetry.json` means initialization has already happened and suppresses the notice; the file’s existence is the only first-use signal. Opted-out, suppressed, and test-project runs print no notice. Check for existing state before initialization, then print only after successful startup, service installation, or skills installation. The `--persist` parent prints the notice; daemon boots do not. Other ordinary commands print no telemetry disclosure; explicit status and control commands print their defined JSON. ^disclose-cli

Telemetry lifecycle events are separate from user-facing disclosure. `server_installed`, `server_upgraded`, `server_started`, and `skill_installed` are analytics data; their emission does not create CLI disclosure output.

### Opting out is itself recorded

When a user opts out, telemetry records a single *telemetry opted out* event, sets the current-state person property `telemetry_opted_out: true`, and then goes silent for that server. The event is captured before the opt-out setting takes effect and obeys the [enablement and destination rules](#^telemetry-rules). Events already captured remain subject to normal best-effort delivery; opting out stops subsequent capture. ^opt-out-event

The rationale is central to the product's purpose: retention analysis must distinguish a user who **deliberately opted out** from one who **abandoned** the product. Without the opt-out event the two are indistinguishable — a silent server could be either — and abandonment is exactly what this telemetry exists to measure. Recording the opt-out (and nothing further) preserves that distinction while honoring the user's choice. ^opt-out-event-rationale

`telemetry_opted_out` is a current-state person property. `tv telemetry disable` sets it to `true`; `tv telemetry enable` sets it back to `false`. Re-enabling does **not** record a separate analytics event — it corrects the current-state person property on the next emitted event and every non-suppressed `server_started` boot also reconciles the property to the stored opt-out state. ^re-enable

Opting out **does not discard the telemetry user identity** — the GUID is preserved. Re-enabling with `tv telemetry enable` therefore resumes telemetry under the **same identity**. A server's events reappearing after an opt-out is itself the signal that the user returned rather than churned, and adding a distinct identity on re-enable would wrongly read as a new user.

## What we measure

Each row is a predefined event. Properties are defined in [What we record about each event](#what-we-record-about-each-event). Product concepts use channel terminology. One analytics-history boundary keeps six already-ingested PostHog identifiers unchanged: `screen_created`, `screen_updated`, `screen_deleted`, `total_screens`, `median_artifacts_per_screen`, and `average_artifacts_per_screen`. They are the external identifiers for the channel events and content totals below; no duplicate channel-named event or property is emitted. Every other event/property name in this spec is its actual analytics identifier. ^telemetry-channel-key-exception

| Event | Recorded when |
|---|---|
| *server installed* | A Television server reaches its first serving boot with fresh data. Data is still fresh when the home holds only a config file, and when the parent CLI of an authenticated persisted install has created only the token and empty storage structure before the daemon serves. Fires once over the life of that server's data. |
| *server started* | A server starts. Fires on every start. |
| *server upgraded* | An existing server data directory starts with no recorded telemetry version, or with a recorded telemetry version older than the running version. |
| *session activity* | Recorded while a user is actively engaged with the interface; carries the *session* it belongs to. Session count and length are derived from these. |
| *artifact created* / *artifact updated* / *artifact deleted* | A user creates, changes an artifact's registry metadata, or removes an artifact. |
| *channel created* / *channel updated* / *channel deleted* | A user creates, renames, or removes a channel. Same-value metadata patches emit no telemetry update event. |
| *layout changed* | A user rearranges a channel's tab pages by reordering them. |
| *channel pins changed* | An explicit pin-list update pins, unpins, reorders, or replaces pinned channels. |
| *tab page full screen changed* | A retained tab page enters or leaves full-screen presentation. |
| *artifact skill prompt copy clicked* | A user clicks Copy prompt for one of the four fixed artifact skills. |
| *theme changed* | The active theme changes (an installed theme becomes active, or the selection is cleared to the null theme). |
| *appearance mode changed* | A committed appearance preference changes between `light`, `dark`, and `system`. |
| *skill installed* | Television's bundled skills are installed into an agent's skills directory. |
| *telemetry opted out* | A user disables telemetry. The final event; see [Opting out is itself recorded](#opting-out-is-itself-recorded). |

A *session* is a span of genuine user engagement with the Television interface — **not** merely an open connection. An open connection or ongoing background traffic does not mean a human is actively present (a backgrounded tab keeps its connection open). So the interface reports lightweight, content-free *activity signals* — the window becoming active, scrolling, interaction — from which the server determines engagement. A session begins when a user becomes active, continues while activity continues, and ends after a period without activity; its length is the span of that engagement.

A session belongs to a *client* — one browser profile, or the desktop app — identified by a stable, anonymous *client id* that persists on the device across page reloads. Because the session is keyed to the client rather than to a connection: reconnecting after a reload continues the same session; two tabs of the same browser are one session (they share the client); and a browser and the desktop app are distinct clients, hence can be distinct sessions. The client id is a random opaque value carrying no personal information — the device-side counterpart to the server's telemetry user. All of a server's clients and sessions remain the same telemetry user (see [One telemetry user per server](#one-telemetry-user-per-server)); a server is **active** on a day if any of its clients had session activity that day, the basis for retention and active-server reporting.

The product requirement is that session count, session length, and per-day session activity are measured from genuine engagement keyed to a client, not from connection state. The client-id mechanism, the activity-signal transport and debounce, and the idle threshold that ends a session are architecture, in [arch/telemetry/index.md](../arch/telemetry/index.md).

## What we record about each event

All properties are enumerated values, numeric version triples, booleans, or integer counters — never free text, with the single documented exception of the agent-reported *installed-by agent* value below. Telemetry version properties record only the numeric major, minor, and patch components; qualifiers and build metadata are excluded, and an unrecognizable version is recorded as `0.0.0`. This does not change the versions used by the product’s update mechanisms. The classifications below are derived by the server from user content but only the classification is recorded; the underlying string never is (see [no user-generated content](#^no-ugc)).

**Server configuration and version** — describe the server itself, not a single action, so they are tracked as the server's **current state** (refreshed whenever they change) rather than repeated on every event. For history they are also recorded on `server_started`; the **version** additionally rides on `server_upgraded` (carrying the **new** version and, when one was previously recorded, the **old** version) and on `session_activity`. This answers both "what is each active server configured as now" (current state) and "what versions/configs were starting up or active over a window" (the startup, upgrade, and activity events). ^active-config-requirement

| Property | Values |
|---|---|
| server version | version number |
| auth mode | `auth` \| `no-auth` |
| binds loopback | boolean |
| binds all-interfaces | boolean |
| binds tailnet | boolean |
| binds other-specific | boolean |
| port | `default` \| `custom` |
| [Television home](./cli.md#^cli-home), recorded under the analytics key `storage_path` | `default` \| `custom` |
| launch mode | `daemon` \| `cli` |
| installed-by agent | free text — agent-reported (the one non-enumerated property; see below) |

A server may bind several address categories at once, so binding is recorded as independent booleans rather than one mode — a server can be loopback **and** tailnet, for example. `binds all-interfaces` (a `0.0.0.0` bind) means the server is reachable on every interface, the broadest exposure; `binds tailnet` flags a private-network (Tailscale-range) bind, an interesting deployment we want to distinguish. ^binding-rationale

**Installed-by agent — the single enumerated-vocabulary exception.** The server learns which agent runtime harness is operating it from the `installedByAgent` setting in its home's [config file](./cli.md#^cli-config-file), which an agent sets with `tv config set installedByAgent <agent-runtime-harness-name>`. The same self-identifier can be supplied when installing skills: `tv skills install --installed-by-agent <agent-runtime-harness-name>`. The admin guide instructs an agent to self-specify the agent runtime harness name — the software running the agent, such as Codex, Claude Code, Hermes, OpenClaw, or Pi — not a personalized nickname, persona name, model name, or any value with version numbers or qualifiers. The value is lowercased, trimmed, and sent **as-is** — it is the **one property not drawn from a predefined enumerated set**. Capturing it is a genuine win-win: the agent runtime harness is an essential part of the running system, so knowing which harness a user runs lets us allocate support and prioritize compatibility for it — which serves those users directly. This deviation is deliberate and stated here per [spec-policy.md](../spec-policy.md) ("Specific specs may state exceptions"): agent runtime harness names are too many and too fast-moving to enumerate, and the skill-install [agent type](#what-we-record-about-each-event) is low-fidelity because most installs share a `.agents` folder. It is an **agent self-identifier, not user-generated content**, so the [no-UGC guarantee](#privacy-guarantees) is unaffected; only the enumerated-vocabulary rule is relaxed, and only for this one field. ^installed-by-agent

**Client** — describe the connecting client, on session events.

| Property | Values |
|---|---|
| client app | `browser` \| `desktop` |
| client platform | `windows` \| `macos` \| `linux` \| `ios` \| `android` \| `other` |
| browser vendor | `chrome` \| `safari` \| `firefox` \| `edge` \| `other` (browser only) |
| browser major version | integer (browser only) |
| desktop app version | version number (desktop only) |

Browser vendor and major version are derived from the connection's user-agent string; neither is user-generated content. Modern browsers reduce user-agent detail, so the major version is coarse and `other`/unknown is expected for less common browsers — we record what the user-agent honestly yields, no more. ^browser-rationale

**Telemetry preference** — describes the server's current telemetry setting as a PostHog person property, not as a per-event activity fact.

| Property | Values |
|---|---|
| telemetry opted out | boolean |

`telemetry_opted_out` is `true` after `tv telemetry disable` and `false` after `tv telemetry enable`. The opt-out transition is also recorded as the single `telemetry_opted_out` event described above; the re-enable transition is not a tracked event. The false correction is attached to the next emitted event after re-enable, and every non-suppressed `server_started` boot sets the property to the stored current state so restarts cannot leave PostHog stale. ^telemetry-preference-property

**Pre-telemetry cohort** — describes whether this server's journey began before telemetry existed. It is tracked as a PostHog person property so retention reports can filter to users whose full journey is captured, and it is copied onto the one adoption upgrade event for event-level analysis.

| Property | Values |
|---|---|
| pre-telemetry | boolean |

`pre_telemetry` is `false` for a genuinely new server data directory that records `server_installed`, because that server's whole journey is visible from install onward. `pre_telemetry` is `true` for an existing data directory whose first telemetry-bearing boot has no recorded telemetry version and therefore records `server_upgraded`; that user may have meaningful pre-telemetry history, so retention cohorts must be able to exclude them. Once set, this is a historical cohort fact and does not change on later version-bump upgrades. ^pre-telemetry-property

**Content totals** — describe how much content the server holds and how it is spread across channels. Like config, these describe the server, so they are tracked as the server's **current state**, and additionally recorded on the artifact/channel **add and delete** events that change them.

| Property | Meaning |
|---|---|
| total channels | number of channels on the server |
| total artifacts | number of artifacts on the server |
| median artifacts per channel | median across the server's channels |
| average artifacts per channel | mean across the server's channels |

We deliberately do **not** record the artifact count of any individual channel — only the server-level aggregates above, which answer "how much content, and how spread across channels" without per-channel detail. ^counts-rationale

**Artifact classification** — on artifact events. Captures the nature of an artifact without its location.

| Property | Values | Applies to |
|---|---|---|
| artifact kind | `path` \| `url` | all |
| path kind | `folder` \| `file` | path artifacts |
| path file type | `html` \| `markdown` \| `other` | path artifacts that are files |
| url host | `localhost` \| `tailnet` \| `third-party` | url artifacts |
| url is artifact-proxy | boolean | url artifacts |

These are two independent dimensions, because they answer different questions. `url host` is a function of the URL's **host**: `localhost` or `tailnet` means the user pointed Television at a local or networked application of their own — a distinct and interesting usage mode — versus an external `third-party` site. `url is artifact-proxy` is a function of the URL's **path**: whether it addresses Television's own artifact-proxy endpoint. The two are orthogonal — a proxy URL still has a host classification — so recording them separately keeps each clean rather than forcing a single value to mean two things. ^url-target-rationale

**Artifact deletion** — on *artifact deleted*, alongside the artifact classification and content totals.

| Property | Values |
|---|---|
| deletion cause | `direct` \| `channel_deleted` |

`direct` means the artifact was removed through the artifact deletion operation. `channel_deleted` means its registry record was removed as part of deleting the containing channel. Both are committed deletions; the cause lets reports distinguish direct artifact-removal intent from channel cleanup. ^artifact-deletion-classification

**Layout change** — on *layout changed*.

| Property | Values |
|---|---|
| change type | `tab_reorder` |

A `tab_reorder` changes tab-page order while preserving page membership. Adding or removing an artifact is not a *layout changed* event — artifact creation or deletion already records it. Changing a page's stored size alone likewise emits no event: this vocabulary measures page order and full-screen presentation, not resize frequency. Full-screen presentation is measured independently below, so one committed layout replacement that changes both order and presentation emits both events. ^layout-classification

**Channel pins change** — on *channel pins changed*.

| Property | Values |
|---|---|
| pin change type | `pin` \| `unpin` \| `reorder` \| `replace` |
| pinned channel count | integer |

The classification compares the previous and committed ordered pin lists. Membership additions are `pin`, removals are `unpin`, unchanged membership in a different order is `reorder`, and a mutation containing both additions and removals is `replace`. The count is the committed list length. Automatic pin pruning during channel deletion is part of *channel deleted* and emits no pin-change event. No channel identity or order array is recorded.

This event describes the committed server-state diff, not inferred gesture intent. Any API client that writes `pinnedChannelIds` contributes to it, and a stale concurrent writer is classified by the diff it commits. `$session_id` distinguishes client-attributed writes from sessionless API or agent writes; it does not identify a particular sidebar affordance. ^pin-classification

**Tab page full-screen change** — on *tab page full screen changed*.

| Property | Values |
|---|---|
| full screen | boolean |

Each retained page whose committed `full_screen` value changes emits one event carrying the new value. Page creation and removal do not imply a presentation transition. The event does not identify the page or the control used to change it. ^full-screen-classification

**Artifact-skill prompt copy** — on *artifact skill prompt copy clicked*.

| Property | Values |
|---|---|
| artifact skill | `calendar` \| `table` \| `tasks` \| `markdown` |

The property identifies the fixed skill card whose button was clicked. Clipboard writing is best-effort, so this event records the click rather than claiming clipboard success. The fixed prompt text is never recorded. ^artifact-skill-classification

**Theme change** — on *theme changed*.

| Property | Values |
|---|---|
| theme state | `none` \| [bundled theme ID](../ui/themes/bundled.yml) \| `custom` |
| theme count | integer (valid entries in the server's current theme registry) |
| theme change reason | `selection` \| `fallback` |

`none` means the null theme is active. A Television-owned bundled theme ID identifies that bundled theme; the bundled vocabulary is owned by [the bundled theme inventory](../ui/themes/bundled.yml). `custom` means any other installed theme is active. Classification uses bundled-theme-ID membership, so any installed package whose ID matches the bundled vocabulary reports that bundled ID. The bundled values are a finite, Television-authored vocabulary and therefore reveal no user-generated theme ID; user-authored folder names, display names, theme IDs, package versions, authored-against app versions, and validation errors are never recorded. `theme count` reveals whether users engage with theming enough to accumulate valid themes, without identifying any user-installed package. ^theme-classification

`theme_changed` also carries the four JavaScript booleans defined below, describing the committed destination theme. `theme_change_reason: selection` means an explicit selection, including selecting None; `fallback` means the server cleared an invalid selected theme during registry refresh. Each actual selection change emits once, including a change between two custom themes whose classification is the same. Same-value selections, consent-only changes, package reloads, and registry refreshes that preserve the selection emit no switch event. Startup reports its normalized current settings through boot telemetry without replaying a switch event. ^theme-switch-semantics

**Current theme and appearance** — six current-state person properties, also copied as event properties onto every `session_activity`.

| Property | Meaning |
|---|---|
| `theme_state` | `none` \| a bundled theme ID \| `custom`, as classified above |
| `theme_main_js_declared` | The active registered theme declares main-page JavaScript enabled |
| `theme_main_js_enabled` | The active registered theme declares main-page JavaScript enabled and its exact ID has consent |
| `theme_iframe_background_enabled` | The active registered theme declares background iframe JavaScript enabled |
| `theme_iframe_overlay_enabled` | The active registered theme declares foreground iframe JavaScript enabled |
| `appearance_mode` | The stored preference: `light` \| `dark` \| `system` (`Adapt to system`) |

The four JavaScript properties are booleans and are all false for None. They describe **configured use**: declaration and consent permit execution, but these properties do not report whether scripts loaded, ran successfully, or produced a visible effect. The iframe declarations are independent of main-page consent. Appearance records the server preference; each client's resolution of `system` is outside this measurement. ^theme-appearance-settings

Boot telemetry initializes the person properties even when the user keeps the default theme. Selection and appearance events carry the committed settings as person properties. Consent changes, registry changes, and telemetry re-enablement are reflected in person properties on the next emitted server event; activity snapshots always use current committed settings. No additional event or timer exists solely to refresh these properties, and suppression continues to apply. Activity snapshots preserve settings at the time of engagement, so adoption over a past window can be measured independently of the server's latest person properties. ^theme-appearance-adoption

**Appearance change** — `appearance_mode_changed` carries the committed `appearance_mode`. Repeating the stored preference emits nothing; an operating-system appearance change while the preference is `system` emits nothing. A committed patch that changes both selection and appearance emits one event for each change, with person properties describing the complete committed state. ^appearance-mode-classification

**Analytics vocabulary cutover.** Earlier `theme_changed` events used `default` for the null theme and `custom` for every installed theme. Analysts must union historical `default` with current `none` when measuring null-theme use; historical `custom` cannot distinguish bundled from user-installed themes. ^theme-vocabulary-cutover

Historical events that lack the theme or appearance settings leave those values unknown; missing fields do not mean false or None.

**Skill install** — on *skill installed*.

| Property | Values |
|---|---|
| agent type | `pi` \| `opencode` \| `claude` \| `codex` \| `hermes` \| `openclaw` \| `cursor` \| `dot-agents` \| `interactive-install` \| `other` |
| installed-by agent | free text — agent-reported, lowercased and trimmed |

The agent type is inferred from the skills directory the install targets, by matching a fixed set of known harness tokens (`pi`, `opencode`, `claude`, `codex`, `hermes`, `openclaw`, `cursor`). A `.agents` directory that matches none of them reports `dot-agents`; anything else reports `other`. An install performed through interactive target selection (`tv skills install -i`) reports `interactive-install`. This is a **low-fidelity** signal — many installs land in a shared `.agents` folder, where it can only report `dot-agents` — so it is complemented by the higher-fidelity, self-reported *installed-by agent* value (see [Server configuration and version](#what-we-record-about-each-event)). The skill-install event records that self-identifier only when the CLI caller supplies it; it never records the skills directory path or external installer arguments. ^agent-type

## What we deliberately do not collect

These boundaries restate the [Privacy guarantees](#privacy-guarantees) as concrete non-goals, because a reader might otherwise assume richer collection:

- No artifact paths, URLs, or titles; no channel names; no user-authored theme names or IDs; no artifact contents; no free text of any kind — except the single agent-reported *installed-by agent* value (an agent self-identifier, not user content). Theme telemetry admits only the bundled-ID vocabulary and the classified settings above, never the consent ID set or script contents.
- No per-event high-resolution detail beyond the enumerated properties above — for example, *artifact created* records the kind and classification, not the specific file.
- Channel focus, local tab selection, artifact-history navigation, menu and popover impressions, and intermediate drag motion may contribute to content-free *session activity*, but produce no dedicated action event. A full-screen event carries only the committed boolean, without the originating control or gesture.
- No identity that spans servers, and no notion of multiple distinct users behind one server.
- No client- or server-side aggregation in this version. Raw events are sent as they happen; the population is small enough that volume is not a concern, and aggregation can be added later if it ever is. ^no-aggregation

## Reports we intend to produce

These analytical goals justify the events and properties above; the spec is correct only if all of them are answerable from what is collected.

- Installs over time.
- Time to first artifact (from install to a user's first *artifact created*).
- Artifact creation over time, total and per user.
- Unique users, DAU, MAU, and DAU/MAU.
- Retention, defined as session activity on day N since install, filterable to `pre_telemetry = false` so cohorts include only servers whose full journey was captured.
- Share of users who have created any artifact by day N since install.
- Sessions per day, and session length.
- Daily and weekly per-event counters.
- Share of active servers that pin channels, reorder pinned channels, reorder tab pages, and enter page full-screen presentation.
- Artifact-skill prompt-copy conversion by fixed skill.
- Direct artifact deletion separately from cleanup caused by deleting a channel.
- Distribution of active server versions and configurations (see [active-config requirement](#^active-config-requirement)).
- Deliberate theme switching separately from invalid-theme fallback, and appearance preference switching.
- Current and historical adoption among active servers by bundled theme, custom theme, or None; main-page JavaScript declaration and enablement; each iframe surface's enablement; and light/dark/system preference. Historical adoption uses `session_activity` snapshots. Switch counts measure experimentation; `theme_count` measures installed valid themes. Distinct custom themes tried cannot be counted because custom IDs are never collected.

## Analytics platform and agent access

Television uses a mature third-party analytics platform with APIs, SDKs, flexible dashboards, and a queryable interface for the company's own agents; **PostHog** is the chosen platform. Company agents query metrics through PostHog's agent-queryable interface (its MCP server). This is product context and an operational goal; enablement and destination are owned by [the four rules](#^telemetry-rules); platform configuration, keys, and data region are architecture, in [arch/telemetry/index.md](../arch/telemetry/index.md). Choosing this platform implies no change to the [Privacy guarantees](#privacy-guarantees), which bound what is sent regardless of platform.

## Testing

Acceptance for lifecycle and action telemetry must begin with the real product behavior that causes an event: a serving boot, a committed change to server state, activity or interaction in a real browser or the real Electron app, or a successful CLI skill install. It must observe the complete event at the telemetry sink after identity, suppression, and session attribution. When an acceptance path stops at a recording sink, [the sink's live integration surface](../arch/telemetry/sink.md#Real PostHog integration test surface) owns proof of real delivery from that sink into PostHog.

Acceptance for artifacts, channels, themes, sessions, copying artifact-skill prompts, and update notifications must show that the resulting serialized telemetry events contain no user-generated content. Apart from the documented [installed-by agent](#^installed-by-agent) exception, each event may contain only its declared name and properties.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), [telemetry architecture](../arch/telemetry/index.md#Testing) owns proof that production telemetry types are closed and every event passes through the one event chokepoint. [Property derivation](../arch/telemetry/derivation.md) owns proof for all of the property classifiers.

Acceptance for a fresh persisted server must invoke `tv serve --persist` through the Television CLI. It must pass through the host's real user service manager, the daemon's first serving boot, and the PostHog test project. Acceptance must cover both a server whose config file sets `"auth": false` and the default authenticated ordering in which the parent CLI creates the token and empty storage structure before the daemon serves.

Server lifecycle acceptance must use real serving boots and real restarts with both fresh and existing server data. Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), [telemetry identity architecture](../arch/telemetry/identity.md#Testing) owns proof of state-file recovery and lifecycle behavior across every documented version ordering.

Session acceptance must exercise genuine engagement in both a real browser and the real Electron app against a running Television server.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), [telemetry client architecture](../arch/telemetry/client.md#Testing) owns proof that client identity, metadata, and activity use real browser and Electron storage and cross real HTTP and websocket boundaries. [Telemetry session architecture](../arch/telemetry/sessions.md#Testing) owns proof of the rotation thresholds and grouping as native PostHog sessions.

Acceptance for `tv telemetry disable` and `tv telemetry enable` must send each command through the real server's authenticated HTTP controls. When no server is running, each command must run through the spawned CLI, fail clearly, and write no success output. Acceptance for `tv status` must obtain its result through the real server endpoint.

Suppression acceptance must show that enabled `DO_NOT_TRACK` blocks boot and action events regardless of the stored setting, including in test mode. Acceptance must exercise all four [enablement and destination rules](#^telemetry-rules), including suppression of post-opt-out activity and all CI delivery in test mode, a silent marked production build, and explicit live-test delivery on a developer host. Disable acceptance must prove exactly one final opt-out event, no subsequent ordinary capture, and no transition when already opted out or otherwise suppressed; enable acceptance preserves the GUID and corrects the person property on the next event. Persisted-service acceptance must prove marker lookup in the installing user's captured home on each boot. [Identity](../arch/telemetry/identity.md#Testing) owns control coverage; [sink](../arch/telemetry/sink.md#Real PostHog integration test surface) owns live delivery; [CLI architecture](../arch/cli/index.md#Daemon boundary) owns environment capture.

Review the committed README, privacy notice, administrator guide, and bundled Television skill against their required instructions under [Disclosure](#Disclosure); prove the CLI surface through real command behavior. For the README and notice, check visibility before installation commands, usable links, opt-out before first use, agreement with the authoritative rules and privacy guarantees, and the ToDesktop statement. Document wording is assessed by content review, not brittle text-matching tests. Prove the one-line disclosure on fresh production-eligible serve and skills installation, its absence when telemetry state already exists, and its absence for opted-out, suppressed, and test-project runs. Include persisted installation and show that a skills-first installation is not notified again on serve. Status and control commands print their defined JSON.

Under the testing policy's [rule that a spec serves several purposes](../arch/testing-policy.md#^spec-purposes), the analytical goals under [Reports we intend to produce](#reports-we-intend-to-produce) guide the event vocabulary and its review. They do not each require a separate test that runs the corresponding report query.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), telemetry acceptance follows the CLI's [owned external-installer exception](./cli.md#^cli-installer-exception) and must not run the interactive installer. Direct skill-install acceptance must perform the real file copy. Interactive acceptance must observe the reported success or failure of the delegated installer action. Events from both forms must contain neither destination paths nor installer arguments.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), [update notifications](./update-notifications.md#Testing) own when their client-observed events fire and which version properties they carry. The [skill selector](../ui/app/skill-selector/index.md#Interaction) owns the `artifact_skill_prompt_copy_clicked` event and the fixed `artifact_skill` value for each card. [Telemetry client-signal architecture](../arch/telemetry/client-signals.md#Testing) owns validation and forwarding into the event chokepoint. These client events may contain only their declared names and properties and no user-generated content.
