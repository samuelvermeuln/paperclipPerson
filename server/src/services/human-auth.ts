import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  boardApiKeys,
  companies,
  companyAddresses,
  companyMemberships,
  userAddresses,
  instanceUserRoles,
} from "@paperclipai/db";
import {
  normalizeEmail,
  normalizeCpf,
  normalizeCnpj,
  normalizePhone,
  normalizePostalCode,
  type AddressInput,
  type CompleteRegistrationInput,
  type AdminCreateUserInput,
  type AdminUpdateUserInput,
} from "@paperclipai/shared";
import { hashPassword } from "better-auth/crypto";
import { conflict, notFound } from "../errors.js";
import { companyService } from "./companies.js";
import { accessService } from "./access.js";

const PRIMARY_GLOBAL_ADMIN_EMAIL = normalizeEmail("samuelvermeuln@gmail.com");

function now() {
  return new Date();
}

export function isBootstrapGlobalAdminEmail(email: string | null | undefined) {
  return Boolean(email && normalizeEmail(email) === PRIMARY_GLOBAL_ADMIN_EMAIL);
}

export async function ensureBootstrapGlobalAdminForEmail(db: Db, userId: string, email: string | null | undefined) {
  if (!isBootstrapGlobalAdminEmail(email)) return false;
  const access = accessService(db);
  await access.promoteInstanceAdmin(userId);
  return true;
}

function deriveIssuePrefixBase(name: string) {
  const normalized = name.toUpperCase().replace(/[^A-Z]/g, "");
  return normalized.slice(0, 3) || "CMP";
}

function suffixForAttempt(attempt: number) {
  if (attempt <= 1) return "";
  return "A".repeat(attempt - 1);
}

async function ensureUniqueIssuePrefix(db: Db, name: string) {
  const base = deriveIssuePrefixBase(name);
  for (let attempt = 1; attempt < 10000; attempt += 1) {
    const candidate = `${base}${suffixForAttempt(attempt)}`;
    const existing = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.issuePrefix, candidate))
      .then((rows) => rows[0] ?? null);
    if (!existing) return candidate;
  }
  throw new Error("Unable to allocate unique issue prefix");
}

async function assertUniqueEmail(db: Db, email: string, excludeUserId?: string) {
  const existing = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, normalizeEmail(email)))
    .then((rows) => rows[0] ?? null);
  if (existing && existing.id !== excludeUserId) {
    throw conflict("Email already in use", { code: "EMAIL_ALREADY_IN_USE" });
  }
}

async function assertUniqueCpf(db: Db, cpf: string | null | undefined, excludeUserId?: string) {
  const normalized = cpf ? normalizeCpf(cpf) : null;
  if (!normalized) return;
  const existing = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.cpf, normalized))
    .then((rows) => rows[0] ?? null);
  if (existing && existing.id !== excludeUserId) {
    throw conflict("CPF already in use", { code: "CPF_ALREADY_IN_USE" });
  }
}

async function assertUniqueCnpj(db: Db, cnpj: string | null | undefined, excludeCompanyId?: string) {
  const normalized = cnpj ? normalizeCnpj(cnpj) : null;
  if (!normalized) return;
  const existing = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.cnpj, normalized))
    .then((rows) => rows[0] ?? null);
  if (existing && existing.id !== excludeCompanyId) {
    throw conflict("CNPJ already in use", { code: "CNPJ_ALREADY_IN_USE" });
  }
}

async function upsertUserAddress(db: Db, userId: string, address: AddressInput) {
  const existing = await db
    .select({ id: userAddresses.id })
    .from(userAddresses)
    .where(eq(userAddresses.userId, userId))
    .then((rows) => rows[0] ?? null);

  const values = {
    postalCode: normalizePostalCode(address.postalCode),
    street: address.street.trim(),
    number: address.number.trim(),
    complement: address.complement ?? null,
    neighborhood: address.neighborhood.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    country: address.country.trim(),
    updatedAt: now(),
  };

  if (existing) {
    await db.update(userAddresses).set(values).where(eq(userAddresses.id, existing.id));
    return;
  }

  await db.insert(userAddresses).values({
    userId,
    ...values,
    createdAt: now(),
  });
}

async function upsertCompanyAddress(db: Db, companyId: string, address: AddressInput) {
  const existing = await db
    .select({ id: companyAddresses.id })
    .from(companyAddresses)
    .where(eq(companyAddresses.companyId, companyId))
    .then((rows) => rows[0] ?? null);

  const values = {
    postalCode: normalizePostalCode(address.postalCode),
    street: address.street.trim(),
    number: address.number.trim(),
    complement: address.complement ?? null,
    neighborhood: address.neighborhood.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    country: address.country.trim(),
    updatedAt: now(),
  };

  if (existing) {
    await db.update(companyAddresses).set(values).where(eq(companyAddresses.id, existing.id));
    return;
  }

  await db.insert(companyAddresses).values({
    companyId,
    ...values,
    createdAt: now(),
  });
}

