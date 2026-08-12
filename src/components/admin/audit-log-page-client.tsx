"use client";

import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { sanitizeAuditMetadata } from "@/components/admin/audit-metadata";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AuditRecordDto {
  readonly id: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: unknown;
  readonly createdAt: string;
}

interface AuditPageDto {
  readonly items: readonly AuditRecordDto[];
  readonly nextCursor: string | null;
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {}
  return "Audit records could not be loaded.";
}

export function AuditLogPageClient() {
  const [page, setPage] = useState<AuditPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);

  const load = useCallback(async (requestedCursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (requestedCursor !== null) params.set("cursor", requestedCursor);
      const response = await fetch(`/api/admin/audit-log?${params}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await safeError(response));
      setPage((await response.json()) as AuditPageDto);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Audit records could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(cursor);
  }, [cursor, load]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-gold-foreground">
          Security history
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Audit log
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Immutable records of successful administrator and settings changes.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <section
        aria-label="Audit records"
        className="overflow-hidden rounded-2xl border bg-card shadow-soft"
      >
        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCwIcon className="size-4 animate-spin" /> Loading audit
            records…
          </div>
        ) : page?.items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="align-top text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(record.createdAt))}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline">{record.action}</Badge>
                  </TableCell>
                  <TableCell className="max-w-48 align-top font-mono text-xs break-all whitespace-normal">
                    {record.actorId ?? "System"}
                  </TableCell>
                  <TableCell className="align-top">
                    <p className="text-xs font-medium">{record.targetType}</p>
                    <p className="max-w-48 font-mono text-xs break-all whitespace-normal text-muted-foreground">
                      {record.targetId}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-md align-top whitespace-normal">
                    <pre className="overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
                      {JSON.stringify(
                        sanitizeAuditMetadata(record.metadata),
                        null,
                        2,
                      )}
                    </pre>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No audit records yet.
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={loading || history.length === 0}
          onClick={() => {
            const previous = history.at(-1) ?? null;
            setHistory((items) => items.slice(0, -1));
            setCursor(previous);
          }}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={loading || page?.nextCursor == null}
          onClick={() => {
            if (page?.nextCursor === null || page?.nextCursor === undefined)
              return;
            setHistory((items) => [...items, cursor]);
            setCursor(page.nextCursor);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
