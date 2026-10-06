The [telemetry spec][spec] contains substantial product intent worth preserving, but it mixes that intent with duplicated analytics contracts, implementation instructions, and a largely derivable test plan. Applying the [proposed policy][policy] would shorten it considerably without removing its privacy boundaries or changing what Television measures.

The most important corrections are substantive: the free-text agent field does not support the claimed structural privacy guarantee; integer-only properties conflict with fractional averages and medians; and some reporting goals are insufficiently defined. These should not be silently resolved while editing.

I applied only the policy below the divider. This was a static review of the spec, related architecture specs, proofs, code, and disclosure documents. I changed no files and ran no tests or services. Live PostHog configuration was not verified.

**1. Opening and “What this owns”**

This introduces telemetry’s scope and divides ownership among product telemetry, telemetry architecture, and the CLI.

**Keep the one-line description; condense the introduction.** The policy’s “How a spec opens” requires orientation, not a standard ownership inventory. Ownership clarification is useful here because measurement meanings, event encoding, CLI behavior, and delivery overlap.

Proposed wording:

> *Anonymous usage telemetry: measurements, privacy guarantees, disclosure, and user controls.*
>
> Television collects usage telemetry to understand whether early users return and which features they use. This spec owns those measurements and the promises made to users. Telemetry architecture owns event encoding, identity storage, and delivery; the CLI spec owns command behavior.

Cut “while no server architecture spec yet exists.” That explains document history rather than the reader’s present task. Link directly to the current owner. This follows “What the product is now.”

The ownership sentence should also be corrected: the current CLI spec explicitly delegates telemetry control semantics and status meanings back to this spec. Saying that the CLI owns all telemetry controls and status output obscures that division.

**2. “Provisional, by intent”**

This establishes retention as the purpose and describes possible future changes to consent, measurements, and identity.

**Keep the present purpose and the reason for opt-out. Cut the speculative alternatives and the disclaimer about permanence.** These follow “Why a statement belongs,” “What the product is now,” and “Authoring guidance.”

Proposed wording, folded into the introduction:

> Telemetry measures whether early users find enough value to return. Retention and active use are the primary signals. Collection is opt-out for the current early-adopter population.

The proposed policy does not make specifications permanent. Listing future opt-in or identity designs adds no present requirement. The existing rationale for collecting by default can remain beside the enablement rules.

**3. “Privacy guarantees”**

This defines telemetry and promises anonymity, exclusion of user content, and a restricted vocabulary.

**Keep these as firm product requirements.** They are design intent and external commitments under “Why a statement belongs.” They are justified examples of “Limitations with teeth,” rather than prohibitions to remove merely because they are strict.

Several parts need correction:

- **Anonymity and IP handling:** Keep the distinction between network exposure and use as analytics data. Reference the [delivery specification][sink] for request protections and operator-maintained PostHog settings. The policy expressly includes contracts maintained through external-service configuration.
- **No user-generated content:** Keep the prohibition and a short set of representative examples. The long theme-specific list can be replaced by a reference to the permitted classifications.
- **Closed vocabulary:** Keep the requirement that events and measurements be declared. Keep the intentional harness-name exception explicitly identified.
- **Structural guarantee:** Rewrite the explanation. The claim that there is “no path” for a name, URL, or title to reach analytics is too strong. [`normalizeInstalledByAgent`][agent-input] trims and lowercases any supplied string, then returns it unchanged otherwise. The event builder does not establish that it is a public harness name.
- **Integer-only values:** Resolve the contradiction with content averages and medians. The implementation calculates fractional values, and existing tests expect `1.5`. See [content-total calculation][totals].

Safe replacement for the overstated rationale:

> Content-derived properties record declared classifications rather than source strings. The harness-name field is a deliberate free-text exception whose permitted meaning is defined below.

This preserves the intended rule without claiming a mechanism that does not exist. Whether that exception adequately supports the wider privacy promise remains an owner decision.

The vocabulary description should also account for the anonymous server/session identifiers and fixed transport metadata. Those already have architecture owners; a short reference is sufficient. They should not become unexplained exceptions to an apparently exhaustive value list.

**4. “One telemetry user per server”**

This establishes one identity per server, combines its clients under that identity, and explains that active-user figures count servers.

