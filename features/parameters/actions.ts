"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/features/audit/write";
import { nextPosition, validateReorder } from "@/lib/domain/positions";
import { listParameterGroups, type ParameterGroupWithParams } from "./queries";
import {
  createGroupSchema,
  createParameterSchema,
  updateParameterSchema,
  updateGroupSchema,
  reorderGroupsSchema,
  groupIdSchema,
  parameterIdSchema,
  reorderParametersSchema,
} from "./schema";

/**
 * Read the parameter groups + parameters for an EA VERSION (GI-11 source of truth). Client-callable
 * so the inline parameter manager in the Manual Builder can re-read after a mutation without a
 * full route refresh. Read-only; still `ea_version:read` gated.
 */
export async function getParameterGroups(
  input: unknown,
): Promise<ActionResult<{ groups: ParameterGroupWithParams[] }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_version:read");
    const parsed = z.object({ eaVersionId: z.uuid() }).safeParse(input);
    if (!parsed.success) return validationFail([{ path: "eaVersionId", message: "ID versi EA tidak valid." }]);
    const groups = await listParameterGroups(orgId, parsed.data.eaVersionId);
    return ok({ groups });
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code, e.message);
    if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
    return fail("INTERNAL", "Gagal memuat parameter.");
  }
}

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

export async function createParameterGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = createGroupSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const supabase = await createSupabaseServerClient();
    let position = parsed.data.position;
    if (position === undefined) {
      const { data: rows } = await supabase
        .from("parameter_groups")
        .select("position")
        .eq("organization_id", orgId)
        .eq("ea_version_id", parsed.data.eaVersionId);
      position = nextPosition((rows ?? []).map((r) => Number(r.position)));
    }
    const { data, error } = await supabase
      .from("parameter_groups")
      .insert({
        organization_id: orgId,
        ea_version_id: parsed.data.eaVersionId,
        name: parsed.data.name,
        position,
      })
      .select("id")
      .single();
    if (error) {
      return mapPostgrestError(error, {
        unique: { parameter_groups_ea_version_id_name_key: { path: "name", message: "Nama grup sudah dipakai." } },
      });
    }
    await writeAudit(orgId, userId, "ea_parameter:manage", "parameter_group", data.id);
    return ok({ id: data.id as string });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal membuat grup parameter.");
  }
}

export async function createParameter(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = createParameterSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const d = parsed.data;
    const supabase = await createSupabaseServerClient();
    let position = d.position;
    if (position === undefined) {
      const { data: rows } = await supabase
        .from("ea_parameters")
        .select("position")
        .eq("organization_id", orgId)
        .eq("parameter_group_id", d.parameterGroupId);
      position = nextPosition((rows ?? []).map((r) => Number(r.position)));
    }
    const { data, error } = await supabase
      .from("ea_parameters")
      .insert({
        organization_id: orgId,
        parameter_group_id: d.parameterGroupId,
        display_name: d.displayName,
        technical_name: d.technicalName,
        param_type: d.paramType,
        default_value: d.defaultValue,
        unit: d.unit,
        min_value: d.minValue,
        max_value: d.maxValue,
        enum_options: d.enumOptions,
        safe_range: d.safeRange,
        description: d.description,
        order_effect: d.orderEffect,
        mutability: d.mutability,
        notes: d.notes,
        required: d.required,
        position,
      })
      .select("id")
      .single();
    if (error) {
      return mapPostgrestError(error, {
        unique: {
          ea_parameters_parameter_group_id_technical_name_key: {
            path: "technicalName",
            message: "Nama teknis sudah dipakai di grup ini.",
          },
        },
      });
    }
    await writeAudit(orgId, userId, "ea_parameter:manage", "ea_parameter", data.id);
    return ok({ id: data.id as string });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal membuat parameter.");
  }
}

export async function updateParameter(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = updateParameterSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { id, ...rest } = parsed.data;
    const patch: Record<string, unknown> = {};
    const map: Record<string, string> = {
      displayName: "display_name",
      technicalName: "technical_name",
      paramType: "param_type",
      defaultValue: "default_value",
      minValue: "min_value",
      maxValue: "max_value",
      enumOptions: "enum_options",
      safeRange: "safe_range",
      orderEffect: "order_effect",
    };
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      patch[map[k] ?? k] = v;
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("ea_parameters")
      .update(patch)
      .eq("organization_id", orgId)
      .eq("id", id);
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "ea_parameter:manage", "ea_parameter", id);
    return ok({ id });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memperbarui parameter.");
  }
}

