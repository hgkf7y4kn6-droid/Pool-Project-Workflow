import type { Role } from "./enums";
import type { UUID } from "./entities";

/** Every successful API response is wrapped in this envelope. */
export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiMeta {
  /** Opaque cursor for the next page; absent on the last page. */
  nextCursor?: string | null;
  total?: number;
  [key: string]: unknown;
}

/** Every error response uses this shape (HTTP status carries the class). */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level validation issues, keyed by dotted path. */
    details?: Record<string, string[]>;
    requestId?: string;
  };
}

export type ApiErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "precondition_failed"
  | "internal_error"
  | "service_unavailable";

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
}

export interface SessionUser {
  id: UUID;
  organizationId: UUID;
  email: string;
  fullName: string;
  role: Role;
  clientId: UUID | null;
  mfaEnabled: boolean;
}

export interface LoginResponse {
  /** When MFA is required the client must call /auth/mfa/verify with this ticket. */
  mfaRequired: boolean;
  mfaTicket?: string;
  tokens?: AuthTokens;
  user?: SessionUser;
}

/** Claims embedded in the access JWT. */
export interface AccessTokenClaims {
  sub: UUID;
  org: UUID;
  role: Role;
  cid: UUID | null;
  sid: UUID;
}
