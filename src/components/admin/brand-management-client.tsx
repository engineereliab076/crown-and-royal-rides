"use client";

import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BrandDTO } from "@/server/modules/brands/dto";

interface BrandDraft {
  name: string;
  logoUrl: string;
  sortOrder: string;
}
const EMPTY: BrandDraft = { name: "", logoUrl: "", sortOrder: "0" };

async function brandResult(
  response: Response,
  fallback: string,
): Promise<BrandDTO> {
  const body = (await response.json().catch(() => ({}))) as {
    brand?: BrandDTO;
    error?: { message?: unknown };
  };
  if (response.ok && body.brand) return body.brand;
  throw new Error(
    typeof body.error?.message === "string" ? body.error.message : fallback,
  );
}

function payload(draft: BrandDraft) {
  return {
    name: draft.name,
    logoUrl: draft.logoUrl.trim() || null,
    sortOrder: Number(draft.sortOrder),
  };
}

export function BrandManagementClient({
  initialBrands,
}: {
  initialBrands: readonly BrandDTO[];
}) {
  const [brands, setBrands] = useState(initialBrands);
  const [creating, setCreating] = useState<BrandDraft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BrandDraft>(EMPTY);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function ordered(next: readonly BrandDTO[]) {
    return [...next].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/brands", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(creating)),
      });
      const brand = await brandResult(
        response,
        "The brand could not be created.",
      );
      setBrands((current) => ordered([...current, brand]));
      setCreating(EMPTY);
      setNotice("Brand created.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The brand could not be created.",
      );
    } finally {
      setPending(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || editingId === null) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/brands/${editingId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(editing)),
      });
      const brand = await brandResult(
        response,
        "The brand could not be updated.",
      );
      setBrands((current) =>
        ordered(current.map((item) => (item.id === brand.id ? brand : item))),
      );
      setEditingId(null);
      setNotice(
        "Brand updated. Vehicle brand snapshots were refreshed when the name changed.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The brand could not be updated.",
      );
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/brands/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const brand = await brandResult(
        response,
        "The brand could not be deleted.",
      );
      setBrands((current) => current.filter((item) => item.id !== brand.id));
      setConfirmingId(null);
      setNotice("Brand deleted.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The brand could not be deleted. Brands used by vehicles must be retained.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-gold-foreground">
          Catalogue
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Brands</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage normalized brand names, optional HTTPS logos, and catalogue
          ordering.
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
      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border bg-muted/30 p-4 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <form
        onSubmit={(event) => void create(event)}
        className="rounded-2xl border bg-card p-5 shadow-soft"
      >
        <h2 className="font-semibold">Add brand</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_8rem_auto]">
          <BrandField
            id="new-brand-name"
            label="Name"
            value={creating.name}
            required
            maxLength={80}
            onChange={(name) =>
              setCreating((current) => ({ ...current, name }))
            }
          />
          <BrandField
            id="new-brand-logo"
            label="Logo URL (optional)"
            value={creating.logoUrl}
            type="url"
            placeholder="https://…"
            onChange={(logoUrl) =>
              setCreating((current) => ({ ...current, logoUrl }))
            }
          />
          <BrandField
            id="new-brand-order"
            label="Sort order"
            value={creating.sortOrder}
            type="number"
            min={0}
            max={100000}
            required
            onChange={(sortOrder) =>
              setCreating((current) => ({ ...current, sortOrder }))
            }
          />
          <Button type="submit" className="self-end" disabled={pending}>
            <PlusIcon aria-hidden="true" />
            {pending ? "Saving…" : "Add"}
          </Button>
        </div>
      </form>

      {brands.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No brands yet. Add one to enable vehicle creation.
        </div>
      ) : (
        <ul className="space-y-3">
          {brands.map((brand) => (
            <li
              key={brand.id}
              className="rounded-2xl border bg-card p-4 shadow-soft"
            >
              {editingId === brand.id ? (
                <form
                  onSubmit={(event) => void save(event)}
                  className="grid gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_8rem_auto]"
                >
                  <BrandField
                    id={`brand-name-${brand.id}`}
                    label="Name"
                    value={editing.name}
                    required
                    maxLength={80}
                    onChange={(name) =>
                      setEditing((current) => ({ ...current, name }))
                    }
                  />
                  <BrandField
                    id={`brand-logo-${brand.id}`}
                    label="Logo URL (optional)"
                    value={editing.logoUrl}
                    type="url"
                    onChange={(logoUrl) =>
                      setEditing((current) => ({ ...current, logoUrl }))
                    }
                  />
                  <BrandField
                    id={`brand-order-${brand.id}`}
                    label="Sort order"
                    value={editing.sortOrder}
                    type="number"
                    min={0}
                    max={100000}
                    required
                    onChange={(sortOrder) =>
                      setEditing((current) => ({ ...current, sortOrder }))
                    }
                  />
                  <div className="flex items-end gap-2">
                    <Button type="submit" disabled={pending}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Cancel editing ${brand.name}`}
                      onClick={() => setEditingId(null)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{brand.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      /{brand.slug} · sort {brand.sortOrder}
                      {brand.logoUrl
                        ? " · HTTPS logo configured"
                        : " · no logo"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {confirmingId === brand.id ? (
                      <div
                        role="group"
                        aria-label={`Confirm deletion of ${brand.name}`}
                        className="flex items-center gap-2"
                      >
                        <span className="text-sm text-destructive">
                          Delete this unused brand?
                        </span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={pending}
                          onClick={() => void remove(brand.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            setEditingId(brand.id);
                            setEditing({
                              name: brand.name,
                              logoUrl: brand.logoUrl ?? "",
                              sortOrder: String(brand.sortOrder),
                            });
                            setConfirmingId(null);
                          }}
                        >
                          <PencilIcon aria-hidden="true" /> Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={pending}
                          onClick={() => {
                            setConfirmingId(brand.id);
                            setEditingId(null);
                          }}
                        >
                          <Trash2Icon aria-hidden="true" /> Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BrandField({
  id,
  label,
  value,
  onChange,
  ...input
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...input}
      />
    </div>
  );
}
