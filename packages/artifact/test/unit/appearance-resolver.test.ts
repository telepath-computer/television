// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appearanceResolverScriptSource,
  installAppearanceResolver,
} from "../../src/browser/appearance-resolver.ts";

interface QueryHarness {
  query: MediaQueryList;
  setMatches(matches: boolean): void;
  addListener: ReturnType<typeof vi.fn>;
}

function createQueryHarness(initialMatches: boolean): QueryHarness {
  let matches = initialMatches;
  let listener: ((event: MediaQueryListEvent) => void) | undefined;
  const addListener = vi.fn((_type: string, next: (event: MediaQueryListEvent) => void) => {
    listener = next;
  });
  const query = {
    get matches() { return matches; },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: addListener,
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  return {
    query,
    addListener,
    setMatches(nextMatches) {
      matches = nextMatches;
      listener?.({ matches } as MediaQueryListEvent);
    },
  };
}

describe("appearance resolver", () => {
  let harness: QueryHarness;

  beforeEach(() => {
    delete window.__televisionAppearanceResolver;
    delete document.documentElement.dataset.theme;
    harness = createQueryHarness(false);
    vi.stubGlobal("matchMedia", vi.fn(() => harness.query));
  });

  afterEach(() => {
    delete window.__televisionAppearanceResolver;
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });

  it("applies explicit preferences immediately", () => {
    const controller = installAppearanceResolver("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    controller.setPreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows media-query changes only while the preference is system", () => {
    const controller = installAppearanceResolver("system");
    expect(document.documentElement.dataset.theme).toBe("light");

    harness.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    controller.setPreference("light");
    harness.setMatches(false);
    harness.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps the first controller and preference across repeated installation", () => {
    const first = installAppearanceResolver("dark");
    const second = installAppearanceResolver("light");

    expect(second).toBe(first);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(harness.addListener).toHaveBeenCalledOnce();
  });

  it("serializes the same installer for classic-script use", () => {
    Function(appearanceResolverScriptSource('"dark"'))();

    expect(window.__televisionAppearanceResolver).toBeDefined();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(harness.addListener).toHaveBeenCalledOnce();
  });
});
