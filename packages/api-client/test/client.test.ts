import { describe, expect, it, vi } from "vitest";
import type { AuthTokens } from "@pool/types";
import { ApiClient, ApiError, NetworkError, isRetryable, type TokenStore } from "../src";

function memoryTokens(initial: AuthTokens | null): TokenStore & { value: AuthTokens | null } {
  return {
    value: initial,
    async get() {
      return this.value;
    },
    async set(t) {
      this.value = t;
    },
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ApiClient", () => {
  it("refreshes once on 401 and retries concurrent requests", async () => {
    const tokens = memoryTokens({ accessToken: "old", refreshToken: "r1", expiresIn: 900 });
    let refreshes = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/refresh")) {
        refreshes += 1;
        return json(200, { data: { accessToken: "new", refreshToken: "r2", expiresIn: 900 } });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === "Bearer new" ? json(200, { data: { ok: true } }) : json(401, { error: { code: "unauthorized", message: "expired" } });
    });
    const client = new ApiClient({ baseUrl: "https://api.test/", tokens, fetch: fetchMock as typeof fetch });
    const results = await Promise.all([client.get("/a"), client.get("/b"), client.get("/c")]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
    expect(tokens.value?.refreshToken).toBe("r2");
  });

  it("ends the session when refresh is rejected", async () => {
    const tokens = memoryTokens({ accessToken: "old", refreshToken: "r1", expiresIn: 900 });
    const onSessionExpired = vi.fn();
    const fetchMock = vi.fn(async () => json(401, { error: { code: "unauthorized", message: "Session expired" } }));
    const client = new ApiClient({ baseUrl: "https://api.test", tokens, fetch: fetchMock as typeof fetch, onSessionExpired });
    await expect(client.get("/x")).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(tokens.value).toBeNull();
  });

  it("maps errors for retry decisions", async () => {
    const tokens = memoryTokens(null);
    const offline = new ApiClient({ baseUrl: "https://api.test", tokens, fetch: (async () => { throw new TypeError("fail"); }) as typeof fetch });
    const err = await offline.get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(isRetryable(err)).toBe(true);
    expect(isRetryable(new ApiError(422, "validation_failed", "bad"))).toBe(false);
    expect(isRetryable(new ApiError(503, "service_unavailable", "down"))).toBe(true);
  });

  it("builds query strings and parses the envelope", async () => {
    const tokens = memoryTokens({ accessToken: "t", refreshToken: "r", expiresIn: 1 });
    const fetchMock = vi.fn(async (url: string | URL | Request) => json(200, { data: [String(url)], meta: { nextCursor: "abc" } }));
    const client = new ApiClient({ baseUrl: "https://api.test", tokens, fetch: fetchMock as typeof fetch });
    const page = await client.page<string>("/projects", { scope: "active", q: "a b", empty: "" , none: undefined });
    expect(page.items[0]).toBe("https://api.test/projects?scope=active&q=a%20b");
    expect(page.meta.nextCursor).toBe("abc");
  });
});
