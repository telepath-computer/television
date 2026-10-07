The rewrite is substantially better aligned with the policy, but I would correct three passages before accepting it. It generally preserves the contracts and non-obvious decisions that need human ownership, and leaves appropriate implementation choices to code.

1. **The escaping-entry response is still overstated.**  
   [Active-theme route, line 33](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:33) says an entry whose file resolves outside the package returns `404`.

   That is true for an enabled script entry, but not for `theme.css`. If `theme.css` becomes a symlink outside the package, the [stylesheet check](/home/user/workspace/wt/television/distill-themes-delivery/packages/server/src/themes.ts:353) treats it as unavailable and returns successful empty CSS. The outside file is never served. The old spec required containment without assigning `404` to every escaping entry.

   Describe the empty stylesheet condition as “missing or unusable,” and narrow the explicit escaping-entry `404` rule to enabled script entries. Alternatively, leave rejected-entry status unspecified and retain the security requirement that outside files are never served. The rewrite should not introduce a uniform response requirement that the implementation does not provide.

2. **Equal specificity does not guarantee that a theme declaration wins.**  
   [Stylesheet order, line 45](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:45) says the theme beats Television’s declarations at equal specificity.

   Television deliberately uses `!important` for theme-surface protections. For example, a theme’s ordinary `#theme-iframe-overlay { pointer-events: auto }` has equal specificity but loses to the application’s [`pointer-events: none !important`](/home/user/workspace/wt/television/distill-themes-delivery/specs/ui/app/styles.css:15). The [app UI contract](/home/user/workspace/wt/television/distill-themes-delivery/specs/ui/app/index.md:26) expressly preserves those protections.

   Delete “so a theme declaration beats Television’s at equal specificity.” Keep the stylesheet-order requirement and the reference to foundation overriding. Those state Television’s decisions; ordinary CSS cascade rules supply the consequences without another guarantee here.

3. **The appearance-change summary can require unnecessary frame restarts.**  
   [Shell first paint and confirmed state, line 61](/home/user/workspace/wt/television/distill-themes-delivery/specs/arch/themes/delivery.md:61) says an appearance change changes the marker and recreates the frames.

   Changing the stored preference under a fixed theme does neither. Switching between `system` and an explicit preference can also leave the effective appearance unchanged. The later sandbox section correctly ties replacement to an effective `data-theme` change, and the [implementation](/home/user/workspace/wt/television/distill-themes-delivery/packages/web/src/main.ts:311) preserves frames when that value stays the same.

   Suggested wording: “Appearance resolution does not refresh the theme stylesheet or main script. When it changes the effective root marker, the application recreates the enabled sandboxed frames.”

The earlier review is mostly resolved. The artifact CSP qualification, artifact-specific stylesheet ordering, disconnect-only notification and app-marker ownership reference are corrected. Validator wording now correctly applies to delivered files and empty entries. Findings 1 and 2 above identify remaining problems in the revised HTTP and precedence wording.

The references from the app UI spec and appearance explainer now reach existing sections. The delivery proof still contains links to the removed `#testing` section; that part of the earlier reference finding remains outstanding, as the ledger acknowledges, for proof re-derivation.

I found no material omission requiring restoration of the resolver’s internal names, registry lookup procedure, Settings URL marker or detailed loader implementation. The neighboring specs retain the relevant product promises. The package URLs, consent gates, cache behavior, pointer-message type and effective-appearance rules remain appropriate spec content.

No files were changed and no tests were run.