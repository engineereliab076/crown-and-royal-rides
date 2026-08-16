import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { publicPageMetadata } from "@/lib/public-metadata";
import { getPublicSettingsPresentation } from "@/server/settings/public-presentation";

export function generateMetadata(): Metadata {
  return publicPageMetadata({
    path: "/privacy",
    title: "Privacy",
    description: "How customer information is handled when using this website.",
  });
}

export default async function PrivacyPage() {
  const settings = await getPublicSettingsPresentation();
  return (
    <main id="main-content" className="flex-1 py-14 sm:py-20">
      <Container className="max-w-3xl">
        <header>
          <p className="text-eyebrow font-semibold tracking-widest text-brand-gold-foreground uppercase">
            {settings.businessName}
          </p>
          <h1 className="mt-3 text-title font-semibold">Privacy policy</h1>
          <p className="mt-4 text-muted-foreground">
            This plain-language policy explains how information submitted
            through this website is handled.
          </p>
        </header>
        <div className="mt-10 space-y-8 text-muted-foreground [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground">
          <section>
            <h2>Information you provide</h2>
            <p>
              When you submit a purchase inquiry, we collect the contact details
              and message you provide, together with a snapshot of the vehicle
              relevant to that request. Simply browsing public vehicle pages
              does not create an inquiry or change vehicle state.
            </p>
          </section>
          <section>
            <h2>How information is used</h2>
            <p>
              We use inquiry information to respond to your request, coordinate
              follow-up, maintain an administrative record, prevent abuse, and
              operate the service.
            </p>
          </section>
          <section>
            <h2>Access and service providers</h2>
            <p>
              Authorised administrators can access inquiry records. The service
              may use provider categories needed for hosting and data storage,
              image delivery, email delivery, rate limiting, and error
              monitoring. Providers receive only the information needed to
              perform their role.
            </p>
          </section>
          <section>
            <h2>Retention</h2>
            <p>
              Records are retained only as long as reasonably needed for enquiry
              handling, operational records, dispute resolution, security, and
              applicable business obligations. Retention may vary with the
              nature and status of a request.
            </p>
          </section>
          <section>
            <h2>Security and limitations</h2>
            <p>
              Reasonable safeguards are used to protect information, but no
              internet transmission or storage system can be guaranteed
              completely secure. Please avoid including unnecessary sensitive
              information in a message.
            </p>
          </section>
          <section>
            <h2>Contact and updates</h2>
            <p>
              If you have a privacy question,{" "}
              {settings.emailUrl && settings.email ? (
                <a
                  href={settings.emailUrl}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  email us at {settings.email}
                </a>
              ) : (
                <a
                  href="/contact"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  use the current contact details
                </a>
              )}
              . This policy may be updated as our services evolve; the current
              version will remain available on this page.
            </p>
          </section>
        </div>
      </Container>
    </main>
  );
}
