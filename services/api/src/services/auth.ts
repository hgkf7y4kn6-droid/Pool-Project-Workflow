import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { DEFAULT_INSPECTION_TEMPLATES, DEFAULT_ORG_SETTINGS, DEFAULT_STAGE_TEMPLATES } from "@pool/core";
import {
  authTokens,
  inspectionTemplates,
  organizations,
  sessions,
  stageTemplates,
  users,
} from "@pool/database";
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from "@pool/database/password";
import type { AuthTokens, LoginResponse, SessionUser } from "@pool/types";
import type { LoginInput, RegisterInput } from "@pool/validation";
import type { Ctx, Deps } from "../context";
import { decrypt, encrypt, randomToken, sha256 } from "../lib/crypto";
import { AppError, badRequest, unauthorized } from "../lib/errors";
import { signAccessToken } from "../lib/tokens";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../lib/totp";

type UserRow = typeof users.$inferSelect;

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  deviceName?: string;
}

export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    organizationId: u.organizationId,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    clientId: u.clientId,
    mfaEnabled: u.mfaEnabled,
  };
}

async function issueTokens(deps: Deps, user: UserRow, sessionId: string, refreshToken: string): Promise<AuthTokens> {
  const accessToken = await signAccessToken(
    { sub: user.id, org: user.organizationId, role: user.role, cid: user.clientId, sid: sessionId },
    { secret: deps.env.JWT_SECRET, issuer: deps.env.JWT_ISSUER, accessTtlSeconds: deps.env.ACCESS_TOKEN_TTL_SECONDS },
  );
  return { accessToken, refreshToken, expiresIn: deps.env.ACCESS_TOKEN_TTL_SECONDS };
}

async function createSession(deps: Deps, user: UserRow, meta: RequestMeta): Promise<LoginResponse> {
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + deps.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000).toISOString();
  const [session] = await deps.db
    .insert(sessions)
    .values({
      userId: user.id,
      refreshTokenHash: sha256(refreshToken),
      deviceName: meta.deviceName ?? null,
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    })
    .returning();
  await deps.db
    .update(users)
    .set({ lastLoginAt: new Date().toISOString(), failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, user.id));
  return { mfaRequired: false, tokens: await issueTokens(deps, user, session!.id, refreshToken), user: toSessionUser(user) };
}

async function findUserByEmail(deps: Deps, email: string): Promise<UserRow | undefined> {
  const [u] = await deps.db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return u;
}

async function createSingleUseToken(
  deps: Deps,
  userId: string,
  purpose: (typeof authTokens.$inferInsert)["purpose"],
  ttlMinutes: number,
): Promise<string> {
  const token = randomToken();
  await deps.db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
  });
  return token;
}

async function consumeToken(
  deps: Deps,
  token: string,
  purpose: (typeof authTokens.$inferInsert)["purpose"],
): Promise<UserRow> {
  const now = new Date().toISOString();
  const [row] = await deps.db
    .update(authTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row) throw new AppError("unauthorized", "This link is invalid or has expired");
  const [user] = await deps.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user || !user.isActive) throw unauthorized("Account is disabled");
  return user;
}

// ---------------------------------------------------------------------------

