import { describe, expect, it } from "vitest";

import { AppError, isAppError, type JsonValue } from "@/server/http/errors";

describe("AppError", () => {
  it("constructs a valid expected application error", () => {
    const error = new AppError({
      status: 422,
      code: "VALIDATION_FAILED",
      message: "  The request is invalid  ",
      details: { field: "pickupDate", reasons: ["required", "date-only"] },
      headers: { "Retry-After": "60" },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe("AppError");
    expect(error.message).toBe("The request is invalid");
    expect(error.status).toBe(422);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toEqual({
      field: "pickupDate",
      reasons: ["required", "date-only"],
    });
    expect(error.headers).toEqual({ "Retry-After": "60" });
  });

  it("defaults details and headers to frozen empty objects", () => {
    const error = new AppError({
      status: 404,
      code: "NOT_FOUND",
      message: "Not found",
    });

    expect(error.details).toEqual({});
    expect(error.headers).toEqual({});
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen(error.headers)).toBe(true);
  });

  it("copies and shallowly freezes caller details", () => {
    const details: Record<string, JsonValue> = { field: "before" };
    const error = new AppError({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Invalid",
      details,
    });

    details.field = "after";

    expect(error.details).toEqual({ field: "before" });
    expect(error.details).not.toBe(details);
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it("copies and shallowly freezes caller headers", () => {
    const headers: Record<string, string> = { "Retry-After": "60" };
    const error = new AppError({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Try later",
      headers,
    });

    headers["Retry-After"] = "1";

    expect(error.headers).toEqual({ "Retry-After": "60" });
    expect(error.headers).not.toBe(headers);
    expect(Object.isFrozen(error.headers)).toBe(true);
  });

  it("preserves the cause internally without serializing it", () => {
    const cause = new Error("private database detail");
    const error = new AppError({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Try again later",
      cause,
    });

    expect(error.cause).toBe(cause);
    expect(JSON.stringify(error)).not.toContain("private database detail");
    expect(JSON.stringify(error)).not.toContain("cause");
  });

  it.each([399, 600, 400.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid status %s",
    (status) => {
      expect(
        () =>
          new AppError({
            status,
            code: "INVALID_STATUS",
            message: "Invalid",
          }),
      ).toThrow(TypeError);
    },
  );

  it.each(["", "   ", "not_found", "NOT-FOUND", "NOT FOUND", "1_NOT_FOUND"])(
    "rejects invalid code %j",
    (code) => {
      expect(
        () => new AppError({ status: 400, code, message: "Invalid" }),
      ).toThrow(TypeError);
    },
  );

  it.each(["", "   "])("rejects an empty message %j", (message) => {
    expect(
      () => new AppError({ status: 400, code: "INVALID", message }),
    ).toThrow(TypeError);
  });

  it.each([
    ["empty header name", "", "value"],
    ["whitespace-only header name", "   ", "value"],
    ["CR in header name", "Bad\rName", "value"],
    ["LF in header name", "Bad\nName", "value"],
    ["CR in header value", "X-Safe", "bad\rvalue"],
    ["LF in header value", "X-Safe", "bad\nvalue"],
  ])("rejects %s", (_description, name, value) => {
    expect(
      () =>
        new AppError({
          status: 400,
          code: "INVALID_HEADER",
          message: "Invalid",
          headers: { [name]: value },
        }),
    ).toThrow(TypeError);
  });
});

describe("isAppError", () => {
  it("returns true for an actual AppError", () => {
    const error = new AppError({
      status: 403,
      code: "INVALID_ORIGIN",
      message: "Request origin is not allowed",
    });

    expect(isAppError(error)).toBe(true);
  });

  it.each([
    new Error("ordinary"),
    { name: "AppError" },
    "AppError",
    null,
    undefined,
    403,
  ])("returns false for non-AppError value %#", (value) => {
    expect(isAppError(value)).toBe(false);
  });
});
