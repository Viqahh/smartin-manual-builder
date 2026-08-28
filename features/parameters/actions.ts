"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/features/audit/write";
import { createGroupSchema, createParameterSchema, updateParameterSchema } from "./schema";

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

export async function createParameterGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, role } = await requireActiveOrg();
    assertCan(role, "ea_parameter:manage");
    const parsed = createGroupSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("parameter_groups")
      .insert({
        organization_id: orgId,
        ea_version_id: parsed.data.eaVersionId,
        name: parsed.data.name,
        position: parsed.data.position,
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
    const { orgId, userId, role } = await requireActiveOrg();
    assertCan(role, "ea_parameter:manage");
    const parsed = createParameterSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const d = parsed.data;
    const supabase = await createSupabaseServerClient();
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
        position: d.position,
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
    const { orgId, userId, role } = await requireActiveOrg();
    assertCan(role, "ea_parameter:manage");
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
