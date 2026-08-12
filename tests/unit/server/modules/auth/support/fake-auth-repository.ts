import type {
  AuthRepository,
  CredentialAdmin,
  PasswordChangeResult,
  SessionAdmin,
} from "@/server/modules/auth/repository";

/**
 * Deterministic in-memory {@link AuthRepository} for unit tests. It stores full
 * credential records and derives the session view by dropping `passwordHash`
 * (and `email`), mirroring the production repository's narrower session
 * `select`. Call counters let tests assert that lookups are not duplicated.
 */
export class FakeAuthRepository implements AuthRepository {
  readonly #byId = new Map<string, CredentialAdmin>();
  credentialLookups = 0;
  credentialByIdLookups = 0;
  sessionLookups = 0;
  passwordChanges = 0;
  loginRecords = 0;

  constructor(admins: readonly CredentialAdmin[] = []) {
    for (const admin of admins) this.#byId.set(admin.id, admin);
  }

  add(admin: CredentialAdmin): void {
    this.#byId.set(admin.id, admin);
  }

  /** Read the current stored record (test-only introspection). */
  peek(id: string): CredentialAdmin | undefined {
    return this.#byId.get(id);
  }

  async findCredentialByEmail(email: string): Promise<CredentialAdmin | null> {
    this.credentialLookups += 1;
    for (const admin of this.#byId.values()) {
      if (admin.email === email) return admin;
    }
    return null;
  }

  async findCredentialById(id: string): Promise<CredentialAdmin | null> {
    this.credentialByIdLookups += 1;
    return this.#byId.get(id) ?? null;
  }

  async findSessionById(id: string): Promise<SessionAdmin | null> {
    this.sessionLookups += 1;
    const admin = this.#byId.get(id);
    if (admin === undefined) return null;
    return {
      id: admin.id,
      name: admin.name,
      role: admin.role,
      isActive: admin.isActive,
      sessionVersion: admin.sessionVersion,
      mustChangePassword: admin.mustChangePassword,
    };
  }

  async changePassword(
    id: string,
    newPasswordHash: string,
  ): Promise<PasswordChangeResult> {
    this.passwordChanges += 1;
    const admin = this.#byId.get(id);
    if (admin === undefined) {
      throw new Error("Cannot change password for a missing administrator.");
    }
    const updated: CredentialAdmin = {
      ...admin,
      passwordHash: newPasswordHash,
      mustChangePassword: false,
      sessionVersion: admin.sessionVersion + 1,
    };
    this.#byId.set(id, updated);
    return { sessionVersion: updated.sessionVersion };
  }

  async recordLogin(id: string): Promise<void> {
    this.loginRecords += 1;
    if (!this.#byId.has(id)) {
      throw new Error("Cannot record login for a missing administrator.");
    }
  }
}
