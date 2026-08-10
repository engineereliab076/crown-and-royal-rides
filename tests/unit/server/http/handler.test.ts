import { afterEach, describe, expect, it, vi } from "vitest";

import { isValidCorrelationId } from "@/lib/correlation";
import { AppError } from "@/server/http/errors";
import { withRouteHandler } from "@/server/http/handler";
import type { ErrorReporter } from "@/server/http/reporter";

const ALLOWED_ORIGIN = "https://crownrides.co.tz";

interface ParsedErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown;
    correlationId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readErrorEnvelope(
  response: Response,
): Promise<ParsedErrorEnvelope> {
  const value: unknown = await response.json();

  if (!isRecord(value) || !isRecord(value.error)) {
    throw new TypeError("Expected an error envelope.");
  }

  const { code, message, details, correlationId } = value.error;

  if (
    typeof code !== "string" ||
    typeof message !== "string" ||
    typeof correlationId !== "string"
  ) {
    throw new TypeError("Expected an error envelope.");
  }

  return { error: { code, message, details, correlationId } };
}

function requiredOptions(errorReporter?: ErrorReporter) {
  return {
    origin: { mode: "required" as const, allowedOrigin: ALLOWED_ORIGIN },
    errorReporter,
  };
}

function exemptOptions(errorReporter?: ErrorReporter) {
  return {
    origin: { mode: "exempt" as const },
    errorReporter,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configuration validation", () => {
  it.each([
    "http://localhost:3000",
    "https://example.com",
    "https://preview.example.com:8443",
  ])("accepts valid required origin %s", (allowedOrigin) => {
    expect(() =>
      withRouteHandler(() => new Response(null), {
        origin: { mode: "required", allowedOrigin },
      }),
    ).not.toThrow();
  });

  it("normalizes a configured trailing slash", async () => {
    const wrapped = withRouteHandler(() => new Response("ok"), {
      origin: { mode: "required", allowedOrigin: `${ALLOWED_ORIGIN}/` },
    });

    const response = await wrapped(
      new Request("https://service.test/resource", {
        method: "POST",
        headers: { Origin: ALLOWED_ORIGIN },
      }),
      {},
    );

    expect(response.status).toBe(200);
  });

  it.each([
    ["relative", "example.com"],
    ["FTP", "ftp://example.com"],
    ["credentials", "https://user:pass@example.com"],
    ["path", "https://example.com/admin"],
    ["query", "https://example.com?x=1"],
    ["fragment", "https://example.com#fragment"],
    ["malformed", "https://[invalid"],
    ["surrounding whitespace", " https://example.com "],
  ])(
    "rejects %s required-origin configuration",
    (_description, allowedOrigin) => {
      expect(() =>
        withRouteHandler(() => new Response(null), {
          origin: { mode: "required", allowedOrigin },
        }),
      ).toThrow(TypeError);
    },
  );

  it("rejects a malformed runtime policy mode", () => {
    expect(() =>
      Reflect.apply(withRouteHandler, undefined, [
        () => new Response(null),
        { origin: { mode: "sometimes" } },
      ]),
    ).toThrow(TypeError);
  });

  it("rejects a runtime exempt policy containing allowedOrigin", () => {
    expect(() =>
      Reflect.apply(withRouteHandler, undefined, [
        () => new Response(null),
        { origin: { mode: "exempt", allowedOrigin: ALLOWED_ORIGIN } },
      ]),
    ).toThrow(TypeError);
  });
});

