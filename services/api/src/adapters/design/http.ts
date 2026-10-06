import type { Design, DesignProjectInput, DesignProjectRef, Model3D, PoolDesignProvider, Rendering } from "./types";

/**
 * Generic REST adapter. Any design platform (or a thin bridge in front of
 * one) that exposes this contract can be connected without code changes:
 *
 *   POST  {base}/projects                 → { externalId, editorUrl }
 *   GET   {base}/projects/:id/design      → Design
 *   GET   {base}/projects/:id/model       → Model3D | 404
 *   GET   {base}/projects/:id/renderings  → Rendering[]
 *   PATCH {base}/projects/:id/design      ← Partial<Design>
 */
export class HttpDesignProvider implements PoolDesignProvider {
  readonly id = "http";
  readonly displayName: string;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
    displayName = "External design platform",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.displayName = displayName;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Design provider ${method} ${path} failed with ${res.status}`);
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  async createProject(input: DesignProjectInput): Promise<DesignProjectRef> {
    const ref = await this.request<DesignProjectRef>("POST", "/projects", input);
    if (!ref) throw new Error("Design provider did not create a project");
    return ref;
  }
  async getDesign(externalId: string): Promise<Design> {
    const design = await this.request<Design>("GET", `/projects/${encodeURIComponent(externalId)}/design`);
    if (!design) throw new Error("Design not found at provider");
    return design;
  }
  async get3DModel(externalId: string): Promise<Model3D | null> {
    return this.request<Model3D>("GET", `/projects/${encodeURIComponent(externalId)}/model`);
  }
  async getRendering(externalId: string): Promise<Rendering[]> {
    return (await this.request<Rendering[]>("GET", `/projects/${encodeURIComponent(externalId)}/renderings`)) ?? [];
  }
  async updateDesign(externalId: string, patch: Partial<Pick<Design, "title" | "status" | "summary">>): Promise<void> {
    await this.request("PATCH", `/projects/${encodeURIComponent(externalId)}/design`, patch);
  }
}
