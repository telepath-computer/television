import { describe, expect, it } from "vitest";
import {
  isContentUpdatedNotification,
  isReadyNotification,
  isResponseMessage,
  isStylesChangedNotification,
  isUpdateContentRequest,
} from "../../src/artifact-view-protocol.ts";

describe("isReadyNotification", () => {
  it("accepts the canonical ready notification", () => {
    expect(isReadyNotification({ type: "ready" })).toBe(true);
  });

  it("rejects messages with an id field (requests shape)", () => {
    expect(isReadyNotification({ type: "ready", id: "abc" })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isReadyNotification(null)).toBe(false);
    expect(isReadyNotification(undefined)).toBe(false);
    expect(isReadyNotification("ready")).toBe(false);
    expect(isReadyNotification(42)).toBe(false);
  });

  it("rejects other message types", () => {
    expect(isReadyNotification({ type: "content-updated", content: "x" })).toBe(false);
    expect(isReadyNotification({ type: "banana" })).toBe(false);
    expect(isReadyNotification({})).toBe(false);
  });
});

describe("isContentUpdatedNotification", () => {
  it("accepts a valid content-updated notification", () => {
    expect(isContentUpdatedNotification({ type: "content-updated", content: "hello" })).toBe(true);
    expect(isContentUpdatedNotification({ type: "content-updated", content: "" })).toBe(true);
  });

  it("rejects missing or non-string content", () => {
    expect(isContentUpdatedNotification({ type: "content-updated" })).toBe(false);
    expect(isContentUpdatedNotification({ type: "content-updated", content: 123 })).toBe(false);
    expect(isContentUpdatedNotification({ type: "content-updated", content: null })).toBe(false);
  });

  it("rejects messages that look like requests", () => {
    expect(
      isContentUpdatedNotification({ type: "content-updated", content: "x", id: "abc" }),
    ).toBe(false);
  });

  it("rejects non-object and wrong-type values", () => {
    expect(isContentUpdatedNotification(null)).toBe(false);
    expect(isContentUpdatedNotification({ type: "ready" })).toBe(false);
    expect(isContentUpdatedNotification("content-updated")).toBe(false);
  });
});

describe("isStylesChangedNotification", () => {
  it("accepts only the fieldless theme-only notification", () => {
    expect(isStylesChangedNotification({ type: "styles-changed" })).toBe(true);
    expect(isStylesChangedNotification({ type: "styles-changed", id: "abc" })).toBe(false);
    expect(isStylesChangedNotification({ type: "styles-changed", content: "x" })).toBe(false);
    expect(isStylesChangedNotification({ type: "content-updated" })).toBe(false);
    expect(isStylesChangedNotification(null)).toBe(false);
  });
});

describe("isUpdateContentRequest", () => {
  it("accepts a valid update-content request", () => {
    expect(isUpdateContentRequest({ type: "update-content", id: "abc", content: "x" })).toBe(true);
  });

  it("rejects when id is missing or not a string", () => {
    expect(isUpdateContentRequest({ type: "update-content", content: "x" })).toBe(false);
    expect(isUpdateContentRequest({ type: "update-content", id: 1, content: "x" })).toBe(false);
    expect(isUpdateContentRequest({ type: "update-content", id: null, content: "x" })).toBe(false);
  });

  it("rejects when content is missing or not a string", () => {
    expect(isUpdateContentRequest({ type: "update-content", id: "abc" })).toBe(false);
    expect(isUpdateContentRequest({ type: "update-content", id: "abc", content: 1 })).toBe(false);
  });

  it("rejects unrelated types and non-objects", () => {
    expect(isUpdateContentRequest({ type: "ready", id: "abc", content: "x" })).toBe(false);
    expect(isUpdateContentRequest(null)).toBe(false);
    expect(isUpdateContentRequest("update-content")).toBe(false);
  });
});

describe("isResponseMessage", () => {
  it("accepts an ok response with empty result object", () => {
    expect(isResponseMessage({ type: "response", id: "abc", result: {} })).toBe(true);
  });

  it("accepts an error response with a string message", () => {
    expect(
      isResponseMessage({ type: "response", id: "abc", error: { message: "boom" } }),
    ).toBe(true);
  });

  it("rejects a response with neither result nor error", () => {
    expect(isResponseMessage({ type: "response", id: "abc" })).toBe(false);
  });

  it("rejects a response with both result and error", () => {
    expect(
      isResponseMessage({ type: "response", id: "abc", result: {}, error: { message: "x" } }),
    ).toBe(false);
  });

  it("rejects a response whose result has extra fields", () => {
    expect(
      isResponseMessage({ type: "response", id: "abc", result: { something: true } }),
    ).toBe(false);
  });

  it("rejects a response whose error has no string message", () => {
    expect(isResponseMessage({ type: "response", id: "abc", error: {} })).toBe(false);
    expect(isResponseMessage({ type: "response", id: "abc", error: { message: 1 } })).toBe(false);
    expect(isResponseMessage({ type: "response", id: "abc", error: null })).toBe(false);
  });

  it("rejects missing or wrong-typed id", () => {
    expect(isResponseMessage({ type: "response", result: {} })).toBe(false);
    expect(isResponseMessage({ type: "response", id: 1, result: {} })).toBe(false);
  });

  it("rejects unrelated message types and non-objects", () => {
    expect(isResponseMessage({ type: "ready", id: "abc", result: {} })).toBe(false);
    expect(isResponseMessage(null)).toBe(false);
    expect(isResponseMessage("response")).toBe(false);
  });
});
