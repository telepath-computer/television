## Application structure for this release

This reference describes the application structure shipped with the matching Television release. Selectors may change between releases. The same theme stylesheet loads in the app and supported artifacts: prefix app-only rules with `:root[data-television-document="app"]` to avoid matching similarly named artifact elements. Leave rules intended for both documents unprefixed. The outlines omit text, repeated entries, and runtime pairing IDs where those do not affect styling. The application fills trigger references and manages interactive state; a theme styles those states without changing them.

An artifact frame belongs to the application document. The document inside its iframe is separate: an app selector cannot reach across that boundary. The error-page section below describes standalone artifact documents and therefore does not use the app root prefix.

### Shell and theme surfaces

```html
<div id="app" tabindex="-1">
  <aside class="app-sidebar"><nav class="sidebar">…</nav></aside>
  <main class="app-main">
    <header class="top-bar">…</header>
    <section class="stage">…</section>
  </main>
</div>
<div id="foreground-overlay" inert aria-hidden="true"></div>
```

`#app` owns the application layout and suppresses ordinary text selection in its contents; readable regions can explicitly restore selection. `.app-sidebar` holds the channel list. The sidebar defaults to 260 pixels wide, resizes between 160 and 350 pixels, and remembers the chosen width per browser; it can also collapse entirely, the navbar then opening with an expand control and — while a channel is open — a channel-switcher popover, with the collapsed state remembered per browser. `.app-main` holds the wallpaper, navbar and stage. `.app-main > .top-bar` supplies the horizontal control inset; stage padding is separate. Preserve the shell width constraints so overflowing tabs and pages scroll inside their regions without widening the document. `#app:focus` suppresses a ring on the container itself. The wallpaper region establishes a backdrop boundary so overlay blur samples the wallpaper rather than adjacent content, while fixed popovers retain viewport positioning.

While Television cannot use its server, one connection dialog is shown. Disconnected and unreachable states keep an established shell and its artifact documents mounted; first connection, authorization and upgrade-gate states have no shell behind them. Three failed unreachable reconnects change Disconnected to Can’t connect with server; the displayed upgrade gate stays until reload.

During collapse or expansion, `#app[data-sidebar-motion]` contains both resting layouts and one travelling control:

```html
<button class="sidebar-motion-toggle" variant="ghost" icon aria-label="Collapse sidebar">
  <span class="expanded-paint" aria-hidden="true"><tv-icon name="sidebar" size="sm"></tv-icon></span>
  <span class="collapsed-paint" aria-hidden="true"><tv-icon name="sidebar" size="sm"></tv-icon></span>
</button>
```

The button is a direct child of `#app`, alongside `.app-sidebar` and `.app-main`. Its two spans carry the sidebar and navbar treatments, clipped at the moving boundary. The resting collapse and expand controls are hidden during motion. Theme rules that change those controls should give the corresponding spans the same treatment. Preserve the application-controlled position, clipping and opacity; shell transitions and animations are suppressed during this motion so they cannot trail the prescribed pose. Artifact documents remain independent.

