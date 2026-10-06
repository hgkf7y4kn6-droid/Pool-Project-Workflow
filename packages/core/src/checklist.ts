import type { Role } from "@pool/types";
import { can } from "./permissions";

export interface ChecklistItemState {
  id: string;
  label: string;
  required: boolean;
  requiresPhoto?: boolean;
  isChecked: boolean;
  /** Number of photos attached for this item (only relevant if requiresPhoto). */
  photoCount?: number;
}

export interface CompletionCheck {
  /** True when the task may be marked complete with the given options. */
  allowed: boolean;
  /** Mandatory items still open. */
  blockingItems: ChecklistItemState[];
  /** Required items that need a photo but have none. */
  missingPhotos: ChecklistItemState[];
  /** True when completion is only possible because an override was used. */
  overridden: boolean;
  reason?: "checklist_incomplete" | "override_not_permitted" | "override_reason_required";
}

/**
 * A task may not be completed while mandatory checklist items are open,
 * unless the user holds `task:override_checklist`, explicitly asks to
 * override, and gives a reason (kept in the audit log).
 */
export function checkTaskCompletion(
  items: ChecklistItemState[],
  role: Role,
  options: { override?: boolean; overrideReason?: string | null } = {},
): CompletionCheck {
  const blockingItems = items.filter((i) => i.required && !i.isChecked);
  const missingPhotos = items.filter((i) => i.required && i.requiresPhoto && (i.photoCount ?? 0) === 0);
  const clean = blockingItems.length === 0 && missingPhotos.length === 0;
  if (clean) return { allowed: true, blockingItems, missingPhotos, overridden: false };
  if (!options.override) {
    return { allowed: false, blockingItems, missingPhotos, overridden: false, reason: "checklist_incomplete" };
  }
  if (!can(role, "task:override_checklist")) {
    return { allowed: false, blockingItems, missingPhotos, overridden: false, reason: "override_not_permitted" };
  }
  if (!options.overrideReason?.trim()) {
    return { allowed: false, blockingItems, missingPhotos, overridden: false, reason: "override_reason_required" };
  }
  return { allowed: true, blockingItems, missingPhotos, overridden: true };
}

export function checklistProgress(items: Pick<ChecklistItemState, "isChecked">[]): {
  done: number;
  total: number;
  pct: number;
} {
  const total = items.length;
  const done = items.filter((i) => i.isChecked).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}
