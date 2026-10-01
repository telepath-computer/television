import { describe, expect, it, vi } from "vitest";
import {
  handleNativeNavigationKey,
  type NativeKeyInput,
} from "../src/native-navigation-key.ts";

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;

function input(overrides: Partial<NativeKeyInput> = {}): NativeKeyInput {
  return {
    type: "keyDown",
    key: "ArrowLeft",
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...overrides,
  };
}

function handle(candidate: NativeKeyInput, platform: NodeJS.Platform) {
  const preventDefault = vi.fn();
  const deliver = vi.fn();
  const matched = handleNativeNavigationKey(
    { preventDefault },
    candidate,
    platform,
    deliver,
  );
  return { matched, preventDefault, deliver };
}

// spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-electron-key-contract
describe("Electron native navigation chord", () => {
  for (const { platform, modifier, extraModifiers } of [
    { platform: "darwin", modifier: "alt", extraModifiers: ["control", "meta", "shift"] },
    { platform: "win32", modifier: "control", extraModifiers: ["alt", "meta", "shift"] },
    { platform: "linux", modifier: "control", extraModifiers: ["alt", "meta", "shift"] },
  ] as const) {
    for (const key of ARROWS) {
      it(`consumes and delivers ${modifier}+${key} once on ${platform}`, () => {
        const result = handle(input({ key, [modifier]: true }), platform);

        expect(result.matched).toBe(true);
        expect(result.preventDefault).toHaveBeenCalledOnce();
        expect(result.deliver).toHaveBeenCalledOnce();
        expect(result.deliver).toHaveBeenCalledWith(key);
      });
    }

    it(`accepts an auto-repeated matching keydown on ${platform}`, () => {
      const result = handle(input({ [modifier]: true, isAutoRepeat: true }), platform);

      expect(result.matched).toBe(true);
      expect(result.preventDefault).toHaveBeenCalledOnce();
      expect(result.deliver).toHaveBeenCalledOnce();
    });

    for (const [name, candidate] of [
      ["composition", input({ [modifier]: true, isComposing: true })],
      ["keyup", input({ type: "keyUp", [modifier]: true })],
      ["non-arrow", input({ key: "a", [modifier]: true })],
      ["missing chord", input()],
    ] as const) {
      it(`leaves ${name} untouched on ${platform}`, () => {
        const result = handle(candidate, platform);

        expect(result.matched).toBe(false);
        expect(result.preventDefault).not.toHaveBeenCalled();
        expect(result.deliver).not.toHaveBeenCalled();
      });
    }

    for (const extraModifier of extraModifiers) {
      it(`leaves ${modifier}+${extraModifier}+ArrowLeft untouched on ${platform}`, () => {
        const result = handle(input({ [modifier]: true, [extraModifier]: true }), platform);

        expect(result.matched).toBe(false);
        expect(result.preventDefault).not.toHaveBeenCalled();
        expect(result.deliver).not.toHaveBeenCalled();
      });
    }
  }
});
