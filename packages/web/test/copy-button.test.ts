// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit-html";
import {
  copyButtonTemplate,
  type CopyButtonDependencies,
  type CopyButtonScheduler,
  type CopyButtonTemplateOptions,
} from "../src/views/copy-button.ts";

afterEach(() => document.body.replaceChildren());

interface CopyButtonFixture extends CopyButtonTemplateOptions {
  name: string;
  expectedIntent: string | null;
}

const fixtures: CopyButtonFixture[] = [
  {
    name: "idle default",
    label: "Copy prompt",
    prompt: "Create a calendar",
    expectedIntent: null,
  },
  {
    name: "copied primary",
    label: "Copy upgrade prompt",
    prompt: "Upgrade Television",
    intent: "primary",
    copied: true,
    expectedIntent: "primary",
  },
];

describe("copyButtonTemplate (^cb-ac-markup-smoke)", () => {
  it.each(fixtures)("renders the $name state", (fixture) => {
    const host = document.createElement("main");
    document.body.append(host);

    render(copyButtonTemplate(fixture), host);

    expect(host.children).toHaveLength(2);
    const button = host.querySelector<HTMLButtonElement>("button.copy-button");
    expect(button).toBe(host.firstElementChild);
    expect(button?.getAttribute("size")).toBe("sm");
    expect(button?.getAttribute("aria-label")).toBe(fixture.label);
    expect(button?.getAttribute("prompt")).toBe(fixture.prompt);
    expect(button?.getAttribute("intent")).toBe(fixture.expectedIntent);
    expect(button?.hasAttribute("copied")).toBe(fixture.copied ?? false);

    const idle = button?.querySelector(".copy-button-idle");
    const done = button?.querySelector(".copy-button-done");
    expect(idle?.textContent?.trim()).toBe(fixture.label);
    expect(idle?.querySelector("tv-icon")?.getAttribute("name")).toBe("copy");
    expect(done?.textContent?.trim()).toBe("Copied");
    expect(done?.querySelector("tv-icon")?.getAttribute("name")).toBe("check");

    const status = host.querySelector<HTMLElement>(
      ":scope > .copy-button-status",
    );
    expect(status).toBe(host.lastElementChild);
    expect(button?.contains(status)).toBe(false);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent?.trim()).toBe(fixture.copied ? "Copied" : "");
  });
});

describe("copy button clipboard rejection (^cb-ac-clipboard-rejection)", () => {
  it("absorbs one rejected modern write without invoking the legacy fallback", async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
    const rejectedWrite = Promise.reject(new Error("clipboard denied"));
    const catchRejection = vi.spyOn(rejectedWrite, "catch");
    const writeText = vi.fn().mockReturnValue(rejectedWrite);
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    try {
      const host = document.createElement("main");
      document.body.append(host);
      render(
        copyButtonTemplate({ label: "Copy prompt", prompt: "THE PROMPT TEXT" }),
        host,
      );
      const button = host.querySelector<HTMLButtonElement>("button.copy-button");
      expect(button).not.toBeNull();

      document.execCommand("copy");
      expect(execCommand).toHaveBeenCalledOnce();
      execCommand.mockClear();

      button!.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledOnce();
      expect(writeText).toHaveBeenCalledWith("THE PROMPT TEXT");
      expect(execCommand).not.toHaveBeenCalled();
      expect(catchRejection).toHaveBeenCalledOnce();
      expect(catchRejection).toHaveBeenCalledWith(expect.any(Function));
      await expect(catchRejection.mock.results[0]?.value).resolves.toBeUndefined();
      expect(button?.hasAttribute("copied")).toBe(true);
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
      if (execCommandDescriptor) {
        Object.defineProperty(document, "execCommand", execCommandDescriptor);
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }
  });
});

class FakeScheduler implements CopyButtonScheduler {
  #now = 0;
  #nextId = 1;
  #tasks = new Map<number, { at: number; callback(): void }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.#nextId++;
    this.#tasks.set(id, { at: this.#now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.#tasks.delete(handle);
  }

  advanceBy(elapsedMs: number): void {
    const target = this.#now + elapsedMs;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [id, task] = next;
      this.#tasks.delete(id);
      this.#now = task.at;
      task.callback();
    }
    this.#now = target;
  }
}

describe("copy button activation callback (^cb-ac-activate-callback)", () => {
  it("invokes the caller activation callback once per copy attempt", () => {
    const writes: string[] = [];
    const observedWriteCounts: number[] = [];
    const scheduler = new FakeScheduler();
    const dependencies: CopyButtonDependencies = {
      writeClipboard: (text) => writes.push(text),
      scheduler,
    };
    const host = document.createElement("main");
    document.body.append(host);

    render(
      copyButtonTemplate(
        {
          label: "Copy prompt",
          prompt: "THE PROMPT TEXT",
          onActivate: () => observedWriteCounts.push(writes.length),
        },
        dependencies,
      ),
      host,
    );
    const button = host.querySelector<HTMLButtonElement>("button.copy-button");
    expect(button).not.toBeNull();

    button!.click();
    button!.click();

    expect(writes).toEqual(["THE PROMPT TEXT", "THE PROMPT TEXT"]);
    expect(observedWriteCounts).toEqual([1, 2]);
  });
});

const BEFORE_DWELL_BOUNDARY_MS = 1_399;

describe("copy button confirmation (^cb-ac-dwell)", () => {
  it("announces politely and changes back to idle at exactly 1,400 ms", async () => {
    const writes: string[] = [];
    const scheduler = new FakeScheduler();
    const dependencies: CopyButtonDependencies = {
      writeClipboard: (text) => writes.push(text),
      scheduler,
    };
    const host = document.createElement("main");
    document.body.append(host);

    render(
      copyButtonTemplate(
        { label: "Copy prompt", prompt: "THE PROMPT TEXT" },
        dependencies,
      ),
      host,
    );
    const button = host.querySelector<HTMLButtonElement>("button.copy-button");
    const status = host.querySelector<HTMLElement>(
      ":scope > [role='status'][aria-live='polite']",
    );
    expect(button).not.toBeNull();
    expect(status).not.toBeNull();

    button!.click();
    await Promise.resolve();
    expect(writes).toEqual(["THE PROMPT TEXT"]);
    expect(button?.hasAttribute("copied")).toBe(true);
    expect(button?.getAttribute("aria-label")).toBe("Copy prompt");
    expect(status?.textContent?.trim()).toBe("Copied");

    scheduler.advanceBy(BEFORE_DWELL_BOUNDARY_MS);
    await Promise.resolve();
    expect(button?.hasAttribute("copied")).toBe(true);
    expect(status?.textContent?.trim()).toBe("Copied");

    scheduler.advanceBy(1);
    await Promise.resolve();
    expect(button?.hasAttribute("copied")).toBe(false);
    expect(status?.textContent?.trim()).toBe("");
  });
});
