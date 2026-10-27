*Desktop appearance: how confirmed display state controls Electron renderers, webviews, menus, and dialogs.*

# Desktop appearance

Electron owns one application-wide appearance source. The *appearance input* is the `system`, `light`, or `dark` value that the [shell appearance rule](../themes/delivery.md#^theme-delivery-shell-appearance) produces from confirmed `activeThemeColorScheme` and `appearanceMode`. The source starts at `system`, remains unchanged while the shell shows its [local page](./connect-flow.md#^desktop-local-page) or is disconnected, and takes the next connected server's appearance input after the renderer receives its confirmed display state. The [appearance explainer](../explainer-appearance.md) places this native path alongside the browser and theme paths.

## IPC path

`packages/desktop/src/appearance-mode.ts` owns the one-way channel name and the runtime predicate for `system`, `light`, and `dark`. The remote renderer can access only this operation through the existing context-isolated native preload bridge:

```ts
setAppearanceMode(mode: "system" | "light" | "dark"): void
```

The renderer calls it only when Electron mode, the native bridge, and this operation are present. If the operation is absent on a boot allowed by the gate, the application document still receives confirmed appearance; the missing native operation neither throws nor interrupts independent renderer startup work, though native and webview appearance remains unchanged. This defensive guard does not make such a release shell compatible: the theming release enforces the [required desktop floor](../updates/desktop-upgrade-gate.md#^ops-first-gate) before connected content can mount. With the operation available, the renderer sends the initial appearance input before mounting connected content. It recomputes the appearance input from confirmed theme or preference events and sends a changed value. The browser build never invokes a native bridge method.

The preload validates before `ipcRenderer.send`. Main validates again in its `ipcMain.on` listener before assigning `nativeTheme.themeSource`. Unknown values are ignored at both boundaries. Electron resolves `system` against the device; `nativeTheme` applies to application renderers, webviews, native menus, and dialogs. The main process does not derive this source from the renderer's computed `color-scheme`: assigning `nativeTheme.themeSource` also controls the system-preference query used by adaptive appearance, so feeding that query's result back into the source would prevent reliable system adaptation. ^desktop-appearance-ipc

## Lifecycle

Main's default is Electron's `system`. A disconnect or navigation to the local page does not reset the last appearance input. When another server's display state is ready, its appearance input replaces the retained value before connected content or its first artifact webview attaches. Existing webviews stay loaded when the appearance input changes. Changing the stored preference under a fixed theme leaves the appearance input and loaded presentation unchanged. ^desktop-appearance-lifecycle

## Testing

Acceptance must use the real Electron app connected to a running Television server. It must show that Electron applies the initial appearance input before the first artifact webview attaches. With an adaptive theme, `light`, `dark`, and `system` update Electron's native theme, the same loaded webview's media-query result and [root appearance marker](../themes/delivery.md#appearance-resolver), and its appearance-dependent styling without replacing its document. With a fixed theme, changing the stored preference leaves those results fixed; returning to the adaptive theme applies the latest preference.

