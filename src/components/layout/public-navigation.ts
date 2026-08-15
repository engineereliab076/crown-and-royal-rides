/**
 * The public navigation model.
 *
 * A plain, framework-agnostic module (no `"use client"`) so both the client
 * {@link NavigationLinks} and the Server Component {@link SiteFooter} can import
 * the array directly. Exporting it from a client module would turn it into a
 * client reference on the server, where `.map` is unavailable.
 */
export const PUBLIC_NAVIGATION = [
  { href: "/", label: "Home" },
  { href: "/cars", label: "All vehicles" },
  { href: "/cars-for-sale", label: "For sale" },
  { href: "/cars-for-rent", label: "For rent" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;
