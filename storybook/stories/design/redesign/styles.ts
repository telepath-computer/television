// Design workshop (not a spec): one unified stylesheet for the redesign
// mockups. Classes are shared across all three mocks (same card, same rail,
// same tab pill) so the mocks differ only where the paradigm differs.

export const REDESIGN_CSS = /*css*/ `
  /* Stage — neutral backdrop, fixed shell, caption underneath */
  .stage {
    min-height: 100vh;
    box-sizing: border-box;
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: #f0f0f0;
    overflow: auto;
  }

  .caption {
    flex: none;
    max-width: 720px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #888;
    text-align: center;
  }

  .shell {
    width: 980px;
    height: 920px;
    flex: none;
    display: flex;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 13px;
    color: #333;
    background: #fff;
    border: 1px solid #ccc;
  }

  .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #aaa;
  }

  /* Rail — screens */
  .rail {
    width: 220px;
    flex: none;
    border-right: 1px solid #ddd;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .rail-header {
    height: 40px;
    flex: none;
    border-bottom: 1px solid #ddd;
    padding: 0 12px;
    display: flex;
    align-items: center;
  }

  .screens {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .screen-row {
    padding: 7px 8px;
    border-radius: 4px;
    color: #444;
    cursor: pointer;
    user-select: none;
  }

  .screen-row.active {
    background: #ececec;
    color: #111;
  }

  .rail-footer {
    flex: none;
    border-top: 1px solid #ddd;
    padding: 8px;
  }

  .new-screen {
    padding: 7px 8px;
    color: #888;
    border-radius: 4px;
  }

  /* Main workspace */
  .main {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    background: #f5f5f5;
  }

  .main.column {
    flex-direction: column;
  }

  /* Workspace column — the tab strip / nav plus the pane area below it.
     Shared by the Organizing mocks and the interactive prototypes. */
  .workspace {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: #f5f5f5;
  }

  /* Pane area under a tab strip. "flush" drops the top padding for layouts
     where the tabs sit directly on the content (no divider, no gap). */
  .proto-panes {
    flex: 1;
    min-height: 0;
    padding: 16px;
    box-sizing: border-box;
    display: flex;
    position: relative;
  }
  .proto-panes.flush {
    padding: 0 16px 16px;
  }
  .proto-panes > * {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  /* Tab band. "stripped" hosts animated absolute strips (tmux mock);
     "inline" is a plain centered row (scaling mock). */
  .tabs-band {
    height: 40px;
    flex: none;
  }

  .tabs-band.stripped {
    border-bottom: 1px solid #ddd;
    position: relative;
    overflow: hidden;
  }

  .tabs-band.inline {
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    overflow-x: auto;
  }

  .tab-strip {
    position: absolute;
    inset: 0;
    padding: 0 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: opacity 0.28s ease, transform 0.28s ease;
  }

  .tab {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    color: #555;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }

  .tab.active {
    border-color: #bbb;
    background: #fafafa;
    color: #111;
  }

  /* pane-group indicator — one circle = single, overlapping = split */
  .glyph {
    flex: none;
    display: inline-flex;
    align-items: center;
  }
  .glyph .c {
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1px solid #999;
    border-radius: 50%;
    background: #fff;
  }
  .glyph .c + .c {
    margin-left: -5px;
  }

  /* minimap tab variant — the tab is a small diagram of its layout */
  .tab.minimap {
    padding: 0 4px;
  }
  .mini {
    width: 40px;
    height: 22px;
    display: flex;
    gap: 2px;
  }
  .mini .m-split {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    gap: 2px;
  }
  .mini .m-split.col { flex-direction: column; }
  .mini .m-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    border: 1px solid #aaa;
    border-radius: 2px;
    background: #fff;
  }
  .tab.active .mini .m-pane {
    background: #eee;
  }

  /* lead-count tab variant */
  .tab .plus {
    color: #999;
    font-size: 11px;
  }

  /* expandable tab variant — active group grows a members section */
  .tab .members {
    display: inline-flex;
    align-items: center;
    max-width: 0;
    opacity: 0;
    overflow: hidden;
    transition: max-width 0.25s ease, opacity 0.2s ease;
    white-space: nowrap;
  }
  .tab.active .members {
    max-width: 340px;
    opacity: 1;
  }
  .tab .members::before {
    content: "";
    align-self: center;
    width: 1px;
    height: 14px;
    background: #ddd;
    margin: 0 4px 0 8px;
  }
  .tab .member {
    padding: 2px 6px;
    border-radius: 3px;
    color: #777;
  }
  .tab .member:hover {
    background: #eee;
    color: #222;
  }

  /* members tab variant — every artifact shown as its own icon + name,
     joined by a divider, always expanded. */
  .tab-joined {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .tab-member {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .member-icon {
    width: 10px;
    height: 10px;
    flex: none;
    box-sizing: border-box;
    border: 1px solid #999;
    border-radius: 50%;
    background: #fff;
  }
  .tab-sep {
    color: #ccc;
  }

  /* members layout — tabs sit flush against the content (no divider, no gap) */
  .members-layout .tabs-band.stripped { border-bottom: none; }
  .members-layout .panes { padding-top: 0; }

  /* Artifact card — identical in every mock */
  .card {
    border: 1px solid #ddd;
    border-radius: 6px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: #fff;
    overflow: hidden;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .card.flash {
    border-color: #999;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.06);
  }

  .card-title {
    height: 32px;
    flex: none;
    border-bottom: 1px solid #eee;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    color: #555;
  }

  .card-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-btn {
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 4px;
    color: #999;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tb-btn:hover {
    background: #eee;
    color: #333;
  }

  .tb-btn.on {
    background: #e2e2e2;
    color: #222;
  }

  .tb-btn.on:hover {
    background: #dadada;
  }

  .icon {
    width: 16px;
    height: 16px;
    fill: currentColor;
    display: block;
  }

  .card-body {
    flex: 1;
  }

  /* Placeholder document — skeleton bars standing in for real content. */
  .fake {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 16px;
    box-sizing: border-box;
  }
  .fake-sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fake-h {
    height: 11px;
    border-radius: 3px;
    background: #dcdcdc;
  }
  .fake-line {
    height: 8px;
    border-radius: 3px;
    background: #ececec;
  }

  /* Pane region — the tmux mock's animated viewport */
  .panes {
    flex: 1;
    min-height: 0;
    padding: 16px;
    box-sizing: border-box;
    display: flex;
  }

  .viewport {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .page {
    position: absolute;
    inset: 0;
    display: flex;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: transform;
  }

  .page > *,
  .split > * {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .split {
    display: flex;
    gap: 16px;
  }
  .split.row { flex-direction: row; }
  .split.col { flex-direction: column; }

  /* Scrolling strip — the scrolling/scaling mocks' workspace */
  .scroller {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex;
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
    align-items: stretch;
  }

  .scroller > .card,
  .scroller > .col {
    flex: none;
  }

  .col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .col > .card {
    flex: 1;
    min-height: 0;
  }

  /* Full-screen mode — one card fills the workspace */
  .fullscreen {
    position: absolute;
    inset: 0;
    display: none;
    padding: 16px;
    box-sizing: border-box;
    background: #f5f5f5;
  }

  .fullscreen.on {
    display: flex;
  }

  .fullscreen > .card {
    flex: 1;
  }
`;
