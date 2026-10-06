import { createRemoteJWKSet, jwtVerify } from "jose";

export interface OAuthIdentity {
  provider: "google" | "apple";
  subject: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Verifies ID tokens obtained natively on the device (Google Sign-In, Sign in
 * with Apple). OAuth only signs in existing/invited users — it never creates
 * accounts inside an organization on its own.
 */
export class OAuthVerifier {
  private google = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  private apple = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

  constructor(
    private readonly googleClientIds: string[],
    private readonly appleClientIds: string[],
  ) {}

  enabledProviders(): ("google" | "apple")[] {
    return [
      ...(this.googleClientIds.length ? (["google"] as const) : []),
      ...(this.appleClientIds.length ? (["apple"] as const) : []),
    ];
  }

  async verify(provider: "google" | "apple", idToken: string): Promise<OAuthIdentity> {
    if (provider === "google") {
      if (!this.googleClientIds.length) throw new Error("Google sign-in is not configured");
      const { payload } = await jwtVerify(idToken, this.google, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: this.googleClientIds,
      });
      return {
        provider,
        subject: String(payload.sub),
        email: String(payload.email ?? "").toLowerCase(),
        emailVerified: payload.email_verified === true,
      };
    }
    if (!this.appleClientIds.length) throw new Error("Apple sign-in is not configured");
    const { payload } = await jwtVerify(idToken, this.apple, {
      issuer: "https://appleid.apple.com",
      audience: this.appleClientIds,
    });
    return {
      provider,
      subject: String(payload.sub),
      email: String(payload.email ?? "").toLowerCase(),
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
    };
  }
}