describe("origin validation", () => {
  it.each(["GET", "HEAD", "OPTIONS"])(
    "allows safe %s without an Origin header",
    async (method) => {
      const handler = vi.fn(() => new Response(null));
      const wrapped = withRouteHandler(handler, requiredOptions());

      const response = await wrapped(
        new Request("https://service.test/resource", { method }),
        {},
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "allows state-changing %s with the exact Origin",
    async (method) => {
      const handler = vi.fn(() => new Response("ok"));
      const wrapped = withRouteHandler(handler, requiredOptions());

      const response = await wrapped(
        new Request("https://service.test/resource", {
          method,
          headers: { Origin: ALLOWED_ORIGIN },
        }),
        {},
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
    },
  );

  it("normalizes a lowercase state-changing request method", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const wrapped = withRouteHandler(handler, requiredOptions());

    const response = await wrapped(
      new Request("https://service.test/resource", {
        method: "post",
        headers: { Origin: ALLOWED_ORIGIN },
      }),
      {},
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", undefined],
    ["blank", ""],
    ["null", "null"],
    ["malformed", "not an origin"],
    ["protocol mismatch", "http://crownrides.co.tz"],
    ["hostname mismatch", "https://evil.example"],
    ["sibling subdomain", "https://www.crownrides.co.tz"],
    ["malicious suffix", "https://crownrides.co.tz.evil.example"],
    ["host in path", "https://evil.example/crownrides.co.tz"],
    ["port mismatch", "https://crownrides.co.tz:444"],
    ["credentials", "https://user:pass@crownrides.co.tz"],
    ["path", "https://crownrides.co.tz/admin"],
    ["query", "https://crownrides.co.tz?customer=private"],
    ["fragment", "https://crownrides.co.tz#section"],
  ])("rejects a %s Origin", async (_description, origin) => {
    const handler = vi.fn(() => new Response("should not run"));
    const captureException = vi.fn<ErrorReporter["captureException"]>();
    const wrapped = withRouteHandler(
      handler,
      requiredOptions({ captureException }),
    );
    const headers = new Headers();

    if (origin !== undefined) {
      headers.set("Origin", origin);
    }

    const response = await wrapped(
      new Request("https://service.test/resource", {
        method: "POST",
        headers,
      }),
      {},
    );
    const body = await readErrorEnvelope(response);

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("INVALID_ORIGIN");
    expect(body.error.message).toBe("Request origin is not allowed");

    if (origin !== undefined && origin.length > 0) {
      expect(JSON.stringify(body)).not.toContain(origin);
    }

    expect(handler).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not trust Host, X-Forwarded-Host, or Referer without Origin", async () => {
    const handler = vi.fn(() => new Response("should not run"));
    const wrapped = withRouteHandler(handler, requiredOptions());

    const response = await wrapped(
      new Request("https://service.test/resource", {
        method: "POST",
        headers: {
          Host: "crownrides.co.tz",
          "X-Forwarded-Host": "crownrides.co.tz",
          Referer: `${ALLOWED_ORIGIN}/form`,
        },
      }),
      {},
    );

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows exempt POST requests without Origin", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const wrapped = withRouteHandler(handler, exemptOptions());

    const response = await wrapped(
      new Request("https://service.test/inquiry", { method: "POST" }),
      {},
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("allows exempt POST requests with a foreign Origin", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const wrapped = withRouteHandler(handler, exemptOptions());

    const response = await wrapped(
      new Request("https://service.test/inquiry", {
        method: "POST",
        headers: { Origin: "https://foreign.example" },
      }),
      {},
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("correlation IDs", () => {
  it("passes the same fresh valid ID to the handler and success header", async () => {
    let executionId: string | undefined;
    const wrapped = withRouteHandler((_request, _context, execution) => {
      executionId = execution.correlationId;
      return new Response("ok");
    }, exemptOptions());

    const response = await wrapped(new Request("https://service.test/ok"), {});
    const headerId = response.headers.get("X-Correlation-ID");

    expect(headerId).not.toBeNull();
    expect(headerId === null ? false : isValidCorrelationId(headerId)).toBe(
      true,
    );
    expect(executionId).toBe(headerId);
  });

  it("uses different IDs for two requests", async () => {
    const wrapped = withRouteHandler(() => new Response("ok"), exemptOptions());

    const first = await wrapped(new Request("https://service.test/one"), {});
    const second = await wrapped(new Request("https://service.test/two"), {});

    expect(first.headers.get("X-Correlation-ID")).not.toBe(
      second.headers.get("X-Correlation-ID"),
    );
  });

  it("ignores an incoming correlation ID", async () => {
    const incoming = "550e8400-e29b-41d4-a716-446655440000";
    const wrapped = withRouteHandler(() => new Response("ok"), exemptOptions());

    const response = await wrapped(
      new Request("https://service.test/ok", {
        headers: { "X-Correlation-ID": incoming },
      }),
      {},
    );

    expect(response.headers.get("X-Correlation-ID")).not.toBe(incoming);
  });

  it("replaces an existing response correlation value with exactly one header", async () => {
    const wrapped = withRouteHandler(
      () =>
        new Response("ok", {
          headers: { "X-Correlation-ID": "incorrect" },
        }),
      exemptOptions(),
    );

    const response = await wrapped(new Request("https://service.test/ok"), {});
    const value = response.headers.get("X-Correlation-ID");
    const keys = [...response.headers.keys()].filter(
      (key) => key.toLowerCase() === "x-correlation-id",
    );

    expect(value).not.toBe("incorrect");
    expect(value === null ? false : isValidCorrelationId(value)).toBe(true);
    expect(keys).toHaveLength(1);
    expect(value).not.toContain(",");
  });

  it.each([
    [
      "expected error",
      () => {
        throw new AppError({
          status: 409,
          code: "CONFLICT",
          message: "Conflict",
        });
      },
    ],
    [
      "unexpected error",
      () => {
        throw new Error("private");
      },
    ],
  ] as const)(
    "matches the %s body and header correlation ID",
    async (_name, handler) => {
      const wrapped = withRouteHandler(handler, exemptOptions());
      const response = await wrapped(
        new Request("https://service.test/fail"),
        {},
      );
      const body = await readErrorEnvelope(response);
      const headerId = response.headers.get("X-Correlation-ID");

      expect(body.error.correlationId).toBe(headerId);
      expect(isValidCorrelationId(body.error.correlationId)).toBe(true);
    },
  );

  it("adds the same valid ID to an origin rejection", async () => {
    const wrapped = withRouteHandler(
      () => new Response("unused"),
      requiredOptions(),
    );
    const response = await wrapped(
      new Request("https://service.test/fail", { method: "POST" }),
      {},
    );
    const body = await readErrorEnvelope(response);

    expect(body.error.correlationId).toBe(
      response.headers.get("X-Correlation-ID"),
    );
    expect(isValidCorrelationId(body.error.correlationId)).toBe(true);
  });
});

describe("successful responses", () => {
  it("preserves status, status text, text body, and custom headers", async () => {
    const wrapped = withRouteHandler(
      () =>
        new Response("created", {
          status: 201,
          statusText: "Created by route",
          headers: { "X-Custom": "preserved" },
        }),
      exemptOptions(),
    );

    const response = await wrapped(
      new Request("https://service.test/create"),
      {},
    );

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created by route");
    expect(response.headers.get("X-Custom")).toBe("preserved");
    expect(await response.text()).toBe("created");
  });

  it("preserves a JSON response and its existing content type", async () => {
    const wrapped = withRouteHandler(
      () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }),
      exemptOptions(),
    );

    const response = await wrapped(
      new Request("https://service.test/json"),
      {},
    );

    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await response.json()).toEqual({ ok: true });
  });

  it("preserves an empty 204 response", async () => {
    const wrapped = withRouteHandler(
      () => new Response(null, { status: 204, headers: { "X-Empty": "yes" } }),
      exemptOptions(),
    );

    const response = await wrapped(
      new Request("https://service.test/empty"),
      {},
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("X-Empty")).toBe("yes");
    expect(
      isValidCorrelationId(response.headers.get("X-Correlation-ID") ?? ""),
    ).toBe(true);
  });

  it("supports responses whose headers require safe cloning", async () => {
    const wrapped = withRouteHandler(
      () => Response.redirect("https://example.com/destination", 302),
      exemptOptions(),
    );

    const response = await wrapped(
      new Request("https://service.test/redirect"),
      {},
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://example.com/destination",
    );
    expect(
      isValidCorrelationId(response.headers.get("X-Correlation-ID") ?? ""),
    ).toBe(true);
  });
});

describe("expected AppError responses", () => {
  it("preserves safe fields, details, status, and custom headers", async () => {
    const captureException = vi.fn<ErrorReporter["captureException"]>();
    const wrapped = withRouteHandler(() => {
      throw new AppError({
        status: 429,
        code: "RATE_LIMITED",
        message: "  Please try again  ",
        details: { retryable: true, waitSeconds: 60 },
        headers: { "Retry-After": "60" },
      });
    }, exemptOptions({ captureException }));

    const response = await wrapped(
      new Request("https://service.test/limited"),
      {},
    );
    const body = await readErrorEnvelope(response);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Please try again",
        details: { retryable: true, waitSeconds: 60 },
        correlationId: response.headers.get("X-Correlation-ID"),
      },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("always includes empty details when omitted", async () => {
    const wrapped = withRouteHandler(() => {
      throw new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Not found",
      });
    }, exemptOptions());

    const response = await wrapped(
      new Request("https://service.test/missing"),
      {},
    );
    const body = await readErrorEnvelope(response);

    expect(body.error.details).toEqual({});
  });

  it("does not expose cause, stack, or internal text", async () => {
    const wrapped = withRouteHandler(() => {
      throw new AppError({
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Service temporarily unavailable",
        cause: new Error("SQL password=/private/path"),
      });
    }, exemptOptions());

    const response = await wrapped(
      new Request("https://service.test/service"),
      {},
    );
    const text = await response.text();

    expect(text).not.toContain("SQL");
    expect(text).not.toContain("password");
    expect(text).not.toContain("/private/path");
    expect(text).not.toContain("stack");
    expect(text).not.toContain("cause");
    expect(text).not.toContain("AppError");
  });
});

describe("unexpected errors", () => {
  it.each([
    ["ordinary Error", new Error("database password is private")],
    ["thrown string", "private thrown string"],
    ["thrown object", { secret: "private object value" }],
  ])(
    "reports the exact %s and returns a controlled 500",
    async (_name, thrown) => {
      const captureException = vi.fn<ErrorReporter["captureException"]>();
      const wrapped = withRouteHandler(() => {
        throw thrown;
      }, exemptOptions({ captureException }));

      const response = await wrapped(
        new Request("https://service.test/orders/123?customer=private"),
        {},
      );
      const body = await readErrorEnvelope(response);
      const responseText = JSON.stringify(body);

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.error.message).toBe("Something went wrong");
      expect(body.error.details).toEqual({});
      expect(response.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(captureException).toHaveBeenCalledWith(thrown, {
        correlationId: body.error.correlationId,
        method: "GET",
        route: "/orders/123",
      });
      expect(responseText).not.toContain("database password is private");
      expect(responseText).not.toContain("private thrown string");
      expect(responseText).not.toContain("private object value");
      expect(responseText).not.toContain("customer=private");
      expect(responseText).not.toContain("stack");
    },
  );

  it("handles a rejected asynchronous handler and reports uppercase method", async () => {
    const error = new Error("async private failure");
    const captureException = vi.fn<ErrorReporter["captureException"]>();
    const wrapped = withRouteHandler(
      async () => Promise.reject(error),
      exemptOptions({ captureException }),
    );

    const response = await wrapped(
      new Request("https://service.test/async?token=secret", {
        method: "post",
      }),
      {},
    );
    const body = await readErrorEnvelope(response);

    expect(response.status).toBe(500);
    expect(captureException).toHaveBeenCalledWith(error, {
      correlationId: body.error.correlationId,
      method: "POST",
      route: "/async",
    });
    expect(JSON.stringify(body)).not.toContain("async private failure");
    expect(JSON.stringify(body)).not.toContain("token=secret");
  });

  it("treats a runtime non-Response result as unexpected", async () => {
    const captureException = vi.fn<ErrorReporter["captureException"]>();
    const wrapped = Reflect.apply(withRouteHandler, undefined, [
      () => "not a response",
      exemptOptions({ captureException }),
    ]);
    const result: unknown = await Reflect.apply(wrapped, undefined, [
      new Request("https://service.test/invalid-result"),
      {},
    ]);

    expect(result).toBeInstanceOf(Response);

    if (!(result instanceof Response)) {
      throw new TypeError("Expected a Response.");
    }

    const body = await readErrorEnvelope(result);

    expect(result.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  it("awaits an asynchronous reporter before returning", async () => {
    let finishReporting: (() => void) | undefined;
    const reporting = new Promise<void>((resolve) => {
      finishReporting = resolve;
    });
    const captureException = vi.fn<ErrorReporter["captureException"]>(
      () => reporting,
    );
    const wrapped = withRouteHandler(() => {
      throw new Error("private");
    }, exemptOptions({ captureException }));
    let responseSettled = false;
    const responsePromise = wrapped(
      new Request("https://service.test/fail"),
      {},
    );
    void responsePromise.then(() => {
      responseSettled = true;
    });

    await Promise.resolve();

    expect(captureException).toHaveBeenCalledOnce();
    expect(responseSettled).toBe(false);

    if (finishReporting === undefined) {
      throw new TypeError("Reporter resolver was not initialized.");
    }

    finishReporting();
    const response = await responsePromise;

    expect(response.status).toBe(500);
    expect(responseSettled).toBe(true);
  });

  it("uses the default no-op reporter without console logging", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const wrapped = withRouteHandler(() => {
      throw new Error("private");
    }, exemptOptions());

    const response = await wrapped(
      new Request("https://service.test/fail"),
      {},
    );

    expect(response.status).toBe(500);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("reporter failures", () => {
  it.each([
    [
      "synchronous throw",
      () => {
        throw new Error("synchronous reporter secret");
      },
    ],
    [
      "asynchronous rejection",
      async () => Promise.reject(new Error("asynchronous reporter secret")),
    ],
  ] as const)(
    "swallows a %s and retains the safe response",
    async (_name, report) => {
      const captureException = vi.fn<ErrorReporter["captureException"]>(report);
      const wrapped = withRouteHandler(() => {
        throw new Error("original private failure");
      }, exemptOptions({ captureException }));

      const response = await wrapped(
        new Request("https://service.test/fail"),
        {},
      );
      const body = await readErrorEnvelope(response);
      const text = JSON.stringify(body);

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.error.message).toBe("Something went wrong");
      expect(body.error.correlationId).toBe(
        response.headers.get("X-Correlation-ID"),
      );
      expect(isValidCorrelationId(body.error.correlationId)).toBe(true);
      expect(text).not.toContain("reporter secret");
      expect(text).not.toContain("original private failure");
      expect(captureException).toHaveBeenCalledOnce();
    },
  );
});
