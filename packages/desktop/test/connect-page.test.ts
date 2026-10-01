// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  bindConnectPage,
  initConnectPage,
  MIN_CONNECT_MS,
  type ConnectPageAPI,
  type ConnectPageElements,
} from "../src/connect-page.ts";

const connectHtmlPath = path.join(__dirname, "../src/connect.html");

function mockElements(): ConnectPageElements {
  const form = document.createElement("form");
  const errorEl = document.createElement("div");
  const submitButton = document.createElement("button");
  const submitLabel = document.createElement("span");
  submitLabel.className = "button-label";
  submitLabel.textContent = "Connect";
  submitButton.append(submitLabel);
  const serverInput = document.createElement("input");
  const tokenInput = document.createElement("input");
  form.append(errorEl, submitButton, serverInput, tokenInput);
  document.body.append(form);
  return { form, errorEl, submitButton, submitLabel, serverInput, tokenInput };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("bindConnectPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(0) });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("prefills saved connection but does not auto-connect in manual mode", async () => {
    const elements = mockElements();
    const connect = vi.fn(async () => ({ ok: true as const }));
    const api: ConnectPageAPI = {
      getConnectScreenIntent: async () => "manual",
      getConnection: async () => ({ serverURL: "http://localhost:1", token: "saved-token" }),
      connect,
    };

    bindConnectPage(api, elements);
    await vi.waitFor(() => {
      expect(elements.serverInput.value).toBe("http://localhost:1");
    });
    expect(elements.tokenInput.value).toBe("saved-token");
    expect(connect).not.toHaveBeenCalled();
  });

  it("auto-connects saved connection only in bootstrap mode", async () => {
    const elements = mockElements();
    const connect = vi.fn(async () => ({ ok: true as const }));
    const api: ConnectPageAPI = {
      getConnectScreenIntent: async () => "bootstrap",
      getConnection: async () => ({ serverURL: "http://localhost:1", token: "saved-token" }),
      connect,
    };

    bindConnectPage(api, elements);
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledWith("http://localhost:1", "saved-token");
    });
  });

  it("bootstrap prefill survives a failed auto-connect", async () => {
    const elements = mockElements();
    const connect = vi.fn(async () => ({ ok: false as const, message: "Token rejected" }));
    bindConnectPage(
      {
        getConnectScreenIntent: async () => "bootstrap",
        getConnection: async () => ({ serverURL: "http://localhost:9", token: "bad" }),
        connect,
      },
      elements,
    );

    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(MIN_CONNECT_MS);

    expect(elements.serverInput.value).toBe("http://localhost:9");
    expect(elements.tokenInput.value).toBe("bad");
    expect(elements.errorEl.textContent).toBe("Token rejected");
    expect(elements.submitButton.disabled).toBe(false);
  });

  it("form submit sends the entered url and token to connect", async () => {
    const elements = mockElements();
    elements.serverInput.value = "  http://localhost:1  ";
    elements.tokenInput.value = "  secret  ";
    const connect = vi.fn(async () => ({ ok: true as const }));
    bindConnectPage(
      {
        getConnectScreenIntent: async () => "manual",
        getConnection: async () => null,
        connect,
      },
      elements,
    );
    await vi.waitFor(() => expect(connect).not.toHaveBeenCalled());

    elements.form.requestSubmit();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledWith("http://localhost:1", "  secret  "));
  });

  it("shows user-facing error after failed submit and keeps field values", async () => {
    const elements = mockElements();
    elements.serverInput.value = "http://localhost:1";
    elements.tokenInput.value = "wrong";
    const connect = vi.fn(async () => ({
      ok: false as const,
      message: "This server requires a token",
    }));
    bindConnectPage(
      {
        getConnectScreenIntent: async () => "manual",
        getConnection: async () => null,
        connect,
      },
      elements,
    );
    await vi.waitFor(() => expect(connect).not.toHaveBeenCalled());

    elements.form.requestSubmit();
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    expect(elements.submitButton.dataset.connecting).toBe("true");
    expect(elements.submitLabel.textContent).toBe("Connecting…");

    await vi.advanceTimersByTimeAsync(MIN_CONNECT_MS);

    expect(elements.errorEl.textContent).toBe("This server requires a token");
    expect(elements.serverInput.value).toBe("http://localhost:1");
    expect(elements.tokenInput.value).toBe("wrong");
    expect(elements.submitButton.disabled).toBe(false);
    expect(elements.submitButton.dataset.connecting).toBe("false");
  });

  it("waits at least MIN_CONNECT_MS before showing a failed connect error", async () => {
    const elements = mockElements();
    elements.serverInput.value = "http://localhost:1";
    const connect = vi.fn(async () => ({ ok: false as const, message: "Unreachable" }));
    bindConnectPage(
      {
        getConnectScreenIntent: async () => "manual",
        getConnection: async () => null,
        connect,
      },
      elements,
    );
    await flushMicrotasks();

    elements.form.requestSubmit();
    await flushMicrotasks();
    expect(connect).toHaveBeenCalled();

    expect(elements.errorEl.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(MIN_CONNECT_MS - 1);
    expect(elements.errorEl.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(elements.errorEl.textContent).toBe("Unreachable");
  });

  it("stays in connecting state after successful submit until navigation replaces the page", async () => {
    const elements = mockElements();
    elements.serverInput.value = "http://localhost:1";
    elements.tokenInput.value = "good";
    const connect = vi.fn(async () => ({ ok: true as const }));
    bindConnectPage(
      {
        getConnectScreenIntent: async () => "manual",
        getConnection: async () => null,
        connect,
      },
      elements,
    );
    await vi.waitFor(() => expect(connect).not.toHaveBeenCalled());

    elements.form.requestSubmit();
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());

    expect(elements.errorEl.textContent).toBe("");
    expect(elements.submitButton.disabled).toBe(true);
    expect(elements.submitButton.dataset.connecting).toBe("true");
    expect(elements.submitLabel.textContent).toBe("Connecting…");
  });

  it("clears prior error when submitting again", async () => {
    const elements = mockElements();
    elements.errorEl.textContent = "Old error";
    elements.serverInput.value = "http://localhost:1";
    const connect = vi.fn(async () => ({ ok: true as const }));
    bindConnectPage(
      {
        getConnectScreenIntent: async () => "manual",
        getConnection: async () => null,
        connect,
      },
      elements,
    );
    await vi.waitFor(() => expect(connect).not.toHaveBeenCalled());

    elements.form.requestSubmit();
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    expect(elements.errorEl.textContent).toBe("");
  });

  it("unwraps thrown IPC errors and keeps typed fields sticky", async () => {
    const elements = mockElements();
    elements.serverInput.value = "http://localhost:1";
    elements.tokenInput.value = "wrong";
    const connect = vi.fn(async () => {
      throw new Error("Error invoking remote method 'television:connect': Error: Token rejected");
    });
    bindConnectPage(
      {
        getConnectScreenIntent: async () => "manual",
        getConnection: async () => null,
        connect,
      },
      elements,
    );
    await vi.waitFor(() => expect(connect).not.toHaveBeenCalled());

    elements.form.requestSubmit();
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(MIN_CONNECT_MS);

    expect(elements.errorEl.textContent).toBe("Token rejected");
    expect(elements.serverInput.value).toBe("http://localhost:1");
    expect(elements.tokenInput.value).toBe("wrong");
  });
});

describe("initConnectPage with connect.html", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("wires the real connect.html form and allows external connect-page script under CSP", async () => {
    const html = readFileSync(connectHtmlPath, "utf8");
    expect(html).toContain("script-src 'self' 'unsafe-inline'");
    expect(html).toContain('src="connect-page.cjs"');

    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;

    const connect = vi.fn(async () => ({ ok: true as const }));
    initConnectPage({
      getConnectScreenIntent: async () => "manual",
      getConnection: async () => ({ serverURL: "http://localhost:32848", token: "persisted" }),
      connect,
    });

    await vi.waitFor(() => {
      expect((document.getElementById("serverURL") as HTMLInputElement).value).toBe("http://localhost:32848");
    });
    expect((document.getElementById("token") as HTMLInputElement).value).toBe("persisted");
    expect(connect).not.toHaveBeenCalled();
  });
});
