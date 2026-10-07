**FAIL as written.** The rewrite is easier to read, and most removals appropriately leave internal choices to code or refer to another owning spec. However, several shortened statements broaden the guarantees or preserve contradictions that need resolving.

1. **Artifact appearance is promised unconditionally.**  
   [Appearance resolver, line 53](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:53) says every managed document has the root marker; [Artifact documents, line 118](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:118) says the resolver runs before styles.

   The old spec explicitly allowed authored CSP metadata to force insertion after earlier styles. The [bridge contract](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/artifact-frame/artifact-bridge.md:173) also permits CSP to block the resolver altogether. The [injection code](/home/user/workspace/wt/television/distill-themes-delivery/packages/server/src/artifact-proxy.ts:120) preserves that ordering. These are accepted limitations, not implementation details that can disappear while retaining an unconditional promise.

   Change the resolver introduction to describe what the resolver does when it runs. For proxied artifacts, say: “Artifact documents use the resolver with input `system`, subject to the artifact bridge’s injection ordering and CSP constraints.” Keep the before-styles requirement for Television’s own editor and error documents.

2. **The stylesheet-order guarantee conflicts with the built-in artifact documents.**  
   [Stylesheet order, line 45](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:45) says no Television stylesheet follows the theme in a live canonical artifact.

   The [UI architecture](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/ui/index.md:48) explicitly puts editor and error-page styles after canonical, whose wrapper includes the theme. The [artifact-missing page](/home/user/workspace/wt/television/distill-themes-delivery/packages/web/src/views/artifact-missing/index.html:7) does exactly that. This contradiction existed in the old spec; the rewrite retains its broad rule while deleting the passage that exposed the exception.

   Reconcile the intended scope. Wording consistent with the neighboring contract would be: “The application loads the theme after its foundation and surface styles. Live canonical wrappers import the theme after the canonical base; artifact-specific styles may follow the wrapper.” Also narrow “a theme’s declarations win” to overriding foundation defaults: load order does not guarantee victory over more-specific surface selectors.

3. **The HTTP wording adds guarantees the route does not provide.**  
   [Active-theme route, lines 33–35](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:33) says the four entries “always succeed” and gives every response a package-sensitive validator.

   An enabled script entry that becomes a symlink outside the package receives `404` from the [containment check](/home/user/workspace/wt/television/distill-themes-delivery/packages/server/src/themes.ts:369). Error responses also do not receive the package-derived validator used for delivered files and empty entries. The old spec stated successful-empty behavior for particular conditions, without the blanket success claim.

   Delete “The four entry paths always succeed” and retain the listed empty-response conditions. Keep revalidation general, but scope the validator requirement to served files and successful empty entry responses.

4. **The stylesheet notification now includes an extra trigger.**  
   [Application theme link, line 71](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:71) announces whenever the current link “is removed.” That includes removing it during refresh.

   The old spec said “removed on disconnect.” The [implementation](/home/user/workspace/wt/television/distill-themes-delivery/packages/web/src/theme.ts:52) likewise announces the replacement’s load or failure, and announces clearing on disconnect; it does not announce the intermediate removal during replacement.

   Restore “is removed on disconnect.” Otherwise the rewrite introduces an additional layout-notification requirement.

Two smaller corrections:

5. **Restore the app marker’s ownership reference.**  
   [App-document selector, line 49](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:49) states the root markup requirement independently. The old text explicitly attributed it to the app UI spec, which [still owns it](/home/user/workspace/wt/television/distill-themes-delivery/specs/ui/app/index.md:16).

   Start with “The app UI spec defines the application root’s `data-television-document="app"` marker,” linking that owner. Retain the explanation of how theme authors use it.

6. **Repair references to removed sections.**  
   Removing `#testing` and `#embedded-document-platform-behavior` leaves references in the [app UI spec](/home/user/workspace/wt/television/distill-themes-delivery/specs/ui/app/index.md:105), [appearance explainer](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/explainer-appearance.md:51), and delivery proof pointing nowhere. The ledger acknowledges this but does not resolve it.

   Point the explainer to `#artifact-documents`; update the app UI coverage reference to the actual coverage owner. Reconcile the proof’s references when re-deriving it, rather than preserving claims about deleted directives.

I found no need to restore the internal resolver/controller names, loader module paths, registry lookup procedure, or Settings URL marker. Those removals fit the policy.

This review used the new spec, the original at `f1cef5a4`, the ledger, neighboring specs, implementation, and relevant test source. No files were changed and no tests were run.