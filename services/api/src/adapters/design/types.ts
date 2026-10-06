import type { DesignSummary } from "@pool/types";

/**
 * Provider-agnostic contract for external pool design / CAD platforms.
 *
 *   Pool Management App → Integration API → External Design Platform
 *                       ← 3D model / rendering ←
 *
 * The app never talks to a vendor directly; adding a vendor means writing one
 * class that implements this interface and registering it.
 */
export interface DesignProjectInput {
  title: string;
  projectNumber: string;
  propertyAddress?: string;
  location?: { latitude: number; longitude: number } | null;
  /** CAD-friendly site measurements (see Measurement.geometry). */
  measurements?: { label: string; category: string; value: number; unit: string; geometry?: unknown }[];
}

export interface DesignProjectRef {
  externalId: string;
  editorUrl?: string | null;
}

export interface Design {
  externalId: string;
  title: string;
  status: "draft" | "in_review" | "approved" | "superseded";
  summary: DesignSummary;
  updatedAt: string;
}

export interface Model3D {
  url: string;
  /** "glb" | "gltf" | "usdz" | "parametric" */
  format: string;
  thumbnailUrl?: string | null;
}

export interface Rendering {
  id: string;
  title: string;
  kind: "rendering" | "plan" | "landscape_concept" | "deck_layout";
  url: string;
  thumbnailUrl?: string | null;
}

export interface PoolDesignProvider {
  readonly id: string;
  readonly displayName: string;
  createProject(input: DesignProjectInput): Promise<DesignProjectRef>;
  getDesign(externalId: string): Promise<Design>;
  get3DModel(externalId: string): Promise<Model3D | null>;
  getRendering(externalId: string): Promise<Rendering[]>;
  updateDesign(externalId: string, patch: Partial<Pick<Design, "title" | "status" | "summary">>): Promise<void>;
}