For the optional iframe surfaces and protected overlay stacking, see [Theme effects and scripts](#theme-effects-and-scripts).

### Channel sidebar

```html
<nav class="sidebar">
  <header class="sidebar-titlebar">
    <button class="channel-create" variant="ghost" icon aria-label="New channel" title="New channel">…</button>
    <span class="toolbar-separator" role="separator" aria-orientation="vertical"></span>
    <button class="sidebar-collapse" variant="ghost" icon aria-label="Collapse sidebar" title="Collapse sidebar">…</button>
  </header>
  <div class="sidebar-body">
    <div class="channel-list" role="listbox" aria-label="Channels">
      <div class="channel-group" role="group" aria-labelledby="channel-group-pinned">
        <div class="channel-group-label" id="channel-group-pinned">Pinned</div>
        <div class="channel-row">
          <div class="channel" role="option" aria-selected="true" tabindex="-1">…</div>
          <button class="channel-menu-trigger" icon variant="ghost" size="sm" tabindex="-1" aria-haspopup="menu">…</button>
        </div>
      </div>
      <!-- The Recent group uses channel-group-unpinned. -->
    </div>
  </div>
</nav>
```

`.sidebar::after` paints the light inner seam over the sidebar background, alongside its optional soft shadow. `.app-main::before` paints the adjoining fractional dark seam over the wallpaper. Both are pointer-transparent. The sidebar accepts an independent native border; the main region reserves the exterior seam track. `.sidebar-titlebar` reserves the window controls and drag area; the reservation applies in the desktop shell, which marks the document root `data-platform="electron"`. `.sidebar-body` scrolls both groups together; `.sidebar:has(.sidebar-body[continues-start]) .sidebar-titlebar` draws the top boundary while content extends above the viewport. `.channel-list` holds the groups and their spacing, composed here and inside the collapsed navbar's switcher popover. `.channel-group + .channel-group` separates the groups, and `.channel-group-label` styles their labels. `.channel-create` and `.sidebar-collapse` sit at the right of the titlebar, split by `.toolbar-separator`, and are excluded from window dragging.

The channel name and its menu trigger are siblings within the row. `.channel` owns the name box; `.channel[aria-selected="true"]` paints the selection. The selected row changes `.channel-menu-trigger` text color through `.channel-row:has(> .channel[aria-selected="true"])`. Shared foundation tints follow that color for hover, press and expanded states. A hover or an expanded trigger preserves the unselected row tint through `:where(.channel-row:hover, .channel-row:has(.channel-menu-trigger[aria-expanded="true"])) .channel:not([aria-selected="true"])`. Trigger visibility follows row hover, `:focus-visible`, selected state, and expanded state. Use the expanded trigger state when styling an open menu subject. Panels remain in their authored DOM position when opened.

Renaming replaces the name and menu trigger with `input.channel-rename` and `button.channel-rename-commit`. The field uses shared native-input styling; these selectors retain its placement and the commit treatment in the same row seat. `.channel-row:has(.channel-rename)` keeps its focus ring visible. A dragged row carries `.channel-row.dragged`; an unpinning row also carries `.unpinning` and contains `.channel-drag-action` with a `tv-icon`. `.channel-row.dragged .channel` removes the spare trigger inset. `.channel-drag-action tv-icon` sizes the action glyph; `.channel-placeholder` marks the drop slot.

Channel context menus use `tv-menu`, `tv-menu-item`, `hr`, and `tv-menu-item[intent="danger"]`. An open menu is a sibling of the channel name and trigger inside `.channel-row`; its trigger carries `aria-expanded="true"`. The same composition appears in the sidebar and the channel popover. These shared elements supply menu styling and item states. Deletion uses the shared dialog outline below.

### Navbar and tabs

```html
<header class="top-bar">
  <!-- The lead group renders while the channel sidebar is collapsed. -->
  <div class="top-bar-lead">
    <button class="sidebar-expand" variant="ghost" icon aria-label="Show sidebar" title="Show sidebar">…</button>
    <button class="channel-switcher" variant="ghost" target aria-haspopup="listbox"><span class="channel-switcher-name">…</span>…</button>
    <!-- The open channel popover stays inside the lead group. -->
    <tv-popover open class="channel-switcher-pop">
      <div class="channel-switcher-pop-body">
        <div class="channel-list" role="listbox" aria-label="Channels">…</div>
      </div>
      <footer class="channel-switcher-pop-footer">
        <button class="channel-create" variant="ghost" icon aria-label="New channel">…</button>
      </footer>
    </tv-popover>
  </div>
  <div class="tab-strip" role="tablist">
    <div class="tab" role="tab" aria-selected="true" tabindex="0">
      <span class="tab-label" data-overflow>…</span>
    </div>
  </div>
  <div class="top-bar-controls">…</div>
</header>
```

`.top-bar` centers `.top-bar > .tab-strip` while tabs fit and keeps `.top-bar-controls` at the trailing edge. With `.tab-strip[data-overflow]`, the strip scrolls within the remaining space. The layout retains an 8-pixel gap before the strip and 48 pixels of draggable ground before the trailing controls; tabs and their edge fades stay clear of both control groups. Both child bands exclude native window dragging; empty bar ground remains available for it. The navbar and sidebar titlebar share the application bar height, with their controls vertically centered.

`.top-bar-lead` appears only while the channel sidebar is collapsed: `.sidebar-expand` reopens it, and — only while a channel is open — `.channel-switcher` (with `.channel-switcher-name` truncating the label) opens `.channel-switcher-pop`, a `tv-popover` composing the channel list over a pinned `.channel-switcher-pop-footer` create bar, its scrolling body `.channel-switcher-pop-body`. While the lead group is present the leading flank refuses to shrink below it, so a long name pushes the strip off-centre rather than clipping.

The popover retains channel row spacing, type and shape, but assigns its colors locally from ordinary panel and option roles. Sidebar-specific color overrides therefore do not set its colors. `.channel-switcher-pop .channel[aria-selected="true"]` keeps primary selection colors. Unselected rows use a neutral highlight for hover, keyboard focus or an open context menu; `.channel-switcher-pop .channel:focus-visible` has no outline. While keyboard focus is visible, a stationary pointer does not highlight a second row. Preserve these distinctions when styling the popover.

All `.top-bar tv-popover` panels have a 600-pixel maximum height, reduced further when the viewport requires it. The channel popover keeps its create footer fixed while `.channel-switcher-pop-body` scrolls. The shared dragged-row, unpin action, placeholder and rename selectors above also apply here. A channel context menu is a child panel of the channel popover; opening it keeps the parent visible, and closing the parent closes its children.

Ordinary controls in both groups — `.top-bar :is(.top-bar-controls, .top-bar-lead) > button:not([intent])` — follow the navbar text token. Ordinary ghost buttons share the wallpaper-overlay background, border and blur; hover and pressed/expanded states replace the complete background. Buttons with an intent retain their semantic colours.

`.tab-strip` scrolls horizontally. An edge fades while more tabs remain past it. `.tab[data-item-edge-fade]` carries a mask on the individual tab, preserving its backdrop blur; the strip has no mask. `.tab` owns the pill; `.tab-label` retains the complete text. `.tab-label[data-overflow]` clips and fades labels that exceed the available width at the right edge; fitting labels remain fully visible. `.tab[data-compression="hugging"]` retains intrinsic width, while `.tab[data-compression="capped"]` permits compression to the floor. `.tab:hover:not([aria-selected="true"])` and `.tab:active:not([aria-selected="true"])` style unselected interaction; `.tab[aria-selected="true"]` paints the current page cue. `.tab.dragged` raises the carried tab, and `span.tab-placeholder[aria-hidden="true"]` occupies its drop slot. Nonselected tabs carry `aria-selected="false"` and `tabindex="-1"`.

### Stage and pages

```html
<section class="stage">
  <div class="filmstrip">
    <div class="filmstrip-inner">
      <div class="page" selected><div class="artifact-frame">…</div></div>
      <div class="page"><div class="artifact-frame">…</div></div>
    </div>
  </div>
</section>
```

`.stage` provides the clipping and size-container boundary. `body > .stage` fills a standalone stage; the app composition uses the flex region instead. `.filmstrip` is the viewport and `.filmstrip-inner` arranges pages. `.filmstrip-inner::before` and `::after` provide the end room needed for centering. `.page` receives its stored dimensions, and `.page[full-screen]` takes the available page box. `.page > .artifact-frame` fills that width.

`.page:not([selected])` scales the background page and blurs the wallpaper behind it; its direct `.artifact-frame` child controls content opacity and content blur separately; `.page:has(~ .page[selected])` and `.page[selected] ~ .page` set the corresponding transform origins. `.page[selected]` keeps the selected page above neighbors during reordering. `.page:not([selected]) .artifact-frame` takes no pointer input. Reduced-motion styling removes page and artifact-frame transitions. Preserve selection, clipping and size behavior when changing the appearance.

An empty channel adds `.stage-empty`, containing an artifact `tv-icon` and a paragraph in a compact, rounded box centered over the stage. It shares the wallpaper-overlay background, border, outline and blur, and has no shadow. Its text uses `--wallpaper-overlay-text-color`. `.stage-empty p` styles its supporting line. During an armed fullscreen snap, `.snap-outline[aria-hidden="true"]` overlays the page box without taking input. The outline and the tab/channel placeholders express transient drop or resize state, not persisted selection.

### Artifact frame and its menu

```html
<div class="artifact-frame">
  <div class="artifact-frame-clip">
    <iframe title="…"></iframe>
    <footer class="artifact-title-bar">
      <tv-icon name="artifact"></tv-icon>
      <span class="artifact-title">…</span>
      <!-- Navigation controls appear together when either direction exists. -->
      <button class="artifact-back" icon variant="ghost" size="sm">…</button>
      <button class="artifact-forward" icon variant="ghost" size="sm">…</button>
      <span class="artifact-bar-divider" aria-hidden="true"></span>
      <button class="artifact-menu-trigger" icon variant="ghost" size="sm">…</button>
      <tv-menu>…</tv-menu>
    </footer>
  </div>
</div>
```

`.artifact-frame` owns the border, curve, surface and broad shadow. Its `::before` paints the sharp rim and its `::after` paints a pointer-transparent masked inner highlight over document and titlebar. Background pages suppress the broad shadow while retaining the exterior rim. `.artifact-frame-clip > :is(iframe, webview)` fills the document area through the one-pixel padding track. `.artifact-frame-clip` clips the document and titlebar while the outer frame lets both shadows extend outward. `.artifact-title-bar` paints the lower band, `.artifact-title-bar .artifact-title` takes the remaining width and truncates, and `.artifact-bar-divider` separates navigation from the menu trigger. The two direction buttons use `disabled` to show unavailable history. In browser demo mode, the frame of an external web page wraps its artifact `tv-icon` in `button.artifact-return` (`icon`, ghost, `sm`) and shows no direction controls. The document repeats the top clipping radius where required for composited iframe/webview rendering. A frame can also hold static `.artifact-frame-content` in place of a document and omit its menu when it has no artifact to act on. That content fills the clipping region above the title bar.

The artifact menu uses the same shared menu elements and placement as channel menus. Deletion uses the shared dialog outline below.

### Settings

```html
<button class="settings-trigger" id="settings-trigger" icon variant="ghost">…</button>
<tv-popover class="settings-popover" trigger="settings-trigger">
  <div class="settings-heading">Settings</div>
  <div class="settings-field">
    <label id="settings-appearance-label">…</label>
    <button id="settings-appearance" aria-labelledby="settings-appearance-label">…</button>
    <tv-select trigger="settings-appearance"><tv-option value="system" selected>…</tv-option>…</tv-select>
  </div>
  <div class="settings-field">
    <label id="settings-theme-label">…</label>
    <div class="settings-theme-control">
      <button id="settings-theme" aria-labelledby="settings-theme-label">…</button>
      <tv-select trigger="settings-theme">…</tv-select>
      <button icon variant="ghost" aria-label="Refresh themes">…</button>
    </div>
  </div>
</tv-popover>
```

`.settings-popover` owns the panel interior, `.settings-heading` the heading, and `.settings-field` the field groups. `.settings-theme-control` arranges the theme choice and refresh button. `.settings-field button[aria-haspopup="listbox"]` makes each choice trigger fill its field. The shared select supplies combobox semantics, caret, `tv-option[selected]`, and its open highlight; opening it leaves Settings open.

An executable active theme adds `.settings-javascript-consent`, with `.settings-javascript-disclosure` and `label.settings-javascript-toggle`. The label contains a native checkbox carrying `role="switch"` and `name="theme-javascript-consent"`. `.settings-javascript-toggle input`, `input::before`, `input:checked`, `input:checked::before`, and `input:focus-visible` define its track, knob, enabled state and focus ring. `.settings-status[role="status"]`, `.settings-failure[role="alert"]`, and `.settings-errors` show loading, failure and registry diagnostics; `.settings-errors p` and `.settings-errors strong` separate the message and folder emphasis.

### Skills, update notice and copy confirmation

```html
<button class="skill-trigger" id="skills-trigger" icon variant="ghost">…</button>
<tv-popover class="skill-popover" trigger="skills-trigger">
  <div class="skill-heading">…</div><p class="skill-intro">…</p>
  <div class="skill-grid">
    <article class="skill-card">
      <div class="skill-thumb"><img alt=""></div>
      <div class="skill-name">…</div><p class="skill-desc">…</p>
      <button class="copy-button" size="sm">…</button>
      <span class="copy-button-status" role="status" aria-live="polite"></span>
    </article>
  </div>
</tv-popover>
```

`.skill-popover`, `.skill-heading`, and `.skill-intro` define the panel framing. `.skill-grid` arranges the cards. `.skill-card`, `.skill-thumb`, `.skill-thumb img`, `.skill-name`, and `.skill-desc` own each card; `.skill-card button.copy-button` places its copy action at the bottom.

The update control is `button.update-bell#update-bell[icon][intent="alert"]` paired with `tv-popover.update-popover[manual][trigger="update-bell"][role="status"]`. `.update-popover` contains readable notice text and `.update-actions` with `button.update-later` and an optional primary copy action. The desktop self-update notice has `button.update-restart[size="sm"][intent="primary"]` in place of the copy action; it carries `[disabled]` while the app restarts. The manual panel stays open until the composing surface closes it.

The reusable copy control is `button.copy-button[prompt]`, optionally carrying `intent` and `size`, containing `.copy-button-idle` and `.copy-button-done`. Both contain an icon and label. The default Copy size is `sm`; callers can omit the rendered size attribute for a standard button or request `size="lg"`. `.copy-button[copied] .copy-button-idle` hides the idle content without changing its occupied space; `.copy-button[copied] .copy-button-done` overlays the confirmation. `.copy-button-status` is a separate visually hidden live announcement. Preserve that status region and stable button size when restyling confirmation.

### Dialogs, connection states and upgrade gate

```html
<div class="dialog-overlay">
  <dialog open>
    <div class="dialog-content">
    <div class="dialog-alert" role="alertdialog">
      <h2>…</h2><p>…</p>
      <div class="dialog-actions"><button>Cancel</button><button intent="danger">…</button></div>
    </div>
    </div>
  </dialog>
</div>
```

The scrolling `.dialog-content` wrapper may contain ordinary content instead of an alert. Ambient selectors `:where(.dialog-overlay)`, `:where(dialog)`, and `:where(dialog:focus-visible)` define dimming, centering, panel chrome and container focus treatment. `:where(.dialog-alert)`, `:where(.dialog-alert h2)`, `:where(.dialog-alert p)`, and `:where(.dialog-actions)` define the shared confirmation interior. Keep the modal input boundary and focus behavior intact.

Connection dialogs use `.system-modal`, with a heading and supporting text where applicable. `.system-modal h2` and `.system-modal p:not(.tv-error)` set their hierarchy. Connecting has a spinning icon and title; Disconnected adds the reconnect countdown or in-flight line. Can’t connect with server has no icon, adds `.server-url` and recovery guidance, and keeps the reconnect line. Access token required uses the lock icon and guidance for obtaining a current link. The browser directs the person to its address bar; the desktop's served interface directs them to Disconnect from Server in the app menu.

Only the local desktop page adds `button.system-modal-disconnect[intent="danger"]` to unauthorized and error dialogs:

```html
<div class="system-modal">
  <tv-icon name="locked" size="xl"></tv-icon>
  <h2>…</h2><p>…</p>
  <button class="system-modal-disconnect" intent="danger">…</button>
</div>
```

Connection dialogs leave only when their owner's state changes. Served dialogs wear the server's theme; local dialogs wear Clouds. In the desktop app a `.window-drag-strip[electron-draggable]` spans the top 36 pixels while no shell is rendered, including on the local page. It sits inside `dialog`, outside `.dialog-content`, so native modality leaves it interactive. A retained shell supplies its own drag areas, including with its sidebar collapsed.

Upgrade instructions use `.desktop-upgrade-gate > .dialog-overlay > dialog > .dialog-content > .upgrade-gate-body`. The gate fills the halted page; the body scrolls within the panel. `.upgrade-gate-body h1`, `.upgrade-gate-body p`, `.upgrade-gate-body pre`, and `.upgrade-gate-body :last-child` restore local reading rhythm and command formatting. When the app has downloaded an update, `.upgrade-gate-actions` follows the body inside `.dialog-content` and places `button.upgrade-gate-restart[intent="primary"]` trailing below the message; the button carries `[disabled]` while the app restarts.

### Standalone artifact error documents

```html
<main class="artifact-error">
  <div class="artifact-error-body">
    <h1>…</h1><p>…</p>
    <section class="artifact-error-block"><p>…</p><p><code>…</code></p></section>
  </div>
</main>
```

`.artifact-error` paints the document ground; `.artifact-error-body` limits the reading column. `.artifact-error h1`, `.artifact-error p`, and `.artifact-error-block` arrange its text. A missing artifact can include a path chip. An unsupported URL can include a link or `.plain-address`, followed by a link to the admin guide for installing the Mac desktop app. `.artifact-error a`, `.artifact-error .plain-address`, and `.artifact-error code` wrap long content; the path chip is selected whole for copying. Optional host-supplied content may carry `[hidden]`.

<!-- Authority freshness: review this authored reference whenever a listed source changes. -->
<!-- app-reference-source: specs/ui/app/app.frame sha256: d3f547b23c22507ffc38b4741c5b9fa5c66ddc83e845f999fc09a6259986aa0b -->
<!-- app-reference-source: specs/ui/app/artifact-frame/artifact-frame.frame sha256: f336de141ff397e1e282f89a35ceb4e449e70ed3d85e92852c854ca7f61acce3 -->
<!-- app-reference-source: specs/ui/app/artifact-frame/artifact-menu.frame sha256: e01464499f195ec8d44d9d0f899069e78661944131f23aca74459e1dca283111 -->
<!-- app-reference-source: specs/ui/app/artifact-frame/delete-confirm/delete-confirm.frame sha256: 42dea00eb14ddc11756cf012d53c1ae63c8a6f0409110ff3b30b8c0833532fb6 -->
<!-- app-reference-source: specs/ui/app/artifact-frame/error-page/error-page.frame sha256: 2dd87a846ebe9a9365444930cf05a4c46ce894573ce3ac58078586d34611f0c6 -->
<!-- app-reference-source: specs/ui/app/copy-button/copy-button.frame sha256: b941401c8a97bd2a97dad71beff5d794619b9be987039d4ec80e9d79d3eb5c6d -->
<!-- app-reference-source: specs/ui/app/desktop-upgrade-gate/desktop-upgrade-gate.frame sha256: 15138e0ed0273ec54267efa55aae65b7b35a8812952a94902e05b85c3beb6725 -->
<!-- app-reference-source: specs/ui/app/dialog/dialog.frame sha256: 31a723b9cafde4bbc2783cb01cc22e9dcfc88e71d36120dc24edf1de5ddcab17 -->
<!-- app-reference-source: specs/ui/app/settings/settings.frame sha256: 35f923930af589729410a2b45a66ba7edddd6fd78f7de31f265cd5164abfc769 -->
<!-- app-reference-source: specs/ui/app/sidebar/channel-list.frame sha256: 498bd76036a32641537b1a1c37ed3e135a2f0fdaf23fb66de12ef174eabc4fab -->
<!-- app-reference-source: specs/ui/app/sidebar/channel-menu.frame sha256: 3696718c2d20c39e0408554439010b70ea9d649bdc77aab6fbab4a65453ecc4d -->
<!-- app-reference-source: specs/ui/app/sidebar/channel-placeholder.frame sha256: 2b18f7e0ca020db7c6d697752a12633f418a7964bb819885f56cd56a6ef19001 -->
<!-- app-reference-source: specs/ui/app/sidebar/channel.frame sha256: 267e70719e2c8f2693c566c2d1118908391152ed9f573905215c384062f00dfd -->
<!-- app-reference-source: specs/ui/app/sidebar/delete-confirm.frame sha256: 940dfd33179c4a59e1190efd4bb48b12a04fb2e8f246db9f5edb619e2ed6f75a -->
<!-- app-reference-source: specs/ui/app/sidebar/sidebar.frame sha256: 7e92cd473576d4a47f576342a09542ad8021dc8b60c978b1d8196a62b0aa1b87 -->
<!-- app-reference-source: specs/ui/app/skill-selector/skill-selector.frame sha256: 7474d8a456c13f2064b90c43d04a37ffae9ef9e542ffa39a16fcbf27f6158a7f -->
<!-- app-reference-source: specs/ui/app/stage/stage.frame sha256: c037b88962a2dd2a554ba44e3bc91f1ec3c1ef7d773e3ffecce33c5a35115081 -->
<!-- app-reference-source: specs/ui/app/styles.css sha256: b3129a9c9fe4ad498324983304ef7ec448f3a510a9eb337d1ee24f5c003c0f84 -->
<!-- app-reference-source: specs/ui/app/system-modal/system-modal.frame sha256: 5b2d6762819fd376cbfff840be88c4fb87e4713c5a7b98f478ab93246b1762c0 -->
<!-- app-reference-source: specs/ui/app/tab-strip/tab-placeholder.frame sha256: 68f1be9e5bb91802c2877e63fd79e6c2157eae09f6a8729b2a3ae2f6bdc5cac3 -->
<!-- app-reference-source: specs/ui/app/tab-strip/tab-strip.frame sha256: 386d056d162c3aff1d5e6da1a7201bb9e9f1885a9f85933bb366d391c4622880 -->
<!-- app-reference-source: specs/ui/app/tab-strip/tab.frame sha256: 99279467a24200a16547a76162c30c1a90a9bad1f783eb935fe2224bdcd7a8b6 -->
<!-- app-reference-source: specs/ui/app/top-bar/top-bar.frame sha256: c2ee2416dc5411716fbab93f0adda0c5861e6e7be58b5f07d14d6c77a4c0320e -->
<!-- app-reference-source: specs/ui/app/update-notification/update-notification.frame sha256: dda519fdf6c269d4a682d0f61e9a5632a84e0eb1995d1753f05d3a3fb274b666 -->
<!-- app-reference-source: specs/ui/app/index.md sha256: a82a5169d070e9b3a6ecc4da5a7d616f3c0a9ad841512bd6322e36ebf652f401 -->
