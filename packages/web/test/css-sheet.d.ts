// The shared css-module-scripts Vite transform (config/css-module-scripts.ts)
// gives `import sheet from "./x.css" with { type: "css" }` CSS module script
// semantics: the default export is a shared `CSSStyleSheet`. vite/client's
// own `*.css` declaration is empty; this merges the default export into it
// so `tsc` types attributed CSS imports in the test tree.
//
// This declaration is package-wide, but the plugin is wired into the vitest
// config only: an attributed CSS import in `src/` typechecks yet breaks in
// the app build until the plugin lands in vite.config.ts (the component
// migration slice). Wire the app build before using the syntax in `src/`.
declare module "*.css" {
  const sheet: CSSStyleSheet;
  export default sheet;
}
