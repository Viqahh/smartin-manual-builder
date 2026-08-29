import { describe, it, expect } from "vitest";
import {
  can,
  canAny,
  assertCan,
  AuthorizationError,
  ROLE_ACTIONS,
  ORG_ROLES,
} from "@/lib/permissions/actions";

describe("permission / action map (PRD-SEC-003, AC-P2-22)", () => {
  it("DEVELOPER can create EA products and manuals but cannot review or publish", () => {
    expect(can("DEVELOPER", "ea_product:create")).toBe(true);
    expect(can("DEVELOPER", "manual:create")).toBe(true);
    expect(can("DEVELOPER", "ea_setup:manage")).toBe(true);
    expect(can("DEVELOPER", "ea_parameter:manage")).toBe(true);
    expect(can("DEVELOPER", "review:technical")).toBe(false);
    expect(can("DEVELOPER", "review:compliance")).toBe(false);
    expect(can("DEVELOPER", "manual:publish")).toBe(false);
    expect(can("DEVELOPER", "member:manage")).toBe(false);
  });

  it("TECHNICAL_REVIEWER cannot edit manual content or make compliance decisions", () => {
    expect(can("TECHNICAL_REVIEWER", "manual:update")).toBe(false);
    expect(can("TECHNICAL_REVIEWER", "review:technical")).toBe(true);
    expect(can("TECHNICAL_REVIEWER", "review:compliance")).toBe(false);
    expect(can("TECHNICAL_REVIEWER", "manual:read")).toBe(true);
  });

  it("COMPLIANCE_REVIEWER can only do compliance review + reads", () => {
    expect(can("COMPLIANCE_REVIEWER", "review:compliance")).toBe(true);
    expect(can("COMPLIANCE_REVIEWER", "review:technical")).toBe(false);
    expect(can("COMPLIANCE_REVIEWER", "manual:update")).toBe(false);
  });

  it("ADMIN holds every action", () => {
    for (const role of ORG_ROLES) {
      for (const action of ROLE_ACTIONS[role]) {
        expect(can("ADMIN", action)).toBe(true);
      }
    }
    expect(can("ADMIN", "member:manage")).toBe(true);
    expect(can("ADMIN", "template:manage")).toBe(true);
    expect(can("ADMIN", "manual:publish")).toBe(true);
  });

  it("no role resolves to no permission", () => {
    expect(can(null, "manual:read")).toBe(false);
    expect(can(undefined, "manual:read")).toBe(false);
  });

  it("canAny grants when any held role permits (multi-role user — PRD §6)", () => {
    // A user holding both TECHNICAL_REVIEWER and DEVELOPER in one org may author.
    expect(canAny(["TECHNICAL_REVIEWER", "DEVELOPER"], "manual:update")).toBe(true);
    expect(canAny(["TECHNICAL_REVIEWER", "DEVELOPER"], "ea_parameter:manage")).toBe(true);
    // Reviewer-only combination stays read-only for content.
    expect(canAny(["TECHNICAL_REVIEWER", "COMPLIANCE_REVIEWER"], "manual:update")).toBe(false);
    expect(canAny(["TECHNICAL_REVIEWER", "COMPLIANCE_REVIEWER"], "ea_setup:manage")).toBe(false);
    // ...but each reviewer role still keeps its own review action.
    expect(canAny(["TECHNICAL_REVIEWER", "COMPLIANCE_REVIEWER"], "review:technical")).toBe(true);
    expect(canAny(["TECHNICAL_REVIEWER", "COMPLIANCE_REVIEWER"], "review:compliance")).toBe(true);
  });

  it("a pure DEVELOPER cannot review — the exact expression the Phase 5 N/A-override gate uses (AC-P5-9)", () => {
    // features/validation/actions.ts canReview(): canAny(roles,"review:technical") || canAny(roles,"review:compliance")
    const canReview = (roles: string[]) =>
      canAny(roles as never, "review:technical") || canAny(roles as never, "review:compliance");
    expect(canAny(["DEVELOPER"], "review:technical")).toBe(false);
    expect(canAny(["DEVELOPER"], "review:compliance")).toBe(false);
    expect(canReview(["DEVELOPER"])).toBe(false);
    // a reviewer role flips it on; the multi-role developer+reviewer fixture may override
    expect(canReview(["DEVELOPER", "TECHNICAL_REVIEWER"])).toBe(true);
    expect(canReview(["COMPLIANCE_REVIEWER"])).toBe(true);
  });

  it("only ADMIN in the role set grants admin-only actions", () => {
    expect(canAny(["DEVELOPER"], "member:manage")).toBe(false);
    expect(canAny(["DEVELOPER", "TECHNICAL_REVIEWER"], "template:manage")).toBe(false);
    expect(canAny(["DEVELOPER", "ADMIN"], "member:manage")).toBe(true);
  });

  it("assertCan throws a typed FORBIDDEN error when denied", () => {
    expect(() => assertCan("DEVELOPER", "manual:publish")).toThrowError(AuthorizationError);
    try {
      assertCan(["COMPLIANCE_REVIEWER"], "manual:update");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorizationError);
      expect((e as AuthorizationError).code).toBe("FORBIDDEN");
      expect((e as AuthorizationError).action).toBe("manual:update");
    }
    expect(() => assertCan("ADMIN", "manual:publish")).not.toThrow();
  });
});
