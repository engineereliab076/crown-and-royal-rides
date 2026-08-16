import {
  ClockIcon,
  ExternalLinkIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PhoneIcon,
} from "lucide-react";
import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { parseOpeningHours, parseSocialLinks } from "@/lib/public-contact";
import { publicPageMetadata } from "@/lib/public-metadata";
import { getPublicSettingsPresentation } from "@/server/settings/public-presentation";

export function generateMetadata(): Metadata {
  return publicPageMetadata({
    path: "/contact",
    title: "Contact",
    description:
      "Contact Crown and Royal Rides about vehicle sales and rentals.",
  });
}

const contactClass =
  "flex min-h-11 items-center gap-3 rounded-md text-sm font-medium break-all outline-none hover:text-brand-gold-foreground focus-visible:ring-2 focus-visible:ring-ring";

export default async function ContactPage() {
  const settings = await getPublicSettingsPresentation();
  const hours = parseOpeningHours(settings.openingHours);
  const socials = parseSocialLinks(settings.socialLinks);
  const hasDirectContact =
    settings.whatsappUrl || settings.primaryPhoneUrl || settings.emailUrl;
  return (
    <main id="main-content" className="flex-1 py-14 sm:py-20">
      <Container>
        <header className="max-w-3xl">
          <p className="text-eyebrow font-semibold tracking-widest text-brand-gold-foreground uppercase">
            {settings.businessName}
          </p>
          <h1 className="mt-3 text-title font-semibold">Contact us</h1>
          <p className="mt-4 text-body-lg text-muted-foreground">
            Speak directly with our team about a vehicle for sale or rental.
          </p>
        </header>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-2xl border bg-card p-6 shadow-soft sm:p-8"
            aria-labelledby="direct-contact-heading"
          >
            <h2 id="direct-contact-heading" className="text-xl font-semibold">
              Contact details
            </h2>
            {hasDirectContact ? (
              <address className="mt-5 not-italic">
                <ul className="space-y-2">
                  {settings.whatsappUrl && settings.whatsappNumber ? (
                    <li>
                      <a
                        className={contactClass}
                        href={settings.whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircleIcon
                          aria-hidden="true"
                          className="size-5 shrink-0"
                        />
                        WhatsApp: {settings.whatsappNumber}
                      </a>
                    </li>
                  ) : null}
                  {settings.primaryPhoneUrl && settings.primaryPhone ? (
                    <li>
                      <a
                        className={contactClass}
                        href={settings.primaryPhoneUrl}
                      >
                        <PhoneIcon
                          aria-hidden="true"
                          className="size-5 shrink-0"
                        />
                        {settings.primaryPhone}
                      </a>
                    </li>
                  ) : null}
                  {settings.secondaryPhoneUrl && settings.secondaryPhone ? (
                    <li>
                      <a
                        className={contactClass}
                        href={settings.secondaryPhoneUrl}
                      >
                        <PhoneIcon
                          aria-hidden="true"
                          className="size-5 shrink-0"
                        />
                        {settings.secondaryPhone}
                      </a>
                    </li>
                  ) : null}
                  {settings.emailUrl && settings.email ? (
                    <li>
                      <a className={contactClass} href={settings.emailUrl}>
                        <MailIcon
                          aria-hidden="true"
                          className="size-5 shrink-0"
                        />
                        {settings.email}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </address>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Contact details are temporarily unavailable. Please check back
                soon.
              </p>
            )}
            {settings.address ? (
              <div className="mt-6 border-t pt-5">
                <h3 className="font-semibold">Address</h3>
                <p className="mt-2 flex gap-3 text-sm text-muted-foreground">
                  <MapPinIcon aria-hidden="true" className="size-5 shrink-0" />
                  {settings.address}
                </p>
              </div>
            ) : null}
          </section>
          <div className="space-y-6">
            {hours.length > 0 ? (
              <section
                className="rounded-2xl border bg-card p-6 shadow-soft"
                aria-labelledby="hours-heading"
              >
                <h2
                  id="hours-heading"
                  className="flex items-center gap-2 text-xl font-semibold"
                >
                  <ClockIcon aria-hidden="true" className="size-5" />
                  Opening hours
                </h2>
                <dl className="mt-5 space-y-3">
                  {hours.map((row) => (
                    <div
                      key={row.label}
                      className="grid gap-1 text-sm sm:grid-cols-2"
                    >
                      <dt className="font-medium">{row.label}</dt>
                      <dd className="text-muted-foreground sm:text-right">
                        {row.href}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {socials.length > 0 ? (
              <section
                className="rounded-2xl border bg-card p-6 shadow-soft"
                aria-labelledby="social-heading"
              >
                <h2 id="social-heading" className="text-xl font-semibold">
                  Social channels
                </h2>
                <ul className="mt-4 grid gap-1 sm:grid-cols-2">
                  {socials.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={contactClass}
                      >
                        {link.label}
                        <ExternalLinkIcon
                          aria-hidden="true"
                          className="size-4"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </Container>
    </main>
  );
}
