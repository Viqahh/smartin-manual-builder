"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { setupListInput } from "@/lib/domain/setups";
import { writeAudit } from "@/features/audit/write";
import { eaVersionCreateSchema } from "./schema";

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

export async function createEaVersion(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, role } = await requireActiveOrg();
    assertCan(role, "ea_version:create");

    const parsed = eaVersionCreateSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    // Second gate: reject duplicate (symbol, timeframe) rows before hitting the DB (AC-P2-9b).
    const setupCheck = setupListInput.safeParse(parsed.data.setups);
    if (!setupCheck.success) {
      return validationFail(
        setupCheck.error.issues.map((i) => ({ path: `setups.${i.path.join(".")}`, message: i.message })),
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_ea_version_with_setups", {
      p_org: orgId,
      p_ea_product_id: parsed.data.eaProductId,
      p_version: parsed.data.version,
      p_platform: parsed.data.platform,
      p_release_date: parsed.data.releaseDate,
      p_requirements: parsed.data.requirements,
      p_support: parsed.data.support,
      p_setups: setupCheck.data.map((s, index) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        presetRef: s.presetRef,
        testedMinimumLot: s.testedMinimumLot,
        notes: s.notes,
        isSupported: s.isSupported,
        position: s.position ?? index,
      })),
      p_copy_params_from: parsed.data.copyParametersFromVersionId,
    });

    if (error) {
      return mapPostgrestError(error, {
        unique: {
          ea_versions_ea_product_id_platform_version_key: {
            path: "version",
            message: "Versi EA untuk platform ini sudah ada.",
          },
          ea_version_setups_ea_version_id_symbol_timeframe_key: {
            path: "setups",
            message: "Ada konfigurasi simbol/timeframe yang duplikat.",
          },
        },
      });
    }

    const newId = data as unknown as string;
    await writeAudit(orgId, userId, "ea_version:create", "ea_version", newId, {
      version: parsed.data.version,
      platform: parsed.data.platform,
      setups: setupCheck.data.length,
    });
    revalidatePath(`/ea-products/${parsed.data.eaProductId}`);
    return ok({ id: newId });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal membuat versi EA.");
  }
}
