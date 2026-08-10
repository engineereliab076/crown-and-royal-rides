const INVALID_PHONE_MESSAGE = "Value must be a valid Tanzanian phone number.";

function invalidPhone(): TypeError {
  return new TypeError(INVALID_PHONE_MESSAGE);
}

export function normalizeTanzanianPhone(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0 || !/^\+?[0-9\s-]+$/.test(trimmed)) {
    throw invalidPhone();
  }

  const compact = trimmed.replace(/[\s-]/g, "");
  let nationalDigits: string;

  if (/^0[0-9]{9}$/.test(compact)) {
    nationalDigits = compact.slice(1);
  } else if (/^255[0-9]{9}$/.test(compact)) {
    nationalDigits = compact.slice(3);
  } else if (/^\+255[0-9]{9}$/.test(compact)) {
    nationalDigits = compact.slice(4);
  } else {
    throw invalidPhone();
  }

  return `+255${nationalDigits}`;
}

export function isValidTanzanianPhone(value: string): boolean {
  try {
    normalizeTanzanianPhone(value);
    return true;
  } catch {
    return false;
  }
}