**Keep and condense.** These choices determine the meaning of every report, so they belong under “Design intent” and “Contracts.” The rationale belongs under “Rationale.”

Proposed wording:

> A *telemetry user* is one Television home, identified anonymously across its server activity and skill installations. All clients connected to that home contribute to the same telemetry user. Unique-user and active-user reports therefore count servers, not people.

The home-based definition matters: [identity architecture][identity] and the CLI emitter allow skill installation to create the identity before the first serving boot. “Created when a server first comes into existence” is unnecessarily ambiguous.

Keep continuity across opt-out in the opt-out section. Move minting and recovery rules entirely to identity architecture. Remove speculation about a future multi-user product.

The unqualified lifetime-stability promise also needs to acknowledge its existing architectural limit: losing or invalidating telemetry state produces a new identity. Reference that recovery contract rather than repeating it here.

**5. “When telemetry is sent and where it goes”**

This contains consent, suppression, destination selection, environment inputs, developer-host behavior, persisted-service behavior, controls, and status.

**Keep the ordered product rules.** Different ordering changes whether information leaves the machine and where it goes. These are deliberate decisions under “Why a statement belongs,” not incidental implementation detail.

Condense the central rule to:

> Stored opt-out stops subsequent capture. Enabled `DO_NOT_TRACK` or `CI` prevents delivery, including test delivery. Otherwise, explicit test mode selects the test project; an eligible npm release on an unmarked host selects production; all other runs remain silent.

Retain the final-opt-out-event exception by reference to its owning subsection.

For the remaining parts:

| Part | Proposed change and policy reason |
|---|---|
| Why collection defaults on | **Keep, briefly.** It explains the retention tradeoff under “Rationale.” |
| Exact production and test project IDs | **Move to delivery architecture’s configuration/operations section.** These are external-service contracts worth preserving, but “Kinds of spec” places them in architecture. They are already defined there. |
| `TV_NPM_RELEASE=1`, the baked marker, and publication-pipeline wiring | **Move to delivery/build architecture.** Keep the product outcome that ordinary builds are silent. The build input remains a real operational contract, not something to delete. |
| Accepted environment-flag values | **Keep one authoritative definition.** `DO_NOT_TRACK` is an operator-facing control; its accepted values matter. Architecture can own the exact input contract, with this spec referring to it. Avoid duplicate definitions. |
| Inert `NODE_ENV` and retired telemetry variables | **Cut from the product description.** If protection against accidental runtime promotion is a known trap, preserve it under proof-derivation regression cases. “What the product is now” does not call for a catalogue of obsolete controls. |
| Release flag is not proof of authenticity | **Cut.** It is a converse disclaimer under “Authoring guidance,” unless an actual architectural trust decision requires it elsewhere. |
| `~/.tv-developer` | **Keep its suppression meaning and independence from the Television home.** The path is an operator-used contract. |
| `TELEVISION_DEVELOPER_HOME` and how a daemon captures the installing home | **Move the environment representation to CLI architecture.** Keep the observable rule that persisted services check the installing user’s marker on each boot. |
| Persisted environment values | **Keep a short consequence; reference CLI ownership.** Proposed wording: “Persisted services use the environment captured when installed; changing a later shell does not change their telemetry setting.” |
| Enable/disable commands | **Keep their effect here; refer to the CLI for invocation and failure behavior.** This follows “Ownership is exclusive and DRY.” |
| Status fields and precedence | **Keep the status meanings and suppression precedence; move the exact JSON shape to identity architecture.** `region`, GUID presence, and literal values are command/API contracts, so preserve them in their owner. |

For status, proposed product wording:

> Status reports whether telemetry is active, opted out, suppressed by its environment, or unavailable. Environment suppression takes precedence over stored opt-out.

The detailed reason ordering belongs with the status contract and should remain specified once.

**5a. “Disclosure”**

This requires disclosure through the README, privacy notice, administrator guide, skill, and CLI.

**Keep the named disclosure surfaces and their distinct purposes.** “Why a statement belongs” covers these user-facing commitments. Their differences are intentional: proactive first-install disclosure, persistent reference material, agent awareness, and command output are not interchangeable.