/** Create a new organization with its first administrator. */
export async function register(deps: Deps, input: RegisterInput, meta: RequestMeta): Promise<LoginResponse> {
  if (await findUserByEmail(deps, input.email)) {
    throw new AppError("conflict", "An account with this email already exists");
  }
  const passwordHash = await hashPassword(input.password);
  const user = await deps.db.transaction(async (tx) => {
    const baseSlug =
      input.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "org";
    const slug = `${baseSlug}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.organizationName, slug, timezone: input.timezone, settings: DEFAULT_ORG_SETTINGS })
      .returning();
    await tx.insert(stageTemplates).values(
      DEFAULT_STAGE_TEMPLATES.map((t, i) => ({
        organizationId: org!.id,
        key: t.key,
        name: t.name,
        sortOrder: i,
        defaultDurationDays: t.defaultDurationDays,
        isMilestone: t.isMilestone,
        weatherSensitive: t.weatherSensitive,
        checklist: t.checklist,
      })),
    );
    await tx
      .insert(inspectionTemplates)
      .values(DEFAULT_INSPECTION_TEMPLATES.map((t) => ({ organizationId: org!.id, ...t })));
    const [u] = await tx
      .insert(users)
      .values({ organizationId: org!.id, email: input.email, fullName: input.fullName, role: "admin", passwordHash })
      .returning();
    return u!;
  });
  return createSession(deps, user, meta);
}

export async function login(deps: Deps, input: LoginInput, meta: RequestMeta): Promise<LoginResponse> {
  const user = await findUserByEmail(deps, input.email);
  // Always run a hash comparison so response time does not reveal whether the email exists.
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !user.passwordHash || !user.isActive) throw unauthorized("Invalid email or password");
  if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
    throw new AppError("rate_limited", "Too many failed attempts. Try again in a few minutes.");
  }
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    await deps.db
      .update(users)
      .set({
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
      })
      .where(eq(users.id, user.id));
    throw unauthorized("Invalid email or password");
  }
  if (needsRehash(user.passwordHash)) {
    await deps.db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, user.id));
  }
  if (user.mfaEnabled) {
    const ticket = await createSingleUseToken(deps, user.id, "mfa_ticket", 5);
    return { mfaRequired: true, mfaTicket: ticket };
  }
  return createSession(deps, user, { ...meta, deviceName: input.deviceName ?? meta.deviceName });
}

export async function verifyMfa(deps: Deps, ticket: string, code: string, meta: RequestMeta): Promise<LoginResponse> {
  const user = await consumeToken(deps, ticket, "mfa_ticket");
  if (!user.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc, deps.env.DATA_ENCRYPTION_KEY), code)) {
    throw unauthorized("Invalid verification code");
  }
  return createSession(deps, user, meta);
}

/**
 * Rotate a refresh token. Presenting an already-rotated token means it was
 * stolen or replayed: the whole session is revoked.
 */
export async function refresh(deps: Deps, refreshToken: string): Promise<AuthTokens> {
  const hash = sha256(refreshToken);
  const now = new Date().toISOString();
  const [session] = await deps.db.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).limit(1);
  if (!session) {
    const [reused] = await deps.db.select().from(sessions).where(eq(sessions.previousTokenHash, hash)).limit(1);
    if (reused && !reused.revokedAt) {
      await deps.db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, reused.id));
      deps.log.warn({ sessionId: reused.id }, "refresh token reuse detected; session revoked");
    }
    throw unauthorized("Session expired");
  }
  if (session.revokedAt || Date.parse(session.expiresAt) < Date.now()) throw unauthorized("Session expired");
  const [user] = await deps.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || !user.isActive) throw unauthorized("Account is disabled");
  const next = randomToken();
  await deps.db
    .update(sessions)
    .set({ refreshTokenHash: sha256(next), previousTokenHash: hash, lastUsedAt: now })
    .where(eq(sessions.id, session.id));
  return issueTokens(deps, user, session.id, next);
}

export async function logout(ctx: Ctx): Promise<void> {
  await ctx.deps.db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, ctx.auth.sessionId), eq(sessions.userId, ctx.auth.userId)));
}

export async function isSessionActive(deps: Deps, sessionId: string): Promise<boolean> {
  const [s] = await deps.db
    .select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return !!s && !s.revokedAt && Date.parse(s.expiresAt) > Date.now();
}

export async function listSessions(ctx: Ctx) {
  const rows = await ctx.deps.db
    .select({
      id: sessions.id,
      deviceName: sessions.deviceName,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, ctx.auth.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date().toISOString())));
  return rows.map((r) => ({ ...r, current: r.id === ctx.auth.sessionId }));
}

export async function revokeSession(ctx: Ctx, sessionId: string) {
  await ctx.deps.db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, ctx.auth.userId)));
}

export async function forgotPassword(deps: Deps, email: string): Promise<void> {
  const user = await findUserByEmail(deps, email);
  // Same response either way to avoid account enumeration.
  if (!user || !user.isActive) return;
  const token = await createSingleUseToken(deps, user.id, "password_reset", 30);
  const link = `${deps.env.APP_URL}reset-password?token=${encodeURIComponent(token)}`;
  await deps.mailer.send({
    to: user.email,
    subject: "Reset your password",
    text: `Hi ${user.fullName},\n\nUse this link within 30 minutes to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
  });
}

export async function resetPassword(deps: Deps, token: string, password: string): Promise<void> {
  const user = await consumeToken(deps, token, "password_reset");
  await deps.db
    .update(users)
    .set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, user.id));
  // A password reset signs out every device.
  await deps.db.update(sessions).set({ revokedAt: new Date().toISOString() }).where(eq(sessions.userId, user.id));
}

