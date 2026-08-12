export interface AdministratorDisplayData {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: "owner" | "manager";
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
}

export function administratorDisplayData(
  input: AdministratorDisplayData,
): AdministratorDisplayData {
  return {
    id: input.id,
    email: input.email,
    name: input.name,
    role: input.role,
    isActive: input.isActive,
    mustChangePassword: input.mustChangePassword,
  };
}

export interface OneTimePasswordState {
  readonly open: boolean;
  readonly value: string | null;
  readonly administratorName: string;
}

export type OneTimePasswordAction =
  | { type: "show"; value: string; administratorName: string }
  | { type: "clear" };

export function oneTimePasswordReducer(
  _state: OneTimePasswordState,
  action: OneTimePasswordAction,
): OneTimePasswordState {
  if (action.type === "clear") {
    return { open: false, value: null, administratorName: "" };
  }
  return {
    open: true,
    value: action.value,
    administratorName: action.administratorName,
  };
}