- **README — keep the requirement, resolve its placement.** The [current README][readme] contains neither a telemetry disclosure nor a privacy-notice link. Its installation section now directs users through the desktop app or administrator guide; it has no direct npm-release installation commands. The specified placement therefore assumes a surface that no longer exists. Do not remove the disclosure promise to match the document. The product/disclosure owner must decide its placement in the current installation journey.
- **Privacy notice — condense.** Preserve purpose, collected categories, identifiers, excluded data, PostHog, controls, and the ToDesktop/non-correlation statement. Keep the explicit human-review requirement: the proposed policy’s human ownership of specifications does not automatically impose review on this public notice.
- **Administrator guide — condense to the communication requirement.** Its procedural status and loading behavior already belong to the administrator-guide spec.
  
  Proposed wording:
  
  > On first installation, the administrator guide directs the agent to disclose default collection, its purpose and privacy limits, and offer to disable it. The stored choice survives upgrades, so upgrades do not repeat that disclosure. The guide explains the available controls when asked.

- **Television skill — condense and remove the source-file location as a requirement.**
  
  > The Television skill explains that telemetry exists and how the agent can inspect or change its setting.

  The particular source-tree path does not pass the policy’s contract test. A link can still help locate the content.

- **CLI — preserve the first-use behavior and exact output contract.** Command output is explicitly an example of a contract in “Why a statement belongs”; exact wording is not automatically disposable. Keep the successful-command requirement, stderr destination, quiet cases, and absence on daemon boots. Move the state-file-based eligibility contract to CLI architecture, referencing identity’s ownership of the file. Cut the procedural instruction to “check before initialization, then print”: the required behavior already determines that ordering.

The lifecycle-events paragraph can be reduced to:

> Analytics events do not themselves trigger disclosure output.

That distinction prevents repeat notices and is useful present-design rationale.

**5b. “Opting out is itself recorded”**

This specifies the last event, queued delivery, preference updates, and identity continuity.

**Keep the behavior and shorten the rationale.** Recording an event while disabling collection is surprising and merits explicit human ownership under “Why a statement belongs” and “Rationale.”

Proposed wording:

> Disabling otherwise-enabled telemetry captures one final opt-out event, then stops subsequent capture. Already-captured events remain eligible for best-effort delivery. The event distinguishes deliberate opt-out from abandonment.
>
> Re-enabling retains the same server identity and creates no separate event. The analytics preference is corrected on the next emitted event.

Move exact PostHog property names and boot reconciliation into [emission contracts][emitters]. Delete their duplication later under “Telemetry preference.” Keep suppression’s precedence by reference.

**6. “What we measure”**

This defines lifecycle and action events, analytics identifiers, sessions, and active servers.

**Keep the measurement catalogue and event meanings.** They are product decisions, even when expressed as events. Moving every mention of an event into architecture would lose the product’s measurement requirements.

Apply “Kinds of spec” and “Ownership is exclusive and DRY” to separate those meanings from their encoding:

- **Six `screen_*` identifiers:** Move their sole ownership to the [analytics vocabulary][arch]. Preserve all six spellings. Existing PostHog data and queries make them current external contracts, even though their names have historical origins.
- **Other names are “actual analytics identifiers”:** Cut this sentence. The table uses human-readable names; architecture should supply the exact identifier mapping.
- **Install:** Keep “first serving boot with fresh server data, once per home.” Move config-only and authenticated-parent setup examples into proof-derivation inputs as the trap behind this requirement.
- **Start and upgrade:** Keep their meanings. Exact stored-version representation and comparison rules belong in identity architecture.
- **Artifact/channel changes, layout, pins, full-screen, themes, appearance, skills, and opt-out:** Keep the selected actions and meaningful exclusions, such as unchanged metadata producing no update.
- **Prompt-copy click:** Keep the measurement goal, reference the [skill-selector UI][selector] for the interaction and card mapping.
- **Update telemetry:** Add a short ordinary-content reference to the update-notification owner. These events currently appear only indirectly in Testing, which makes the apparent collection catalogue incomplete.

Condense sessions to:

> A *session* measures active engagement by one client. Reloads and tabs sharing that client identity share a session; the desktop app has a separate client identity. Activity signals contain no viewed or entered content. A server is active on a day when it records session activity.

