import { formatTzs } from "@/lib/money";
import { normalizeTanzanianPhone } from "@/lib/phone";

export interface PurchaseWhatsAppMessageInput {
  readonly reference: string;
  readonly brandName: string;
  readonly model: string;
  readonly year: number;
  readonly salePrice: number | null;
  readonly vehicleUrl?: string;
}

export interface DirectVehicleWhatsAppMessageInput {
  readonly brandName: string;
  readonly model: string;
  readonly year: number;
  readonly salePrice: number | null;
  readonly vehicleUrl?: string;
  readonly modes?: readonly ("sale" | "rental")[];
}

function normalizedLines(lines: readonly (string | undefined)[]): string {
  return lines.filter((line): line is string => line !== undefined).join("\n");
}

export function buildPurchaseWhatsAppMessage(
  input: PurchaseWhatsAppMessageInput,
): string {
  return normalizedLines([
    "Crown and Royal Rides",
    `Purchase inquiry: ${input.reference}`,
    `I would like to purchase the ${input.year} ${input.brandName} ${input.model}.`,
    input.salePrice === null
      ? undefined
      : `Price: ${formatTzs(input.salePrice)}`,
    input.vehicleUrl === undefined ? undefined : `Vehicle: ${input.vehicleUrl}`,
  ]);
}

export function buildDirectVehicleWhatsAppMessage(
  input: DirectVehicleWhatsAppMessageInput,
): string {
  const modes = input.modes ?? ["sale"];
  const interest =
    modes.includes("sale") && modes.includes("rental")
      ? "buying or renting"
      : modes.includes("rental")
        ? "renting"
        : "purchasing";
  return normalizedLines([
    "Hello Crown and Royal Rides,",
    `I am interested in ${interest} the ${input.year} ${input.brandName} ${input.model}.`,
    input.salePrice === null || !modes.includes("sale")
      ? undefined
      : `Price: ${formatTzs(input.salePrice)}`,
    input.vehicleUrl === undefined ? undefined : `Vehicle: ${input.vehicleUrl}`,
  ]);
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const normalizedPhone = normalizeTanzanianPhone(phone);
  const normalizedMessage = message.replace(/\r\n?/g, "\n").trim();
  if (normalizedMessage.length === 0) {
    throw new TypeError("WhatsApp message must not be empty.");
  }
  const digits = normalizedPhone.replace(/^\+/, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(normalizedMessage)}`;
}
