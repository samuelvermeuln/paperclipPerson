import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authAccounts,
  authSessions,
  authUsers,
  boardApiKeys,
  companies,
  companyMemberships,
  createDb,
  instanceUserRoles,
  principalPermissionGrants,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;

async function createApp(db: Db, actor: Express.Request["actor"]) {
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
  const { accessRoutes } = await import("../routes/access.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", accessRoutes(db, {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    bindHost: "127.0.0.1",
    allowedHostnames: [],
  }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
  });
  return app;
}

async function seedUser(db: Db, input: {
  id?: string;
  name?: string;
  email?: string;
  cpf?: string | null;
  phone?: string | null;
  status?: "ACTIVE" | "BLOCKED";
}) {
  const id = input.id ?? `user-${randomUUID()}`;
  const now = new Date();
  await db.insert(authUsers).values({
    id,
    name: input.name ?? "Jane Example",
    email: input.email ?? `${id}@example.com`,
    emailVerified: false,
    emailVerifiedAt: null,
    image: null,
    cpf: input.cpf ?? null,
    phone: input.phone ?? null,
    registrationKind: null,
    status: input.status ?? "ACTIVE",
    role: "user",
    banned: input.status === "BLOCKED",
    banReason: input.status === "BLOCKED" ? "Blocked" : null,
    banExpires: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedCompany(db: Db) {
  return db.insert(companies).values({
    name: `Admin Routes ${randomUUID()}`,
    issuePrefix: `AU${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
  }).returning().then((rows) => rows[0]!);
}

describeEmbeddedPostgres("admin user routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-admin-user-routes-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(boardApiKeys);
    await db.delete(authSessions);
    await db.delete(authAccounts);
    await db.delete(instanceUserRoles);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("lets instance admins create users with initial company membership", async () => {
    const adminUserId = await seedUser(db, { id: "instance-admin", email: "admin@example.com" });
    await db.insert(instanceUserRoles).values({ userId: adminUserId, role: "instance_admin" });
    const company = await seedCompany(db);

    const app = await createApp(db, {
      type: "board",
      userId: adminUserId,
      source: "session",
      companyIds: [company.id],
      memberships: [{ companyId: company.id, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: true,
    });

    const res = await request(app)
      .post("/api/admin/users")
      .send({
        fullName: "Created User",
        email: "created.user@example.com",
        password: "supersecret123",
        cpf: "39053344705",
        phone: "11987654321",
        status: "ACTIVE",
        companyId: company.id,
        membershipRole: "admin",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(typeof res.body.userId).toBe("string");

    const createdUser = await db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        cpf: authUsers.cpf,
        phone: authUsers.phone,
        status: authUsers.status,
      })
      .from(authUsers)
      .where(eq(authUsers.id, res.body.userId))
      .then((rows) => rows[0] ?? null);
    expect(createdUser).toMatchObject({
      email: "created.user@example.com",
      cpf: "39053344705",
      phone: "11987654321",
      status: "ACTIVE",
    });

    const membership = await db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, company.id),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, res.body.userId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    expect(membership).toMatchObject({
      membershipRole: "admin",
      status: "active",
    });
  }, 20_000);

  it("blocks and revokes active user access", async () => {
    const adminUserId = await seedUser(db, { id: "instance-admin", email: "admin@example.com" });
    await db.insert(instanceUserRoles).values({ userId: adminUserId, role: "instance_admin" });
    const targetUserId = await seedUser(db, {
      id: "target-user",
      email: "target@example.com",
      cpf: "39053344705",
      phone: "11987654321",
    });

    await db.insert(authSessions).values({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60_000),
      token: "token-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: targetUserId,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    });
    const keyId = randomUUID();
    await db.insert(boardApiKeys).values({
      id: keyId,
      userId: targetUserId,
      name: "CLI",
      keyHash: `hash-${randomUUID()}`,
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: null,
      createdAt: new Date(),
    });

    const app = await createApp(db, {
      type: "board",
      userId: adminUserId,
      source: "session",
      companyIds: [],
      memberships: [],
      isInstanceAdmin: true,
    });

    const res = await request(app)
      .post(`/api/admin/users/${targetUserId}/block`)
      .send({ reason: "Policy violation" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const blockedUser = await db
      .select({
        status: authUsers.status,
        banned: authUsers.banned,
        banReason: authUsers.banReason,
      })
      .from(authUsers)
      .where(eq(authUsers.id, targetUserId))
      .then((rows) => rows[0] ?? null);
    expect(blockedUser).toMatchObject({
      status: "BLOCKED",
      banned: true,
      banReason: "Policy violation",
    });

    const sessions = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.userId, targetUserId));
    expect(sessions).toHaveLength(0);

    const apiKey = await db
      .select({ revokedAt: boardApiKeys.revokedAt })
      .from(boardApiKeys)
      .where(eq(boardApiKeys.id, keyId))
      .then((rows) => rows[0] ?? null);
    expect(apiKey?.revokedAt).toBeTruthy();
  }, 10_000);

  it("rejects admin user creation for non-instance-admin actors", async () => {
    const company = await seedCompany(db);
    const actorUserId = await seedUser(db, { id: "plain-user", email: "plain@example.com" });

    const app = await createApp(db, {
      type: "board",
      userId: actorUserId,
      source: "session",
      companyIds: [company.id],
      memberships: [{ companyId: company.id, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .post("/api/admin/users")
      .send({
        fullName: "Nope",
        email: "nope@example.com",
        password: "supersecret123",
        status: "ACTIVE",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("Instance admin required");
  }, 10_000);
});