Keep the requirement that background connections alone do not establish engagement. Move transport, identifiers, and signal cadence to their architecture owners.

Two limits require attention rather than editorial smoothing:

- Browser identity is stored in `localStorage`, so sharing is scoped to an origin, not unconditionally to an entire browser profile.
- [Request handling][requests] updates session activity for client-attributed HTTP requests. The [client activity agent][activity] emits sampled interaction/focus signals, rather than continuously observing reading. The product must not imply that this establishes an exact duration of human attention.

Also reconcile the session architecture’s statement that sessionless requests count toward retention with this product spec’s session-activity definition. Retain the product requirement while exposing the discrepancy.

**7. “What we record about each event”**

This is the largest section. It combines measurement choices, external schema, derivation algorithms, and repeated privacy rationale.

The relevant policy sections are “Why a statement belongs,” “How much to say,” “Kinds of spec,” “Ownership is exclusive and DRY,” and “Work outside the product’s specialisation.”

The consistent treatment should be: **keep what a measurement means and why it exists here; own exact property names, types, and publication rules once in architecture; leave incidental calculation machinery to code.**

| Subsection and what it says | Proposed treatment |
|---|---|
| **Opening property restrictions and version normalization** | **Cut the repeated privacy rule.** Keep the product boundary that version labels cannot carry arbitrary text. Move numeric-triple encoding and the `0.0.0` fallback to the architecture contract; the fallback affects analysts and therefore remains specified. Cut the disclaimer about update mechanisms. |
| **Server configuration and version:** deployment characteristics, current state, historical snapshots | **Keep the measurements and reporting purpose; move event/property placement to emitters.** Proposed wording: “Record server version, authentication, binding categories, default/custom port and home, launch mode, and installing harness. Reports must support current configuration and the required historical comparisons.” |
| **Binding rationale:** several categories can apply simultaneously | **Keep, condensed.** “A server can bind several address categories, so the categories are recorded independently.” This prevents a materially different measurement. Cut the longer justification of why private networking is interesting. |
| **Installed-by agent:** unrestricted normalized harness name, configuration/CLI inputs, compatibility rationale | **Keep the deliberate exception and its intended meaning; condense.** “Record the installing agent’s runtime harness name to guide compatibility work. This field accepts an open-ended product name, excluding personal names, personas, models, and version qualifiers.” Move normalization and input encoding to their contracts. Remove “win-win” and the assertion that calling it an agent identifier establishes that it cannot contain user content. The privacy decision remains unresolved below. |
| **Client:** app, platform, browser family/version, desktop version | **Keep the collected categories and coarse nature.** “Record client app, operating-system category, browser family and major version for browser clients, and desktop app version for desktop clients. Classification is approximate.” Leave user-agent parsing cases to implementation under “Work outside the product’s specialisation.” The current classifier also adds browser properties for desktop inputs; flag that as implementation drift rather than changing “browser only” silently. |
| **Telemetry preference:** current opt-out property and transition behavior | **Remove this duplicate subsection.** Keep behavior in the opt-out subsection and encoding in architecture. |
| **Pre-telemetry cohort:** distinguishes installation-observed servers from existing installations | **Keep the cohort’s meaning and analytical purpose.** Proposed wording: “Retention reports distinguish servers observed from installation from servers with prior use.” Move property placement and persistence to architecture. Qualify “full journey captured”: suppression and best-effort loss mean the flag cannot guarantee a complete record. |
| **Content totals:** totals, mean and median distribution, no per-channel detail | **Keep.** “Record server-wide channel and artifact totals, and the mean and median artifacts per channel. Individual channel counts are not recorded.” These choices define the permitted measurement granularity. Resolve the fractional-number contradiction. |
| **Artifact classification:** file/folder/type, host category, proxy classification | **Keep the two independent URL measurements; condense the rationale.** “Classify artifact kind and file type. For URLs, record address category separately from whether the path matches the artifact-proxy format.” The [actual helper][proxy] checks a pathname pattern; it does not establish who owns the host or whether it really serves Television. Cut those stronger inferences. |
| **Artifact deletion:** direct deletion versus channel cleanup | **Keep.** “Distinguish direct artifact deletion from removal caused by deleting its channel.” Move literal property encoding to architecture. |
| **Layout change:** reorder, exclusions, independent full-screen events | **Keep the measurement boundary; condense.** “Measure page reordering independently of full-screen changes. Artifact membership changes and resizing do not count as reordering.” |
| **Channel pins:** operation categories, committed count, automatic pruning, attribution | **Keep committed-state semantics and exclusion of automatic pruning.** “Classify explicit committed pin-list changes as additions, removals, reordering, or replacement, and record the resulting count. Automatic pruning during channel deletion is excluded.” Cut the stale-writer example as derivable; move `$session_id` mechanics to sessions. |
| **Full-screen:** one event per retained page’s committed transition | **Keep.** “Record each retained page’s committed full-screen transition and its new state, without page identity.” Exact fields belong to the vocabulary. |
| **Artifact-skill prompt copy:** fixed skill and click rather than clipboard success | **Keep the distinction; reference UI ownership.** “Measure prompt-copy clicks by fixed skill. A click does not establish clipboard success.” Remove the duplicate fixed-card mapping. |
| **Theme change:** none/bundled/custom, count, selection versus fallback | **Keep these measurement decisions.** “Record theme category, valid installed-theme count, and whether selection was explicit or a fallback.” Preserve the accepted limitation that a bundled classification reflects matching package ID, not verified package provenance. Keep switches between distinct custom themes counting as switches. |
| **Current theme and appearance:** six settings and historical snapshots | **Keep the measurement meanings.** “Measure selected theme category, main-page JavaScript declaration and consent-based enablement, each iframe surface’s configured enablement, and stored appearance preference. Preserve settings at the time of activity for historical adoption reports.” Keep the distinction between configuration and successful execution. Move field names and publication placement to architecture. |
| **Settings refresh timing:** boot, next event, activity snapshots, no timer | **Keep the required freshness in the emission contract.** Cut the implementation prohibition on a timer once publication behavior is stated. Keep the deliberate absence of additional analytics events. |
| **Appearance change:** stored preference changes, not OS resolution; combined changes | **Keep, condensed.** “Measure changes to the stored appearance preference. System appearance changes do not count when the stored preference remains `system`.” Put combined-commit event construction in emitters. |
| **Analytics vocabulary cutover:** old theme values and missing properties | **Move to the analytics contract or its operational interpretation section. Do not simply archive it.** Historical data remains queryable now. Proposed wording: “Across retained data, `default` and `none` both represent the null theme. Historical `custom` does not distinguish bundled themes. Missing settings are unknown.” |
| **Skill install:** target-derived agent category and optional self-report | **Keep the two signals and their limitation.** “Record a coarse installation-target category and an optional self-reported harness name. Shared agent directories cannot identify the harness reliably.” Keep exact output categories in architecture. Cut the directory-token matching algorithm from authoritative prose; the implementation can derive it from the required classification. |

