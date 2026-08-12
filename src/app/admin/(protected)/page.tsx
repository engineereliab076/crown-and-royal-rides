import type { Metadata } from "next";

import { requireAdminPage } from "@/server/auth/page-guard";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireAdminPage();
  const status = (await searchParams).status;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-gold-foreground">
          Overview
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Welcome back, {user.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the navigation to manage the areas available to your {user.role}{" "}
          role.
        </p>
      </div>
      {status === "forbidden" ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          You do not have permission to view that administration page.
        </div>
      ) : null}
      <section
        aria-labelledby="phase-status"
        className="rounded-2xl border bg-card p-5 shadow-soft"
      >
        <h2 id="phase-status" className="text-base font-semibold">
          Administration ready
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Account security, administrator access, settings protection, and audit
          history are available from this shell.
        </p>
      </section>
    </div>
  );
}
