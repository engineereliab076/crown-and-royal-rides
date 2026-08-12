"use client";

import { CopyIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import {
  administratorDisplayData,
  oneTimePasswordReducer,
} from "@/components/admin/users-page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AdministratorDto {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: "owner" | "manager";
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly sessionVersion: number;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AdministratorPageDto {
  readonly items: readonly AdministratorDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

type PendingAction =
  | { type: "role"; administrator: AdministratorDto }
  | { type: "deactivate"; administrator: AdministratorDto }
  | { type: "reactivate"; administrator: AdministratorDto }
  | { type: "reset"; administrator: AdministratorDto };

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Fall through to the stable generic message.
  }
  return "The request could not be completed.";
}

function actionCopy(action: PendingAction): {
  title: string;
  description: string;
  confirm: string;
  destructive: boolean;
} {
  switch (action.type) {
    case "role":
      return {
        title: "Change administrator role?",
        description: `Change ${action.administrator.name} to ${action.administrator.role === "owner" ? "manager" : "owner"}? Their existing sessions will be invalidated.`,
        confirm: "Change role",
        destructive: action.administrator.role === "owner",
      };
    case "deactivate":
      return {
        title: "Deactivate administrator?",
        description: `${action.administrator.name} will lose access immediately and existing sessions will be invalidated.`,
        confirm: "Deactivate",
        destructive: true,
      };
    case "reactivate":
      return {
        title: "Reactivate administrator?",
        description: `${action.administrator.name} will be able to sign in again with their current credentials.`,
        confirm: "Reactivate",
        destructive: false,
      };
    case "reset":
      return {
        title: "Reset password?",
        description: `${action.administrator.name} will receive a new temporary password and all existing sessions will be invalidated.`,
        confirm: "Reset password",
        destructive: true,
      };
  }
}

export function AdministratorTable({
  administrators,
  onAction,
}: {
  administrators: readonly AdministratorDto[];
  onAction(action: PendingAction): void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Administrator</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Password</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {administrators.map((administrator) => (
          <TableRow key={administrator.id}>
            <TableCell>
              <div className="min-w-48">
                <p className="font-medium">
                  {administratorDisplayData(administrator).name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {administratorDisplayData(administrator).email}
                </p>
              </div>
            </TableCell>
            <TableCell className="capitalize">{administrator.role}</TableCell>
            <TableCell>
              <Badge variant={administrator.isActive ? "secondary" : "outline"}>
                {administrator.isActive ? "Active" : "Inactive"}
              </Badge>
            </TableCell>
            <TableCell>
              {administrator.mustChangePassword ? "Change required" : "Current"}
            </TableCell>
            <TableCell>
              <div className="flex min-w-max justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onAction({ type: "role", administrator })}
                >
                  Make {administrator.role === "owner" ? "manager" : "owner"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onAction({
                      type: administrator.isActive
                        ? "deactivate"
                        : "reactivate",
                      administrator,
                    })
                  }
                >
                  {administrator.isActive ? "Deactivate" : "Reactivate"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onAction({ type: "reset", administrator })}
                >
                  Reset password
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function UsersPageClient() {
  const [page, setPage] = useState<AdministratorPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [secret, dispatchSecret] = useReducer(oneTimePasswordReducer, {
    open: false,
    value: null,
    administratorName: "",
  });
  const secretRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users?limit=100", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setPage((await response.json()) as AdministratorPageDto);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Administrators could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      secretRef.current = null;
    };
  }, [load]);

  function showSecret(value: string, administratorName: string) {
    secretRef.current = value;
    dispatchSecret({ type: "show", value, administratorName });
  }

  function clearSecret() {
    secretRef.current = null;
    dispatchSecret({ type: "clear" });
  }

  async function createAdministrator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "manager"),
    };
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const result = (await response.json()) as {
        administrator: AdministratorDto;
        temporaryPassword: string;
      };
      setCreateOpen(false);
      showSecret(result.temporaryPassword, result.administrator.name);
      toast.success("Administrator created.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Administrator could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmAction() {
    if (pendingAction === null) return;
    setSubmitting(true);
    setError(null);
    const { administrator, type } = pendingAction;
    const endpoint =
      type === "role"
        ? `/api/admin/users/${administrator.id}/role`
        : `/api/admin/users/${administrator.id}/${
            type === "reset" ? "reset-password" : type
          }`;
    const body =
      type === "role"
        ? { role: administrator.role === "owner" ? "manager" : "owner" }
        : {};
    try {
      const response = await fetch(endpoint, {
        method: type === "role" ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const result = (await response.json()) as {
        administrator: AdministratorDto;
        temporaryPassword?: string;
      };
      setPendingAction(null);
      if (type === "reset" && typeof result.temporaryPassword === "string") {
        showSecret(result.temporaryPassword, administrator.name);
      }
      toast.success("Administrator updated.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Administrator could not be updated.",
      );
      setPendingAction(null);
    } finally {
      setSubmitting(false);
    }
  }

  const confirmation =
    pendingAction === null ? null : actionCopy(pendingAction);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-gold-foreground">
            Access control
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Administrator users
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create accounts, manage roles, and invalidate access securely.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button type="button" size="lg">
              <PlusIcon aria-hidden="true" /> Create administrator
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={createAdministrator} className="contents">
              <DialogHeader>
                <DialogTitle>Create administrator</DialogTitle>
                <DialogDescription>
                  A temporary password will be shown once after creation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="admin-name">Name</Label>
                  <Input
                    id="admin-name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input
                    id="admin-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-role">Role</Label>
                  <select
                    id="admin-role"
                    name="role"
                    defaultValue="manager"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <option value="manager">Manager</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
        aria-label="Administrators"
        className="overflow-hidden rounded-2xl border bg-card shadow-soft"
      >
        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCwIcon className="size-4 animate-spin" /> Loading
            administrators…
          </div>
        ) : page?.items.length ? (
          <AdministratorTable
            administrators={page.items}
            onAction={setPendingAction}
          />
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No administrators found.
          </div>
        )}
      </section>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant={confirmation?.destructive ? "destructive" : "default"}
              disabled={submitting}
              onClick={() => void confirmAction()}
            >
              {submitting ? "Working…" : confirmation?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={secret.open}
        onOpenChange={(open) => !open && clearSecret()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password — visible once</DialogTitle>
            <DialogDescription>
              Copy this password for {secret.administratorName}. It will be
              cleared when this dialog closes.
            </DialogDescription>
          </DialogHeader>
          <div
            className="rounded-xl border bg-muted p-4 font-mono text-sm break-all"
            data-testid="one-time-password"
          >
            {secret.value}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const value = secretRef.current;
                if (value !== null)
                  void navigator.clipboard
                    .writeText(value)
                    .then(() => toast.success("Temporary password copied."));
              }}
            >
              <CopyIcon aria-hidden="true" /> Copy password
            </Button>
            <DialogClose asChild>
              <Button type="button">I have saved it</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
