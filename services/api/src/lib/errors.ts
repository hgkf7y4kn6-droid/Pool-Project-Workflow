import type { ApiErrorCode } from "@pool/types";

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  precondition_failed: 412,
  internal_error: 500,
  service_unavailable: 503,
};

/** Errors thrown by services; the error handler maps them to the API envelope. */
export class AppError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, string[]>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = STATUS[code];
  }
}

export const notFound = (what = "Resource") => new AppError("not_found", `${what} not found`);
export const forbidden = (message = "You do not have permission to do that") => new AppError("forbidden", message);
export const badRequest = (message: string, details?: Record<string, string[]>) =>
  new AppError("bad_request", message, details);
export const conflict = (message: string, extra?: Record<string, unknown>) =>
  new AppError("conflict", message, undefined, extra);
export const unauthorized = (message = "Authentication required") => new AppError("unauthorized", message);