async function activeInstanceAdminCount(db: Db) {
  return db
    .select({ id: instanceUserRoles.id })
    .from(instanceUserRoles)
    .where(eq(instanceUserRoles.role, "instance_admin"))
    .then((rows) => rows.length);
}

async function hasActiveMembership(db: Db, userId: string) {
  const existing = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  return Boolean(existing);
}

function mapStatusToBanFields(status: "ACTIVE" | "BLOCKED", reason: string | null = null) {
  return {
    status,
    banned: status === "BLOCKED",
    banReason: status === "BLOCKED" ? reason ?? "Blocked by administrator" : null,
    banExpires: null,
  };
}

export async function revokeHumanAuthAccess(db: Db, userId: string) {
  const keyIds = await db
    .select({ id: boardApiKeys.id })
    .from(boardApiKeys)
    .where(eq(boardApiKeys.userId, userId))
    .then((rows) => rows.map((row) => row.id));

  await Promise.all([
    db.delete(authSessions).where(eq(authSessions.userId, userId)),
    keyIds.length > 0
      ? db
        .update(boardApiKeys)
        .set({ revokedAt: now(), lastUsedAt: now() })
        .where(inArray(boardApiKeys.id, keyIds))
      : Promise.resolve(),
  ]);
}

export async function completeHumanRegistration(db: Db, userId: string, input: CompleteRegistrationInput) {
  const companySvc = companyService(db);
  const access = accessService(db);
  const user = await db
    .select({ id: authUsers.id, email: authUsers.email, registrationKind: authUsers.registrationKind })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);

  if (!user) throw notFound("Signed-in user not found");
  if (await hasActiveMembership(db, userId)) {
    throw conflict("Registration already completed", { code: "REGISTRATION_ALREADY_COMPLETED" });
  }

  const makeFirstUserInstanceAdmin =
    isBootstrapGlobalAdminEmail(user.email) ||
    (await activeInstanceAdminCount(db)) === 0;

  if (input.registrationKind === "PF") {
    await assertUniqueCpf(db, input.cpf, userId);
    await db
      .update(authUsers)
      .set({
        name: input.fullName.trim(),
        cpf: normalizeCpf(input.cpf),
        phone: normalizePhone(input.phone),
        registrationKind: "PF",
        updatedAt: now(),
      })
      .where(eq(authUsers.id, userId));

    await upsertUserAddress(db, userId, input.address);

    const company = await companySvc.create({
      name: input.fullName.trim(),
      description: "Personal workspace",
      defaultResponsibleUserId: userId,
    });

    await access.ensureMembership(company.id, "user", userId, "owner", "active");
    await access.ensureRoleDefaultGrants(company.id, userId, "owner", userId);

    if (makeFirstUserInstanceAdmin) {
      await access.promoteInstanceAdmin(userId);
    }

    return company;
  }

  await assertUniqueCpf(db, input.responsibleCpf, userId);
  await assertUniqueCnpj(db, input.cnpj);

  await db
    .update(authUsers)
    .set({
      name: input.responsibleFullName.trim(),
      cpf: normalizeCpf(input.responsibleCpf),
      phone: normalizePhone(input.responsiblePhone),
      registrationKind: "PJ",
      updatedAt: now(),
    })
    .where(eq(authUsers.id, userId));

  await upsertUserAddress(db, userId, input.responsibleAddress);

  const company = await companySvc.create({
    name: input.companyName.trim(),
    description: input.legalName ?? null,
    defaultResponsibleUserId: userId,
    legalName: input.legalName ?? null,
    cnpj: normalizeCnpj(input.cnpj),
    companyPhone: normalizePhone(input.companyPhone),
    registrationKind: "PJ",
  } as typeof companies.$inferInsert);

  await upsertCompanyAddress(db, company.id, input.companyAddress);
  await access.ensureMembership(company.id, "user", userId, "owner", "active");
  await access.ensureRoleDefaultGrants(company.id, userId, "owner", userId);

  if (makeFirstUserInstanceAdmin) {
    await access.promoteInstanceAdmin(userId);
  }

  return company;
}