The agent-field exception is an exception to this spec’s vocabulary rule. Its justification does not need to present it as an exception to the general spec policy, which does not itself prescribe a closed telemetry vocabulary.

**8. “What we deliberately do not collect”**

This repeats privacy exclusions, excludes some action events, restates identity scope, and prohibits aggregation.

Under “Ownership is exclusive and DRY” and “How much to say”:

- **Cut the first two bullets:** they repeat the privacy boundary and declared vocabulary.
- **Preserve the deliberate omission of dedicated focus, navigation, impression, and drag-motion events** beside the measurement catalogue. Those exclusions prevent plausible expansion of collection, so “Limitations with teeth” permits them.
- **Cut the repeated identity rule:** its owner is the identity section.
- **Move the individual-event delivery choice to architecture.** Proposed wording: “Transmit individual captured events rather than replacing them with periodic event totals.” Remove speculation about adding aggregation later.

Distinguish event aggregation from the server-wide content statistics already collected. The present wording can make those sound contradictory.

**9. “Reports we intend to produce”**

This lists the analytical questions that justify collection and requires them to be answerable.

**Keep this section.** It is some of the clearest design intent in the document. Under “What the product is now,” rename it **“Required analytical questions”** to make its current standing clear.

Most bullets need little change. Preserve retention definitions, cohort filtering, the distinction between switching and adoption, and the inability to count distinct custom themes.

