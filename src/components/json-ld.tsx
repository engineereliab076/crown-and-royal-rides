import {
  serializeJsonLd,
  type SafeStructuredData,
} from "@/lib/structured-data";

/** The only reviewed raw-HTML boundary: input is an allow-listed branded DTO. */
export function JsonLd({ data }: { readonly data: SafeStructuredData }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
