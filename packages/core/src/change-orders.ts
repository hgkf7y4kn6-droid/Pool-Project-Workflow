import type { ChangeOrderStatus, Role } from "@pool/types";
import { can, type Permission } from "./permissions";

/**
 * Change-order workflow:
 *
 *   draft → submitted → client_review → approved → scheduled → completed
 *                 ↘ draft        ↘ rejected → draft
 *   (any state before completed) → void
 */
interface TransitionRule {
  to: ChangeOrderStatus;
  permission: Permission;
  /** A signature (name + image) must accompany this transition. */
  requiresSignature?: boolean;
}

const TRANSITIONS: Record<ChangeOrderStatus, TransitionRule[]> = {
  draft: [
    { to: "submitted", permission: "change_order:submit" },
    { to: "void", permission: "change_order:decide_internal" },
  ],
  submitted: [
    { to: "client_review", permission: "change_order:submit" },
    { to: "draft", permission: "change_order:submit" },
    { to: "void", permission: "change_order:decide_internal" },
  ],
  client_review: [
    { to: "approved", permission: "change_order:client_decide", requiresSignature: true },
    { to: "rejected", permission: "change_order:client_decide" },
    // Office staff may record a decision made on paper / by phone.
    { to: "approved", permission: "change_order:decide_internal", requiresSignature: true },
    { to: "rejected", permission: "change_order:decide_internal" },
    { to: "void", permission: "change_order:decide_internal" },
  ],
  approved: [
    { to: "scheduled", permission: "change_order:schedule" },
    { to: "void", permission: "change_order:decide_internal" },
  ],
  rejected: [
    { to: "draft", permission: "change_order:create" },
    { to: "void", permission: "change_order:decide_internal" },
  ],
  scheduled: [
    { to: "completed", permission: "change_order:schedule" },
    { to: "void", permission: "change_order:decide_internal" },
  ],
  completed: [],
  void: [],
};

export type TransitionCheck =
  | { allowed: true; requiresSignature: boolean }
  | { allowed: false; reason: "invalid_transition" | "forbidden" };

export function checkChangeOrderTransition(
  from: ChangeOrderStatus,
  to: ChangeOrderStatus,
  role: Role,
): TransitionCheck {
  const rules = TRANSITIONS[from].filter((r) => r.to === to);
  if (rules.length === 0) return { allowed: false, reason: "invalid_transition" };
  const rule = rules.find((r) => can(role, r.permission));
  if (!rule) return { allowed: false, reason: "forbidden" };
  return { allowed: true, requiresSignature: !!rule.requiresSignature };
}

/** Statuses the given role can move a change order to from `from`. */
export function availableChangeOrderTransitions(from: ChangeOrderStatus, role: Role): ChangeOrderStatus[] {
  const targets = TRANSITIONS[from].filter((r) => can(role, r.permission)).map((r) => r.to);
  return [...new Set(targets)];
}

/** Statuses whose price counts toward contract revenue. */
export const REVENUE_CHANGE_ORDER_STATUSES: readonly ChangeOrderStatus[] = ["approved", "scheduled", "completed"];

/** Statuses awaiting a decision (dashboard "pending change orders"). */
export const PENDING_CHANGE_ORDER_STATUSES: readonly ChangeOrderStatus[] = ["submitted", "client_review"];
