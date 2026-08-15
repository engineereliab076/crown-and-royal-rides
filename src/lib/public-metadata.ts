import "server-only";

import { env } from "@/lib/env";

export function publicUrl(path: string): URL {
  return new URL(path, env.NEXT_PUBLIC_APP_URL);
}

export function paginatedCanonical(path: string, page: number): URL {
  const url = publicUrl(path);
  if (page > 1) url.searchParams.set("page", String(page));
  return url;
}
