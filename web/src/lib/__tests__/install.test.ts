import { describe, expect, it } from "vitest";
import { installMode, isSnoozed, SNOOZE_DAYS } from "../util/install";
import type { InstallEnv } from "../util/install";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const DESKTOP_SAFARI = IPAD_SAFARI;

const env = (over: Partial<InstallEnv> = {}): InstallEnv => ({ standalone: false, userAgent: ANDROID, maxTouchPoints: 5, hasPrompt: false, snoozed: false, ...over });

describe("add to home screen", () => {
  it("offers the native dialog when the browser handed over its install event", () => {
    expect(installMode(env({ hasPrompt: true }))).toBe("prompt");
  });

  it("explains the share menu on iPhone / iPad Safari, where there is no install event", () => {
    expect(installMode(env({ userAgent: IPHONE_SAFARI }))).toBe("ios");
    expect(installMode(env({ userAgent: IPAD_SAFARI, maxTouchPoints: 5 }))).toBe("ios");
  });

  it("offers nothing where it cannot work", () => {
    expect(installMode(env())).toBeNull(); // Android before the browser says it is installable
    expect(installMode(env({ userAgent: IPHONE_CHROME }))).toBeNull(); // other iOS browsers cannot add to the home screen
    expect(installMode(env({ userAgent: DESKTOP_SAFARI, maxTouchPoints: 0 }))).toBeNull(); // a Mac, not an iPad
  });

  it("stays away once installed or put away", () => {
    expect(installMode(env({ hasPrompt: true, standalone: true }))).toBeNull();
    expect(installMode(env({ userAgent: IPHONE_SAFARI, standalone: true }))).toBeNull();
    expect(installMode(env({ hasPrompt: true, snoozed: true }))).toBeNull();
  });

  it("snoozes for two weeks", () => {
    const now = Date.UTC(2026, 10, 10);
    expect(isSnoozed(null, now)).toBe(false);
    expect(isSnoozed("garbage", now)).toBe(false);
    expect(isSnoozed(String(now - 86_400_000), now)).toBe(true);
    expect(isSnoozed(String(now - (SNOOZE_DAYS + 1) * 86_400_000), now)).toBe(false);
  });
});
