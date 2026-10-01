import {
  installAppearanceResolver,
  type AppearancePreference,
} from "@telepath-computer/television-artifact/browser";

const childURL = new URLSearchParams(window.location.search).get("child");
if (!childURL) throw new Error("appearance frame fixture requires a child URL");

const controller = installAppearanceResolver("system");
const frame = document.querySelector<HTMLIFrameElement>("#appearance-child");
if (!frame) throw new Error("appearance child frame is missing");
frame.src = childURL;

Object.assign(window, {
  __appearanceFrameFixture: {
    setPreference(preference: AppearancePreference): void {
      controller.setPreference(preference);
    },
    hostPrefersDark(): boolean {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    },
  },
});
