import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveSafeAdminPath } from "@/lib/safe-redirect";
import { auth } from "@/server/auth";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (session?.user !== undefined) {
    redirect(
      session.user.mustChangePassword ? "/admin/change-password" : "/admin",
    );
  }

  const params = await searchParams;
  const callbackUrl = resolveSafeAdminPath(firstValue(params.callbackUrl));
  const notice =
    firstValue(params.status) === "password-changed"
      ? "Your password was changed. Please sign in again."
      : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Administrator sign in</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to manage Crown and Royal Rides.
        </p>
      </div>
      <LoginForm callbackUrl={callbackUrl} notice={notice} />
    </main>
  );
}
