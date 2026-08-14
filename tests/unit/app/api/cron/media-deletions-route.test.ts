import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  requireCronAuthorization: vi.fn(),
  process: vi.fn(),
}));

vi.mock("@/server/http/cron-guard", () => ({
  requireCronAuthorization: mocks.requireCronAuthorization,
}));
vi.mock("@/server/media-deletion-queue/services", () => ({
  getMediaDeletionRetryService: () => ({ process: mocks.process }),
}));

import { POST as runCron } from "@/app/api/cron/media-deletions/route";

function request(authorization?: string): Request {
  return new Request("http://localhost:3000/api/cron/media-deletions", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });
}

const noContext = undefined as never;

beforeEach(() => {
  mocks.requireCronAuthorization.mockReset();
  mocks.process.mockReset();
  mocks.process.mockResolvedValue({
    selected: 3,
    deleted: 2,
    retained: 0,
    failed: 1,
  });
});

describe("cron media-deletions route", () => {
  it("returns 401 without invoking the retry service when unauthorized", async () => {
    mocks.requireCronAuthorization.mockImplementation(() => {
      throw new AppError({
        status: 401,
        code: "CRON_UNAUTHORIZED",
        message: "Cron authorization required.",
      });
    });
    const response = await runCron(request(), noContext);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CRON_UNAUTHORIZED" },
    });
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("runs the retry service and returns safe counts, never cached", async () => {
    mocks.requireCronAuthorization.mockReturnValue(undefined);
    const response = await runCron(request("Bearer secret"), noContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      result: { selected: 3, deleted: 2, retained: 0, failed: 1 },
    });
  });

  it("does not apply browser-origin validation to the server-to-server request", async () => {
    mocks.requireCronAuthorization.mockReturnValue(undefined);
    // No Origin header and no allowed-origin match — still processed.
    const response = await runCron(request("Bearer secret"), noContext);
    expect(response.status).toBe(200);
  });
});
