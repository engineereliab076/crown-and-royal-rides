import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";
import { AppError } from "@/server/http/errors";
import { getIntegrationContainer } from "@/server/integrations/container";

export function adminRouteOptions() {
  return {
    origin: {
      mode: "required" as const,
      allowedOrigin: env.APP_ORIGIN ?? "http://localhost:3000",
    },
    errorReporter: getIntegrationContainer().errorReporter,
  };
}

export function privateJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export async function readJsonBody(
  request: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0 && options.allowEmpty === true) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError({
      status: 400,
      code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    });
  }
}

export function parseApiInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      status: 422,
      code: "VALIDATION_ERROR",
      message,
      details: {
        fields: [
          ...new Set(
            parsed.error.issues.map((issue) =>
              issue.path.length === 0 ? "request" : issue.path.join("."),
            ),
          ),
        ],
      },
    });
  }
  return parsed.data;
}

export function queryObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}