export async function loadMeSnapshot(db: Db, userId: string) {
  const access = accessService(db);
  const [user, memberships, isSuperAdmin] = await Promise.all([
    db
      .select({
        id: authUsers.id,
        fullName: authUsers.name,
        email: authUsers.email,
        phone: authUsers.phone,
        cpf: authUsers.cpf,
        registrationKind: authUsers.registrationKind,
        status: authUsers.status,
        emailVerified: authUsers.emailVerified,
        emailVerifiedAt: authUsers.emailVerifiedAt,
      })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null),
    db
      .select({
        companyId: companyMemberships.companyId,
        role: companyMemberships.membershipRole,
        status: companyMemberships.status,
        name: companies.name,
      })
      .from(companyMemberships)
      .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
      .where(
        and(
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      ),
    access.isInstanceAdmin(userId),
  ]);

  if (!user) throw notFound("Signed-in user not found");

  return {
    id: user.id,
    fullName: user.fullName ?? null,
    email: user.email ?? null,
    phone: user.phone ?? null,
    cpf: user.cpf ?? null,
    registrationKind: (user.registrationKind as "PF" | "PJ" | null) ?? null,
    status: user.status as "ACTIVE" | "BLOCKED",
    isSuperAdmin,
    emailVerified: Boolean(user.emailVerified),
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    companies: memberships.map((membership) => ({
      id: membership.companyId,
      name: membership.name,
      role: membership.role as "owner" | "admin" | "operator" | "viewer" | null,
      status: membership.status,
    })),
  };
}

export async function createAdminUser(db: Db, input: AdminCreateUserInput, actorUserId: string | null) {
  const access = accessService(db);
  const userId = randomUUID();
  const email = normalizeEmail(input.email);
  const cpf = input.cpf ? normalizeCpf(input.cpf) : null;
  const phone = input.phone ? normalizePhone(input.phone) : null;

  await assertUniqueEmail(db, email);
  await assertUniqueCpf(db, cpf);

  const passwordHash = await hashPassword(input.password);
  const createdAt = now();
  const statusFields = mapStatusToBanFields(input.status);

  await db.transaction(async (tx) => {
    await tx.insert(authUsers).values({
      id: userId,
      name: input.fullName.trim(),
      email,
      emailVerified: false,
      emailVerifiedAt: null,
      image: null,
      cpf,
      phone,
      registrationKind: null,
      role: "user",
      ...statusFields,
      createdAt,
      updatedAt: createdAt,
    });

    if (isBootstrapGlobalAdminEmail(email)) {
      await tx.insert(instanceUserRoles).values({
        userId,
        role: "instance_admin",
      }).onConflictDoNothing();
    }

    await tx.insert(authAccounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      createdAt,
      updatedAt: createdAt,
    });
  });

  if (input.companyId) {
    await access.ensureMembership(
      input.companyId,
      "user",
      userId,
      input.membershipRole ?? "operator",
      "active",
    );
    await access.ensureRoleDefaultGrants(
      input.companyId,
      userId,
      input.membershipRole ?? "operator",
      actorUserId,
    );
  }

  if (input.status === "BLOCKED") {
    await revokeHumanAuthAccess(db, userId);
  }

  return userId;
}

export async function updateAdminUser(db: Db, userId: string, input: AdminUpdateUserInput) {
  const user = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);
  if (!user) throw notFound("User not found");

  await assertUniqueCpf(db, input.cpf ?? undefined, userId);

  const patch: Partial<typeof authUsers.$inferInsert> = {
    updatedAt: now(),
  };
  if (input.fullName !== undefined) patch.name = input.fullName.trim();
  if (input.cpf !== undefined) patch.cpf = input.cpf ? normalizeCpf(input.cpf) : null;
  if (input.phone !== undefined) patch.phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.status !== undefined) {
    Object.assign(patch, mapStatusToBanFields(input.status));
  }

  await db.update(authUsers).set(patch).where(eq(authUsers.id, userId));

  if (input.status === "BLOCKED") {
    await revokeHumanAuthAccess(db, userId);
  }
}

export async function setAdminUserBlocked(
  db: Db,
  userId: string,
  status: "ACTIVE" | "BLOCKED",
  reason: string | null,
) {
  const user = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);
  if (!user) throw notFound("User not found");

  await db
    .update(authUsers)
    .set({
      ...mapStatusToBanFields(status, reason),
      updatedAt: now(),
    })
    .where(eq(authUsers.id, userId));

  if (status === "BLOCKED") {
    await revokeHumanAuthAccess(db, userId);
  }
}

export async function resetAdminUserPassword(db: Db, userId: string, newPassword: string) {
  const user = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);
  if (!user) throw notFound("User not found");

  const passwordHash = await hashPassword(newPassword);
  const existingCredentialAccount = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, "credential")))
    .then((rows) => rows[0] ?? null);

  if (existingCredentialAccount) {
    await db
      .update(authAccounts)
      .set({ password: passwordHash, updatedAt: now() })
      .where(eq(authAccounts.id, existingCredentialAccount.id));
  } else {
    await db.insert(authAccounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      createdAt: now(),
      updatedAt: now(),
    });
  }

  await revokeHumanAuthAccess(db, userId);
}
