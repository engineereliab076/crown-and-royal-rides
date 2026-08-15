import { normalizeTanzanianPhone } from "@/lib/phone";

export interface ContactLink {
  readonly label: string;
  readonly href: string;
}

const SOCIAL_LABELS = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
} as const;

export function phoneHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return `tel:${normalizeTanzanianPhone(value)}`;
  } catch {
    return null;
  }
}

export function emailHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return `mailto:${email}`;
}

export function whatsappHref(
  value: unknown,
  message = "Hello Crown and Royal Rides, I would like some assistance.",
): string | null {
  if (typeof value !== "string") return null;
  const normalizedMessage = message.replace(/\r\n?/g, "\n").trim();
  if (normalizedMessage.length === 0) return null;
  try {
    const digits = normalizeTanzanianPhone(value).slice(1);
    return `https://wa.me/${digits}?text=${encodeURIComponent(normalizedMessage)}`;
  } catch {
    return null;
  }
}

export function parseOpeningHours(value: unknown): readonly ContactLink[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].trim().length > 0 &&
        entry[0].length <= 40 &&
        typeof entry[1] === "string" &&
        entry[1].trim().length > 0 &&
        entry[1].length <= 100,
    )
    .map(([label, hours]) => ({ label: label.trim(), href: hours.trim() }));
}

export function parseSocialLinks(value: unknown): readonly ContactLink[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const links: ContactLink[] = [];
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase() as keyof typeof SOCIAL_LABELS;
    const label = SOCIAL_LABELS[key];
    if (label === undefined || typeof rawValue !== "string") continue;
    try {
      const url = new URL(rawValue);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== ""
      ) {
        continue;
      }
      links.push({ label, href: url.toString() });
    } catch {
      continue;
    }
  }
  return links;
}