// ---------------------------------------------------------------------------
// Parameter Group: rename, reorder, delete
// ---------------------------------------------------------------------------
export async function updateParameterGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = updateGroupSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    if (parsed.data.name === undefined) return ok({ id: parsed.data.id });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("parameter_groups")
      .update({ name: parsed.data.name })
      .eq("organization_id", orgId)
      .eq("id", parsed.data.id);
    if (error) {
      return mapPostgrestError(error, {
        unique: { parameter_groups_ea_version_id_name_key: { path: "name", message: "Nama grup sudah dipakai." } },
      });
    }
    await writeAudit(orgId, userId, "ea_parameter:manage", "parameter_group", parsed.data.id, { op: "rename" });
    return ok({ id: parsed.data.id });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memperbarui grup parameter.");
  }
}

export async function deleteParameterGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = groupIdSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "id", message: "ID grup tidak valid." }]);
    const supabase = await createSupabaseServerClient();
    // Refuse if a parameterTable block still references this group (keeps GI-11 references valid).
    const { count } = await supabase
      .from("manual_blocks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .contains("parameter_group_ids", [parsed.data.id]);
    if ((count ?? 0) > 0) {
      return fail("CONFLICT", "Grup masih dipakai oleh tabel parameter di sebuah manual.");
    }
    const { error } = await supabase
      .from("parameter_groups")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", parsed.data.id);
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "ea_parameter:manage", "parameter_group", parsed.data.id, { op: "delete" });
    return ok({ id: parsed.data.id });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menghapus grup parameter.");
  }
}

export async function reorderParameterGroups(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = reorderGroupsSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const supabase = await createSupabaseServerClient();
    const { data: rows } = await supabase
      .from("parameter_groups")
      .select("id")
      .eq("organization_id", orgId)
      .eq("ea_version_id", parsed.data.eaVersionId);
    const check = validateReorder((rows ?? []).map((r) => r.id as string), parsed.data.orderedIds);
    if (!check.ok) return validationFail([{ path: "orderedIds", message: "Daftar urutan tidak cocok." }]);

    const { error } = await supabase.rpc("reorder_parameter_groups", {
      p_ea_version_id: parsed.data.eaVersionId,
      p_ordered_ids: parsed.data.orderedIds,
    });
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "ea_parameter:manage", "ea_version", parsed.data.eaVersionId, { op: "reorder_groups" });
    return ok({ count: parsed.data.orderedIds.length });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengatur ulang grup.");
  }
}

// ---------------------------------------------------------------------------
// EA Parameter: reorder, delete
// ---------------------------------------------------------------------------
export async function deleteParameter(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = parameterIdSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "id", message: "ID parameter tidak valid." }]);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("ea_parameters")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", parsed.data.id);
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "ea_parameter:manage", "ea_parameter", parsed.data.id, { op: "delete" });
    return ok({ id: parsed.data.id });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menghapus parameter.");
  }
}

export async function reorderParameters(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_parameter:manage");
    const parsed = reorderParametersSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const supabase = await createSupabaseServerClient();
    const { data: rows } = await supabase
      .from("ea_parameters")
      .select("id")
      .eq("organization_id", orgId)
      .eq("parameter_group_id", parsed.data.parameterGroupId);
    const check = validateReorder((rows ?? []).map((r) => r.id as string), parsed.data.orderedIds);
    if (!check.ok) return validationFail([{ path: "orderedIds", message: "Daftar urutan tidak cocok." }]);

    const { error } = await supabase.rpc("reorder_ea_parameters", {
      p_group_id: parsed.data.parameterGroupId,
      p_ordered_ids: parsed.data.orderedIds,
    });
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "ea_parameter:manage", "parameter_group", parsed.data.parameterGroupId, { op: "reorder_parameters" });
    return ok({ count: parsed.data.orderedIds.length });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengatur ulang parameter.");
  }
}

