import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AGENT_TYPES,
  ARTIFACT_DELETION_CAUSES,
  ARTIFACT_SKILLS,
  AUTH_MODES,
  CHANNEL_PINS_CHANGE_TYPES,
  LAYOUT_CHANGE_TYPES,
  type AgentType,
  type BuiltTelemetryEvent,
  type TelemetryEvent,
  type TelemetryEventProperties,
  type TelemetryPersonProperties,
  telemetryVersion,
} from "./types.ts";

describe("telemetry event and property vocabulary", () => {
  it("accepts only the closed event names", () => {
    const valid = { name: "server_started", properties: {} } satisfies TelemetryEvent;
    const redesign = [
      { name: "channel_pins_changed", properties: { pin_change_type: "reorder", pinned_channel_count: 2 } },
      { name: "tab_page_full_screen_changed", properties: { full_screen: true } },
      { name: "artifact_skill_prompt_copy_clicked", properties: { artifact_skill: "calendar" } },
      { name: "artifact_deleted", properties: { deletion_cause: "channel_deleted" } },
    ] satisfies TelemetryEvent[];
    expect(valid.name).toBe("server_started");
    expect(redesign.map(({ name }) => name)).toEqual([
      "channel_pins_changed",
      "tab_page_full_screen_changed",
      "artifact_skill_prompt_copy_clicked",
      "artifact_deleted",
    ]);

    // @ts-expect-error unknown telemetry events cannot be constructed.
    const invalid = { name: "server_crashed", properties: {} } satisfies TelemetryEvent;
    expect(invalid).toBeDefined();
  });

  it("accepts only closed property names", () => {
    const valid = {
      auth_mode: "auth",
      server_version: telemetryVersion("0.1.170"),
      pre_telemetry: false,
    } satisfies TelemetryEventProperties;
    expect(valid.auth_mode).toBe("auth");
    expect(valid.pre_telemetry).toBe(false);

    const invalid = {
      auth_mode: "auth",
      // @ts-expect-error raw paths have no typed telemetry channel.
      artifact_path: "/Users/alice/project/index.html",
    } satisfies TelemetryEventProperties;
    expect(invalid).toBeDefined();
  });

  it("accepts only closed enum values", () => {
    const authMode = "auth" satisfies TelemetryEventProperties["auth_mode"];
    const agentType = "interactive-install" satisfies AgentType;
    expect(AUTH_MODES).toContain(authMode);
    expect(AGENT_TYPES).toContain(agentType);
    expect(LAYOUT_CHANGE_TYPES).toEqual(["tab_reorder"]);
    expect(CHANNEL_PINS_CHANGE_TYPES).toEqual(["pin", "unpin", "reorder", "replace"]);
    expect(ARTIFACT_DELETION_CAUSES).toEqual(["direct", "channel_deleted"]);
    expect(ARTIFACT_SKILLS).toEqual(["calendar", "table", "tasks", "markdown"]);

    // @ts-expect-error auth modes are closed.
    const invalidAuth = "oauth" satisfies TelemetryEventProperties["auth_mode"];
    // @ts-expect-error agent types are closed.
    const invalidAgent = "random-agent" satisfies AgentType;
    // @ts-expect-error layout change values cannot carry pin operations.
    const invalidLayoutChange = "pin" satisfies TelemetryEventProperties["change_type"];
    // @ts-expect-error pin change values cannot carry layout operations.
    const invalidPinChange = "tab_reorder" satisfies TelemetryEventProperties["pin_change_type"];
    expect([invalidAuth, invalidAgent, invalidLayoutChange, invalidPinChange]).toBeDefined();
  });

  it("accepts open-ended installed_by_agent product names", () => {
    const event = {
      name: "server_started",
      distinctId: "telemetry-user",
      properties: {
        distinct_id: "telemetry-user",
        installed_by_agent: "novel harness",
        server_version: telemetryVersion("0.1.170"),
      },
    } satisfies BuiltTelemetryEvent;

    expect(event.properties.installed_by_agent).toBe("novel harness");
    expectTypeOf<TelemetryEventProperties["installed_by_agent"]>().toEqualTypeOf<string | undefined>();

    const harnessEvent = { installed_by_agent: "Novel Agent" } satisfies TelemetryEventProperties;
    const harnessPerson = { installed_by_agent: "Another Harness" } satisfies TelemetryPersonProperties;
    expect([harnessEvent, harnessPerson]).toBeDefined();

    // @ts-expect-error version properties must be explicitly marked as versions, not arbitrary free text.
    const invalidVersion = { server_version: "alice-private-build" } satisfies TelemetryEventProperties;
    expect(invalidVersion).toBeDefined();
  });
  // Contract: proofs/arch/telemetry/index.md#^t-theme-settings-vocabulary.
  // These probes are checked by TypeScript; Vitest alone does not check satisfies.
  it("TV-755 accepts closed settings in events and person properties", () => {
    const settings = {
      theme_state: "clouds",
      theme_main_js_declared: true,
      theme_main_js_enabled: false,
      theme_iframe_background_enabled: true,
      theme_iframe_overlay_enabled: false,
      appearance_mode: "system",
    } satisfies TelemetryPersonProperties;
    const events = [
      ...(["selection", "fallback"] as const).map((reason) => ({
        name: "theme_changed" as const,
        properties: {
          theme_state: settings.theme_state,
          theme_main_js_declared: settings.theme_main_js_declared,
          theme_main_js_enabled: settings.theme_main_js_enabled,
          theme_iframe_background_enabled: settings.theme_iframe_background_enabled,
          theme_iframe_overlay_enabled: settings.theme_iframe_overlay_enabled,
          theme_count: 1,
          theme_change_reason: reason,
        },
        personProperties: settings,
      } satisfies TelemetryEvent)),
      ...(["light", "dark", "system"] as const).map((mode) => ({
        name: "appearance_mode_changed",
        properties: { appearance_mode: mode },
        personProperties: { ...settings, appearance_mode: mode },
      } satisfies TelemetryEvent)),
      { name: "session_activity", properties: settings, personProperties: settings } satisfies TelemetryEvent,
    ];
    expect(events.map(({ name }) => name)).toContain("appearance_mode_changed");

    // @ts-expect-error user-authored theme IDs cannot be sent.
    const privateTheme = { theme_state: "alice-secret-theme" } satisfies TelemetryPersonProperties;
    // @ts-expect-error consent lists cannot be sent.
    const consent = { themeJavaScriptConsentIds: ["alice-secret-theme"] } satisfies TelemetryPersonProperties;
    // @ts-expect-error only selection/fallback are allowed.
    const reason = "reload" satisfies TelemetryEventProperties["theme_change_reason"];
    // @ts-expect-error UI labels are not telemetry appearance values.
    const mode = "adapt" satisfies TelemetryEventProperties["appearance_mode"];
    // @ts-expect-error configured-use fields are booleans.
    const declared = "true" satisfies TelemetryEventProperties["theme_main_js_declared"];
    // @ts-expect-error configured-use fields are booleans.
    const enabled = 1 satisfies TelemetryPersonProperties["theme_main_js_enabled"];
    // @ts-expect-error configured-use fields are booleans.
    const background = "yes" satisfies TelemetryEventProperties["theme_iframe_background_enabled"];
    // @ts-expect-error configured-use fields are booleans.
    const overlay = null satisfies TelemetryPersonProperties["theme_iframe_overlay_enabled"];
    expect([privateTheme, consent, reason, mode, declared, enabled, background, overlay]).toBeDefined();
  });

});