Two gaps need an owner:

- **“Prompt-copy conversion” has no defined denominator or subsequent outcome.** Click counts alone do not define conversion. The spec also deliberately excludes impression events and cannot identify that a later artifact came from a particular copied prompt.
- **“Full journey” overstates the cohort guarantee.** First-boot suppression, state loss, and delivery loss need to be reflected in how cohorts are interpreted.

Do not add impression tracking or conversion attribution as a routine completion of the spec. Those would be new product decisions.

**10. “Analytics platform and agent access”**

This chooses PostHog, describes desired platform capabilities, and specifies agent access through MCP.

**Keep the ability for company agents to query usage data. Move provider configuration and MCP access to delivery architecture’s Operations section.** This follows “Kinds of spec” and the policy’s explicit treatment of external-service contracts.

Proposed product wording:

> Company agents can query the collected usage measurements through the analytics service.

PostHog can remain named in disclosure by reference to the destination owner. Cut “mature,” “flexible dashboards,” and the repeated assurance that platform choice does not change privacy guarantees. These add neither a measurable requirement nor necessary rationale.

**11. “Testing”**

This mixes genuine designer directives, coverage ownership, regression knowledge, and restatements of product promises.

Replace it with **“Inputs to proof derivation that the spec does not otherwise show.”** The proposed policy explicitly allows directives about test methods; it does not require deleting all test instructions.

Treat the existing paragraphs as follows:

| Existing material | Proposed treatment |
|---|---|
| Start with real product behavior and observe complete constructed events | **Keep under “Directives from the designer or architect.”** This selects a test boundary that the behavior alone would not require. |
| Repeated requirement to prove declared fields and absence of user content | **Cut as a repeated promise.** Proof authors derive it from Privacy guarantees. |
| Closed types, single emission path, classifiers | **Keep concise ownership references under “Coverage owned by another spec.”** |
| Fresh persisted install through real service manager and PostHog | **Keep the explicit method directive.** |
| Config-only home and authenticated parent creating token/directories | **Move to “Facts a test author would likely miss” or “Regression cases.”** Remove the same detailed scenario from the ordinary event table. |
| Real serving restarts and real browser/Electron engagement | **Keep, combined with the first directive.** |
| Client storage/transport and session grouping coverage | **Keep ownership references.** |
| Controls through real authenticated HTTP and status endpoint | **Keep the boundary directive.** The no-server failure assertions belong to the CLI proof and can be referenced. |
| Full suppression and opt-out truth tables | **Cut the repeated behavior.** Retain only non-obvious environment/setup facts. |
| Review disclosure documents rather than text-match them | **Keep the method choice.** Cut the repeated inventory of required document contents. |
| No separate executed report query for every analytical goal | **Keep as an explicit coverage directive.** |
| Direct skill copy and delegated interactive-installer acceptance | **Keep the real-copy directive and reference the CLI-owned installer exception.** Avoid restating that exception. |
| Updates, selector interaction, and client-signal ownership | **Keep concise ownership references.** Cut the repeated privacy promise. |

Suggested core wording:

> **Directives from the designer or architect**
>
> Exercise lifecycle and action telemetry through real product behavior and observe complete events after identity, suppression, and session attribution. Use real browser and Electron engagement, real serving boots and restarts, and authenticated server controls. Fresh persisted-install acceptance crosses the host’s service manager and the PostHog test project.
>
> Review disclosure documents by content review. Analytical goals do not each require an executed report-query test. Direct skill-install acceptance performs the real copy; interactive installation follows the CLI-owned exception.
>
> **Facts a test author would likely miss**
>
> Before a fresh persisted daemon first serves, its parent may already have written configuration, an authentication token, and empty storage directories. These do not establish prior server use.
>
> **Coverage owned by another spec**
>
> Reference the existing owners for vocabulary, classifiers, identity recovery, client storage and transport, session grouping, live delivery, persisted environment, update events, and selector interactions.

This preserves deliberate requirements while allowing the proof to derive the detailed assertions.

**What is missing**

The policy does not prescribe a universal telemetry checklist. The omissions that matter here are:

