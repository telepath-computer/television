import icons from "../../../../../specs/ui/foundation/icons/icons.ts";
import iconStyles from "../../../../../specs/ui/foundation/icons/styles.css?raw";

const names = Object.keys(icons) as (keyof typeof icons)[];
// The markup the icon frame emits: a tv-icon whose declarative shadow root
// carries the element styles and the named glyph.
const declarativeMarkup = names.map((name) =>
  `<section data-icon-path="declarative" data-icon-name="${name}"><tv-icon name="${name}"><template shadowrootmode="open"><style>${iconStyles}</style>${icons[name]}</template></tv-icon></section>`
).join("");
const frameScript = `
  const names = ${JSON.stringify(names)};
  const declarativeRoots = new Map(
    [...document.querySelectorAll('[data-icon-path="declarative"]')].map((section) => [
      section.dataset.iconName,
      section.querySelector('tv-icon').shadowRoot,
    ]),
  );
  await import('/packages/web/src/elements/icon.ts');
  await customElements.whenDefined('tv-icon');

  const imperativeHost = document.querySelector('#imperative-icons');
  for (const name of names) {
    const section = document.createElement('section');
    section.dataset.iconPath = 'imperative';
    section.dataset.iconName = name;
    const icon = document.createElement('tv-icon');
    icon.setAttribute('name', name);
    section.append(icon);
    imperativeHost.append(section);
  }

  for (const section of document.querySelectorAll('[data-icon-path="declarative"]')) {
    const icon = section.querySelector('tv-icon');
    section.dataset.declarativeRootPreserved = String(
      icon.shadowRoot === declarativeRoots.get(section.dataset.iconName),
    );
  }
  document.documentElement.dataset.fixtureReady = 'true';
`;

const frame = document.createElement("iframe");
frame.id = "icon-markup-frame";
frame.srcdoc = [
  "<!doctype html><html><body>",
  declarativeMarkup,
  '<div id="imperative-icons"></div>',
  `<script type="module">${frameScript}</script>`,
  "</body></html>",
].join("");
document.body.append(frame);
