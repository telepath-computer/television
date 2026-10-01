import type { Event as ElectronEvent, Input } from "electron";

export const NATIVE_NAVIGATION_KEY_CHANNEL = "television:navigation-key";

export type NativeNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown";

export type NativeKeyInput = Pick<
  Input,
  | "type"
  | "key"
  | "isAutoRepeat"
  | "isComposing"
  | "shift"
  | "control"
  | "alt"
  | "meta"
>;

type NativeKeyEvent = Pick<ElectronEvent, "preventDefault">;

export function isNativeNavigationKey(value: unknown): value is NativeNavigationKey {
  return value === "ArrowLeft" ||
    value === "ArrowRight" ||
    value === "ArrowUp" ||
    value === "ArrowDown";
}

export function handleNativeNavigationKey(
  event: NativeKeyEvent,
  input: NativeKeyInput,
  platform: NodeJS.Platform,
  deliver: (key: NativeNavigationKey) => void,
): boolean {
  if (input.type !== "keyDown" || input.isComposing || !isNativeNavigationKey(input.key)) {
    return false;
  }

  const matchesPlatformChord = platform === "darwin"
    ? input.alt && !input.control && !input.meta && !input.shift
    : input.control && !input.alt && !input.meta && !input.shift;
  if (!matchesPlatformChord) return false;

  event.preventDefault();
  deliver(input.key);
  return true;
}