- **A clear reference to feature-owned telemetry in the collection description**, especially update notifications.
- **A complete explanation of the vocabulary boundary**, including anonymous identifiers and transport metadata, without duplicating their schemas.
- **Defined reporting meanings where the current words do not establish them**, particularly conversion and complete-history cohorts.
- **Acknowledgment of accepted measurement limits**, where the product owner accepts them: sampled engagement, origin-scoped client identity, identity recovery, and best-effort event loss.
- **The product-level priority of normal operation over telemetry.** Delivery architecture already promises this. Promote the promise here and let architecture reference it:
  
  > Telemetry failures do not prevent normal product use. Delivery is best effort.

The provider’s privacy settings are already specified in delivery architecture. Their absence from this product document is not a gap requiring duplication.

**Decisions the policy cannot make**

| Decision | Who needs to make it |
|---|---|
| Whether accepting an unrestricted harness-name string is compatible with the advertised privacy guarantee, and what reliance on correctly supplied input is acceptable | Product/privacy owner, with the telemetry architect |
| Whether permitted numeric measurements include fractional aggregates, or whether integer-only collection is intentional | Product/analytics owner |
| What session length is intended to estimate, and whether the current sampled signals and request-based session extension are acceptable | Product/analytics owner, with the telemetry architect |
| Whether a “client” is intentionally scoped to browser storage origin or must span different origins reaching the same server | Product owner and client architect |
| What prompt-copy “conversion” means, including its denominator and any attribution requirement | Product/analytics owner |
| Where README disclosure belongs in the current installation journey | Product/disclosure owner |
| How reports should describe incomplete observation caused by suppression, state recovery, and event loss | Product/analytics owner |

These are not requests to implement additional machinery. Each could be resolved by clarifying the intended measurement or accepting a stated limitation.

**Where the proposed policy was unclear**

- **Product measurements versus code-shaped events.** “Kinds of spec” puts events and properties in architecture, while “Why a statement belongs” protects product design intent. Telemetry event meanings are themselves product decisions. I treated measurement meaning as product authority and encoding as architecture authority, but the policy could state that distinction more explicitly.
- **History versus retained-data compatibility.** “What the product is now” excludes history, while the contracts section protects data written by other versions. Theme-value interpretation remains necessary for current reports over retained data. I treated it as a current compatibility contract, not a retirement record.
- **Useful negative boundaries versus disclaimers.** “Authoring guidance” welcomes negative behavioral boundaries but then rejects disclaimers about what statements do not imply. “Configured enablement does not establish successful execution” is essential measurement meaning. The policy should distinguish that from a gratuitous disclaimer.
- **Freshness versus implementation timing.** “How much to say” says stored-preference contracts do not need to specify when values are written. For analytics, when current-state values refresh changes query results. That example needs room for timing that the external consumer relies on.
- **Recognizing intentional internal decisions.** The policy allows internal architecture choices that a human wants to own, but the document alone cannot always establish whether “no timer,” exact notice wording, or a particular testing route was deliberately selected. Existing rules should be assessed individually rather than presumed either sacred or accidental.

**Word count**

The current file contains approximately **6,437 words** using a whitespace count, including Markdown table syntax.

The proposed product spec would be approximately **2,800–3,200 words**, a reduction of roughly **50–55%**. That estimate excludes material moved into architecture; much of that material already exists there and needs ownership consolidation rather than another copy. It assumes the existing product choices are preserved pending the decisions above.

[policy]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/docs/working/spec-tightening/sharper-spec-policy.md:54
[spec]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/specs/product/telemetry.md
[arch]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/specs/arch/telemetry/index.md
[identity]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/specs/arch/telemetry/identity.md
[sink]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/specs/arch/telemetry/sink.md
[emitters]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/specs/arch/telemetry/emitters.md
[agent-input]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/packages/server/src/telemetry/derivation.ts:118
[totals]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/packages/server/src/telemetry/emitters.ts:152
[readme]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/README.md
[selector]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/specs/ui/app/skill-selector/index.md:15
[requests]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/packages/server/src/telemetry/runtime.ts:159
[activity]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/packages/web/src/services/telemetry-client.ts:126
[proxy]: /tmp/claude-1000/-home-user-workspace/2046d6bd-266d-4cad-9d18-7c662dda366d/scratchpad/astra-copy/packages/artifact/src/model.ts:72