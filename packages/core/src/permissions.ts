import type { ChangeOrder, Project, Role } from "@pool/types";

/**
 * Role-based access control.
 *
 * Permissions are coarse capabilities; *which* rows a user may touch is
 * decided separately by project access scope (row-level authorization), see
 * `projectAccessScope`. Both checks must pass on the server. The mobile app
 * uses the same matrix only to hide UI it knows the server will refuse.
 */
export const PERMISSIONS = [
  "org:manage",
  "user:read",
  "user:manage",
  "team:manage",
  "project:create",
  "project:read",
  "project:update",
  "project:archive",
  "stage:update",
  "stage_template:manage",
  "task:read",
  "task:create",
  "task:update",
  "task:update_assigned",
  "task:assign",
  "task:delete",
  "task:override_checklist",
  "schedule:update",
  "budget:read",
  "budget:update",
  "expense:create",
  "labor:read",
  "labor:create",
  "labor:create_own",
  "material:read",
  "material:manage",
  "vendor:read",
  "vendor:manage",
  "change_order:read",
  "change_order:create",
  "change_order:submit",
  "change_order:decide_internal",
  "change_order:client_decide",
  "change_order:schedule",
  "photo:read",
  "photo:create",
  "photo:delete",
  "document:read",
  "document:upload",
  "document:delete",
  "measurement:read",
  "measurement:create",
  "inspection:read",
  "inspection:create",
  "approval:read",
  "approval:request",
  "approval:decide",
  "payment:read",
  "payment:manage",
  "message:read",
  "message:send",
  "message:read_internal",
  "client:read",
  "client:manage",
  "property:read",
  "property:manage",
  "report:read",
  "design:read",
  "design:manage",
  "integration:manage",
  "activity:read",
  "activity:read_internal",
  "ai:use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const FIELD_COMMON: Permission[] = [
  "project:read",
  "task:read",
  "task:update_assigned",
  "labor:create_own",
  "material:read",
  "photo:read",
  "photo:create",
  "document:read",
  "measurement:read",
  "measurement:create",
  "inspection:read",
  "message:read",
  "message:send",
  "message:read_internal",
  "client:read",
  "property:read",
  "design:read",
  "activity:read",
  "activity:read_internal",
  "change_order:read",
  "approval:read",
  "vendor:read",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: ALL,
  project_manager: new Set<Permission>([
    ...FIELD_COMMON,
    "user:read",
    "team:manage",
    "project:create",
    "project:update",
    "project:archive",
    "stage:update",
    "task:create",
    "task:update",
    "task:assign",
    "task:delete",
    "task:override_checklist",
    "schedule:update",
    "budget:read",
    "budget:update",
    "expense:create",
    "labor:read",
    "labor:create",
    "material:manage",
    "vendor:manage",
    "change_order:create",
    "change_order:submit",
    "change_order:decide_internal",
    "change_order:schedule",
    "photo:delete",
    "document:upload",
    "document:delete",
    "inspection:create",
    "approval:request",
    "payment:read",
    "payment:manage",
    "client:manage",
    "property:manage",
    "report:read",
    "design:manage",
    "ai:use",
  ]),
  designer: new Set<Permission>([
    "project:read",
    "task:read",
    "photo:read",
    "photo:create",
    "document:read",
    "document:upload",
    "measurement:read",
    "measurement:create",
    "message:read",
    "message:send",
    "message:read_internal",
    "client:read",
    "property:read",
    "design:read",
    "design:manage",
    "activity:read",
    "activity:read_internal",
    "approval:read",
    "approval:request",
    "change_order:read",
    "ai:use",
  ]),
  field_supervisor: new Set<Permission>([
    ...FIELD_COMMON,
    "user:read",
    "task:create",
    "task:update",
    "task:assign",
    "task:override_checklist",
    "schedule:update",
    "labor:read",
    "labor:create",
    "expense:create",
    "inspection:create",
    "document:upload",
    "change_order:create",
    "ai:use",
  ]),
  field_worker: new Set<Permission>(FIELD_COMMON),
  subcontractor: new Set<Permission>([
    "project:read",
    "task:read",
    "task:update_assigned",
    "labor:create_own",
    "photo:read",
    "photo:create",
    "document:read",
    "measurement:read",
    "measurement:create",
    "message:read",
    "message:send",
    "property:read",
    "activity:read",
  ]),
  client: new Set<Permission>([
    "project:read",
    "photo:read",
    "document:read",
    "change_order:read",
    "change_order:client_decide",
    "approval:read",
    "approval:decide",
    "payment:read",
    "message:read",
    "message:send",
    "design:read",
    "activity:read",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/**
 * Which projects a role can see:
 * - organization: every project in the organization
 * - assigned: projects the user manages, is a member of, belongs to the crew
 *   of, or has a task assigned on
 * - client: projects whose client record is linked to the user
 */
export type ProjectAccessScope = "organization" | "assigned" | "client";

export function projectAccessScope(role: Role): ProjectAccessScope {
  if (role === "admin") return "organization";
  if (role === "client") return "client";
  return "assigned";
}

/** Clients and subcontractors are external; they never see internal-only data. */
export function isExternalRole(role: Role): boolean {
  return role === "client" || role === "subcontractor";
}

export interface ClientVisibilitySettings {
  clientCanSeeContractAmount: boolean;
}

export type ClientProjectView = Omit<Project, "estimatedCostCents" | "contractAmountCents" | "crewTeamId"> & {
  contractAmountCents: number | null;
};

/** Strip internal financials from a project before returning it to a client. */
export function redactProjectForClient(project: Project, settings: ClientVisibilitySettings): ClientProjectView {
  const { estimatedCostCents: _cost, crewTeamId: _crew, contractAmountCents, ...rest } = project;
  return { ...rest, contractAmountCents: settings.clientCanSeeContractAmount ? contractAmountCents : null };
}

export type ClientChangeOrderView = Omit<ChangeOrder, "costCents" | "laborHoursImpact">;

/** Clients see the price of a change order, never its internal cost or labor. */
export function redactChangeOrderForClient(co: ChangeOrder): ClientChangeOrderView {
  const { costCents: _cost, laborHoursImpact: _labor, ...rest } = co;
  return rest;
}

/** Change orders a client is allowed to see at all (drafts stay internal). */
export function changeOrderVisibleToClient(co: Pick<ChangeOrder, "status">): boolean {
  return co.status !== "draft" && co.status !== "submitted";
}
