export const DAR_ES_SALAAM_TIME_ZONE = "Africa/Dar_es_Salaam";

const DATE_ONLY_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const INVALID_DATE_MESSAGE = "Value must be a valid date-only string.";
const INVALID_DATE_INSTANCE_MESSAGE = "now must be a valid Date.";

interface DateOnlyParts {
  year: number;
  month: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }

  return 31;
}

function parseDateOnly(value: string): DateOnlyParts | null {
  const match = DATE_ONLY_PATTERN.exec(value);

  if (match === null) {
    return null;
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];

  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined
  ) {
    return null;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }

  return { year, month, day };
}

function requireDateOnly(value: string): DateOnlyParts {
  const parts = parseDateOnly(value);

  if (parts === null) {
    throw new TypeError(INVALID_DATE_MESSAGE);
  }

  return parts;
}

function requireSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer.`);
  }
}

function requireValidDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(INVALID_DATE_INSTANCE_MESSAGE);
  }
}

function toUtcTimestamp(parts: DateOnlyParts): number {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date.getTime();
}

function formatDateOnly(parts: DateOnlyParts): string {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOnlyFromUtcTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();

  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(date.getTime()) ||
    year < 1 ||
    year > 9999
  ) {
    throw new TypeError(
      "Calendar calculation is outside the supported date range.",
    );
  }

  return formatDateOnly({
    year,
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export function getDarEsSalaamToday(now: Date = new Date()): string {
  requireValidDate(now);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAR_ES_SALAAM_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (year === undefined || month === undefined || day === undefined) {
    throw new TypeError(INVALID_DATE_INSTANCE_MESSAGE);
  }

  return `${year}-${month}-${day}`;
}

export function isValidDateOnly(value: string): boolean {
  return parseDateOnly(value) !== null;
}

export function compareDateOnly(left: string, right: string): -1 | 0 | 1 {
  requireDateOnly(left);
  requireDateOnly(right);

  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function addCalendarDays(value: string, days: number): string {
  const parts = requireDateOnly(value);
  requireSafeInteger(days, "days");

  return dateOnlyFromUtcTimestamp(
    toUtcTimestamp(parts) + days * MILLISECONDS_PER_DAY,
  );
}

export function differenceInCalendarDays(start: string, end: string): number {
  const startTimestamp = toUtcTimestamp(requireDateOnly(start));
  const endTimestamp = toUtcTimestamp(requireDateOnly(end));
  return (endTimestamp - startTimestamp) / MILLISECONDS_PER_DAY;
}

export function addCalendarMonths(value: string, months: number): string {
  const parts = requireDateOnly(value);
  requireSafeInteger(months, "months");

  const totalMonths = parts.year * 12 + (parts.month - 1) + months;

  if (!Number.isSafeInteger(totalMonths)) {
    throw new TypeError(
      "Calendar calculation is outside the supported date range.",
    );
  }

  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12 + 1;

  if (year < 1 || year > 9999) {
    throw new TypeError(
      "Calendar calculation is outside the supported date range.",
    );
  }

  return formatDateOnly({
    year,
    month,
    day: Math.min(parts.day, daysInMonth(year, month)),
  });
}

export function isDateWithinRequestWindow(
  value: string,
  now: Date = new Date(),
): boolean {
  if (!isValidDateOnly(value)) {
    return false;
  }

  const today = getDarEsSalaamToday(now);
  const finalDate = addCalendarMonths(today, 12);
  return (
    compareDateOnly(value, today) >= 0 && compareDateOnly(value, finalDate) <= 0
  );
}
