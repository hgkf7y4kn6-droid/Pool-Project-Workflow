import { SignJWT, jwtVerify } from "jose";
import type { AccessTokenClaims } from "@pool/types";

export interface TokenConfig {
  secret: string;
  issuer: string;
  accessTtlSeconds: number;
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(claims: AccessTokenClaims, config: TokenConfig): Promise<string> {
  return new SignJWT({ org: claims.org, role: claims.role, cid: claims.cid, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(config.issuer)
    .setAudience("pool-pm")
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlSeconds}s`)
    .sign(key(config.secret));
}

export async function verifyAccessToken(token: string, config: TokenConfig): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, key(config.secret), {
    issuer: config.issuer,
    audience: "pool-pm",
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || typeof payload.org !== "string" || typeof payload.role !== "string") {
    throw new Error("Malformed token");
  }
  return {
    sub: payload.sub,
    org: payload.org,
    role: payload.role as AccessTokenClaims["role"],
    cid: (payload.cid as string | null) ?? null,
    sid: payload.sid as string,
  };
}
