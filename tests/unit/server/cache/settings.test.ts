import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ keys: string[]; options: { tags?: string[] } }>,
  values: new Map<string, Promise<unknown>>(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    load: () => Promise<unknown>,
    keys: string[],
    options: { tags?: string[] },
  ) => {
    mocks.calls.push({ keys, options });
    return () => {
      const key = JSON.stringify(keys);
      const existing = mocks.values.get(key);
      if (existing !== undefined) return existing;
      const value = load();
      mocks.values.set(key, value);
      return value;
    };
  },
}));

import {
  getCachedPublicSettings,
  SETTINGS_CACHE_TAG,
} from "@/server/cache/settings";

describe("public settings cache", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.values.clear();
  });

  it("uses the stable settings tag and cached server read on the second call", async () => {
    const load = vi.fn().mockResolvedValue({ businessName: "Test" });
    await getCachedPublicSettings(load as never);
    await getCachedPublicSettings(load as never);
    expect(load).toHaveBeenCalledTimes(1);
    expect(SETTINGS_CACHE_TAG).toBe("settings");
    expect(
      mocks.calls.every((call) => call.options.tags?.includes("settings")),
    ).toBe(true);
  });
});
