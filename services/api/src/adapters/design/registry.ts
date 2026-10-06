import type { PoolDesignProvider } from "./types";

/**
 * Registered design providers. "manual" is built in: designs are created in
 * this app (dimensions + uploaded models/renderings) and rendered with the
 * parametric 3D viewer, so the feature works without any vendor account.
 */
export class DesignProviderRegistry {
  private providers = new Map<string, PoolDesignProvider>();

  register(provider: PoolDesignProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): PoolDesignProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(): { id: string; displayName: string }[] {
    return [
      { id: "manual", displayName: "Built-in designer" },
      ...[...this.providers.values()].map((p) => ({ id: p.id, displayName: p.displayName })),
    ];
  }
}