export async function requestMagicLink(deps: Deps, email: string): Promise<void> {
  const user = await findUserByEmail(deps, email);
  if (!user || !user.isActive) return;
  const token = await createSingleUseToken(deps, user.id, "magic_link", 15);
  await deps.mailer.send({
    to: user.email,
    subject: "Your sign-in link",
    text: `Tap to sign in (valid for 15 minutes):\n${deps.env.APP_URL}magic-link?token=${encodeURIComponent(token)}`,
  });
}

export async function verifyMagicLink(deps: Deps, token: string, meta: RequestMeta): Promise<LoginResponse> {
  const user = await consumeToken(deps, token, "magic_link");
  if (user.mfaEnabled) {
    return { mfaRequired: true, mfaTicket: await createSingleUseToken(deps, user.id, "mfa_ticket", 5) };
  }
  return createSession(deps, user, meta);
}

export async function acceptInvite(deps: Deps, token: string, password: string, meta: RequestMeta): Promise<LoginResponse> {
  const user = await consumeToken(deps, token, "invite");
  const [updated] = await deps.db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, user.id))
    .returning();
  return createSession(deps, updated!, meta);
}

export async function sendInvite(deps: Deps, user: UserRow, inviterName: string): Promise<void> {
  const token = await createSingleUseToken(deps, user.id, "invite", 7 * 24 * 60);
  await deps.mailer.send({
    to: user.email,
    subject: `${inviterName} invited you to Pool PM`,
    text: `Hi ${user.fullName},\n\n${inviterName} invited you to join their team.\nSet your password here (valid 7 days):\n${deps.env.APP_URL}accept-invite?token=${encodeURIComponent(token)}`,
  });
}

export async function oauthLogin(
  deps: Deps,
  provider: "google" | "apple",
  idToken: string,
  meta: RequestMeta,
): Promise<LoginResponse> {
  let identity;
  try {
    identity = await deps.oauth.verify(provider, idToken);
  } catch (error) {
    deps.log.info({ err: error }, "oauth verification failed");
    throw unauthorized("Could not verify sign-in");
  }
  if (!identity.email || !identity.emailVerified) throw unauthorized("A verified email address is required");
  const user = await findUserByEmail(deps, identity.email);
  if (!user || !user.isActive) throw unauthorized("No account exists for this email. Ask your administrator for an invite.");
  if (user.mfaEnabled) {
    return { mfaRequired: true, mfaTicket: await createSingleUseToken(deps, user.id, "mfa_ticket", 5) };
  }
  return createSession(deps, user, meta);
}

export async function me(ctx: Ctx): Promise<SessionUser> {
  const [u] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.auth.userId)).limit(1);
  if (!u) throw unauthorized();
  return toSessionUser(u);
}

export async function changePassword(ctx: Ctx, current: string, next: string): Promise<void> {
  const [u] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.auth.userId)).limit(1);
  if (!u?.passwordHash || !(await verifyPassword(current, u.passwordHash))) {
    throw badRequest("Current password is incorrect");
  }
  await ctx.deps.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, u.id));
}

export async function mfaSetup(ctx: Ctx): Promise<{ secret: string; otpauthUrl: string }> {
  const [u] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.auth.userId)).limit(1);
  if (!u) throw unauthorized();
  if (u.mfaEnabled) throw badRequest("Two-factor authentication is already enabled");
  const secret = generateTotpSecret();
  await ctx.deps.db
    .update(users)
    .set({ mfaSecretEnc: encrypt(secret, ctx.deps.env.DATA_ENCRYPTION_KEY) })
    .where(eq(users.id, u.id));
  return { secret, otpauthUrl: otpauthUrl(secret, u.email) };
}

export async function mfaConfirm(ctx: Ctx, code: string, enable: boolean): Promise<void> {
  const [u] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.auth.userId)).limit(1);
  if (!u?.mfaSecretEnc) throw badRequest("Start two-factor setup first");
  if (!verifyTotp(decrypt(u.mfaSecretEnc, ctx.deps.env.DATA_ENCRYPTION_KEY), code)) {
    throw badRequest("Invalid verification code");
  }
  await ctx.deps.db
    .update(users)
    .set({ mfaEnabled: enable, mfaSecretEnc: enable ? u.mfaSecretEnc : null })
    .where(eq(users.id, u.id));
}
