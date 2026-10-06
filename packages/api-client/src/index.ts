import type {
  ApiErrorBody,
  ApiMeta,
  AuthTokens,
  LoginResponse,
  SessionUser,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from "@pool/types";

/**
 * Typed HTTP client for the Pool PM API.
 *
 * - Attaches the access token, refreshes it once on 401 (single-flight, so
 *   concurrent requests share one refresh) and retries the request.
 * - Normalizes failures into ApiError (HTTP error) or NetworkError (no
 *   response), which the sync engine maps to retry/backoff behavior.
 * - Holds no storage itself: the app provides a TokenStore (SecureStore).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorBody["error"]["code"],
    message: string,
    readonly details?: Record<string, string[]>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Network request failed") {
    super(message);
    this.name = "NetworkError";
  }
}

export interface TokenStore {
  get(): Promise<AuthTokens | null>;
  set(tokens: AuthTokens | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetch?: typeof fetch;
  /** Called when refresh fails: the app should return to the login screen. */
  onSessionExpired?: () => void;
  deviceName?: string;
  timeoutMs?: number;
}

export interface Page<T> {
  items: T[];
  meta: ApiMeta;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export class ApiClient {
  private refreshing: Promise<AuthTokens | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
  }

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, "");
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    opts: { query?: Query; auth?: boolean; raw?: boolean } = {},
  ): Promise<{ data: T; meta: ApiMeta }> {
    const auth = opts.auth ?? true;
    const send = async (token: string | null): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
      try {
        return await this.fetchImpl(this.url(path, opts.query), {
          method,
          headers: {
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(this.options.deviceName ? { "X-Device-Name": this.options.deviceName } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        throw new NetworkError(error instanceof Error && error.name === "AbortError" ? "Request timed out" : "Network request failed");
      } finally {
        clearTimeout(timer);
      }
    };

    let tokens = auth ? await this.options.tokens.get() : null;
    let res = await send(tokens?.accessToken ?? null);
    if (res.status === 401 && auth && tokens) {
      tokens = await this.refresh();
      if (!tokens) {
        this.options.onSessionExpired?.();
        throw await this.toError(res);
      }
      res = await send(tokens.accessToken);
    }
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204) return { data: undefined as T, meta: {} };
    const json = (await res.json()) as { data: T; meta?: ApiMeta };
    return { data: json.data, meta: json.meta ?? {} };
  }

  url(path: string, query?: Query): string {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  /** Single-flight refresh; returns null if the session can no longer be renewed. */
  async refresh(): Promise<AuthTokens | null> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const current = await this.options.tokens.get();
      if (!current?.refreshToken) return null;
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) {
          // Only a definitive auth failure ends the session; keep tokens on server errors.
          if (res.status === 401) await this.options.tokens.set(null);
          return null;
        }
        const next = ((await res.json()) as { data: AuthTokens }).data;
        await this.options.tokens.set(next);
        return next;
      } catch {
        throw new NetworkError();
      } finally {
        setTimeout(() => (this.refreshing = null), 0);
      }
    })();
    return this.refreshing;
  }

  private async toError(res: Response): Promise<ApiError> {
    try {
      const body = (await res.json()) as ApiErrorBody & { error: { extra?: Record<string, unknown> } };
      return new ApiError(res.status, body.error.code, body.error.message, body.error.details, body.error.extra);
    } catch {
      return new ApiError(res.status, res.status >= 500 ? "internal_error" : "bad_request", `Request failed (${res.status})`);
    }
  }

  // --- Convenience -----------------------------------------------------------

  get<T>(path: string, query?: Query) {
    return this.request<T>("GET", path, undefined, { query }).then((r) => r.data);
  }
  page<T>(path: string, query?: Query): Promise<Page<T>> {
    return this.request<T[]>("GET", path, undefined, { query }).then((r) => ({ items: r.data, meta: r.meta }));
  }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>("POST", path, body).then((r) => r.data);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, body).then((r) => r.data);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>("PUT", path, body).then((r) => r.data);
  }
  delete<T>(path: string) {
    return this.request<T>("DELETE", path).then((r) => r.data);
  }

  // --- Auth ------------------------------------------------------------------

  async login(email: string, password: string): Promise<LoginResponse> {
    const { data } = await this.request<LoginResponse>("POST", "/auth/login", { email, password, deviceName: this.options.deviceName }, { auth: false });
    if (data.tokens) await this.options.tokens.set(data.tokens);
    return data;
  }

  async verifyMfa(ticket: string, code: string): Promise<LoginResponse> {
    const { data } = await this.request<LoginResponse>("POST", "/auth/mfa/verify", { ticket, code }, { auth: false });
    if (data.tokens) await this.options.tokens.set(data.tokens);
    return data;
  }

  async register(input: { organizationName: string; fullName: string; email: string; password: string; timezone?: string }) {
    const { data } = await this.request<LoginResponse>("POST", "/auth/register", input, { auth: false });
    if (data.tokens) await this.options.tokens.set(data.tokens);
    return data;
  }

  async verifyMagicLink(token: string): Promise<LoginResponse> {
    const { data } = await this.request<LoginResponse>("POST", "/auth/magic-link/verify", { token }, { auth: false });
    if (data.tokens) await this.options.tokens.set(data.tokens);
    return data;
  }

  forgotPassword(email: string) {
    return this.request("POST", "/auth/password/forgot", { email }, { auth: false });
  }
  requestMagicLink(email: string) {
    return this.request("POST", "/auth/magic-link", { email }, { auth: false });
  }
  me() {
    return this.get<SessionUser>("/auth/me");
  }
  async logout(): Promise<void> {
    try {
      await this.post("/auth/logout");
    } finally {
      await this.options.tokens.set(null);
    }
  }

  // --- Sync ------------------------------------------------------------------

  syncPush(request: SyncPushRequest) {
    return this.post<SyncPushResponse>("/sync/push", request);
  }
  syncPull(request: SyncPullRequest) {
    return this.post<SyncPullResponse>("/sync/pull", request);
  }

  /** Upload a file to a signed URL returned by the API (photos, documents). */
  async uploadToSignedUrl(upload: { url: string; method: "PUT"; headers: Record<string, string> }, body: Blob | ArrayBuffer | Uint8Array): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(upload.url, { method: upload.method, headers: upload.headers, body: body as BodyInit });
    } catch {
      throw new NetworkError("Upload failed");
    }
    if (!res.ok) throw new ApiError(res.status, res.status >= 500 ? "service_unavailable" : "bad_request", `Upload failed (${res.status})`);
  }

  /** WebSocket URL for real-time hints. */
  async realtimeUrl(): Promise<string | null> {
    const tokens = await this.options.tokens.get();
    if (!tokens) return null;
    return `${this.baseUrl.replace(/^http/, "ws")}/realtime?token=${encodeURIComponent(tokens.accessToken)}`;
  }
}

/** Is this error worth retrying later (offline, timeout, 5xx, 429)? */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.status >= 500 || error.status === 429 || error.status === 408;
  return false;
}
