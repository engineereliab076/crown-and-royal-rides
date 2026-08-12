import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";

import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = {
  title: "Change password",
  robots: { index: false, follow: false },
};

export default async function ChangePasswordPage() {
  const session = await auth();
  const user = session?.user;
  // Authenticated administrators only. Forced-change users are allowed here (it
  // is the one protected destination they may reach).
  if (user === undefined) redirect("/admin/login");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Change password</h1>
        <p className="text-sm text-muted-foreground">
          Choose a new password for your administrator account.
        </p>
      </div>
      <ChangePasswordForm forced={user.mustChangePassword} />
    </main>
  );
}
