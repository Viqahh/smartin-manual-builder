/**
 * Action-based authorization (docs/ARCHITECTURE.md "Authorization model", PRD-SEC-003, AC-P2-22).
 *
 * The server is the security boundary. The client may hide/disable controls for UX, but every
 * mutation calls `assertCan(role, action)` (or checks `can(...)`) before touching data.
 * Roles are organisation-scoped (from `memberships.role`), never a global user attribute.
 */

export const ORG_ROLES = ["DEVELOPER", "TECHNICAL_REVIEWER", "COMPLIANCE_REVIEWER", "ADMIN"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ACTIONS = [
  // EA build facts
  "ea_product:create",
  "ea_product:update",
  "ea_product:archive",
  "ea_product:read",
  "ea_version:create",
  "ea_version:update",
  "ea_version:read",
  "ea_setup:manage",
  "ea_parameter:manage",
  // Manuals
  "manual:create",
  "manual:read",
  "manual:update",
  "manual:submit_review",
  "image:upload",
  // Reviews (Phase 6 — listed so the map is complete; not wired in Phase 2)
  "review:technical",
  "review:compliance",
  "manual:publish",
  // Workspace administration
  "template:manage",
  "member:manage",
  "member:read",
] as const;
export type Action = (typeof ACTIONS)[number];

const DEVELOPER_ACTIONS: readonly Action[] = [
  "ea_product:create",
  "ea_product:update",
  "ea_product:archive",
  "ea_product:read",
  "ea_version:create",
  "ea_version:update",
  "ea_version:read",
  "ea_setup:manage",
  "ea_parameter:manage",
  "manual:create",
  "manual:read",
  "manual:update",
  "manual:submit_review",
  "image:upload",
  "member:read",
];

const TECHNICAL_REVIEWER_ACTIONS: readonly Action[] = [
  "ea_product:read",
  "ea_version:read",
  "manual:read",
  "review:technical",
  "member:read",
];

const COMPLIANCE_REVIEWER_ACTIONS: readonly Action[] = [
  "ea_product:read",
  "ea_version:read",
  "manual:read",
  "review:compliance",
  "member:read",
];

const ADMIN_ACTIONS: readonly Action[] = [
  ...ACTIONS,
];

export const ROLE_ACTIONS: Record<OrgRole, readonly Action[]> = {
  DEVELOPER: DEVELOPER_ACTIONS,
  TECHNICAL_REVIEWER: TECHNICAL_REVIEWER_ACTIONS,
  COMPLIANCE_REVIEWER: COMPLIANCE_REVIEWER_ACTIONS,
  ADMIN: ADMIN_ACTIONS,
};

export function can(role: OrgRole | null | undefined, action: Action): boolean {
  if (!role) return false;
  return ROLE_ACTIONS[role].includes(action);
}

/** Actor may hold several roles in one org; permitted if ANY role grants the action. */
export function canAny(roles: readonly OrgRole[], action: Action): boolean {
  return roles.some((r) => can(r, action));
}

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN" as const;
  readonly action: Action;
  constructor(action: Action) {
    super(`Aksi tidak diizinkan untuk peran ini: ${action}`);
    this.name = "AuthorizationError";
    this.action = action;
  }
}

export function assertCan(roles: readonly OrgRole[] | OrgRole | null | undefined, action: Action): void {
  const list = roles == null ? [] : Array.isArray(roles) ? roles : [roles];
  if (!canAny(list, action)) throw new AuthorizationError(action);
}
