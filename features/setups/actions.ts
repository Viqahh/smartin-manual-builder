"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { setupListInput } from "@/lib/domain/setups";
import { writeAudit } from "@/features/audit/write";
import { z } from "zod";

const replaceSchema = z.object({
  eaVersionId: z.uuid(),
  setups: setupListInput,
});

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

/**
 * Replace the full Supported Configuration list for an EA version (AC-P2-9b).
 * Explicit rows only — the payload IS the truth; nothing is inferred (GI-10).
 */
export async function replaceSupportedSetups(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const { orgId, userId, role } = await requireActiveOrg();
    assertCan(role, "ea_setup:manage");

    const parsed = replaceSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }

    const supabase = await createSupabaseServerClient();

    // Ownership check: the EA version must be in the caller's org (RLS also enforces this).
    const { data: version, error: verErr } = await supabase
      .from("ea_versions")
      .select("id, ea_product_id")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.eaVersionId)
      .maybeSingle();
    if (verErr) return mapPostgrestError(verErr);
    if (!version) return fail("NOT_FOUND", "Versi EA tidak ditemukan.");

    const rows = parsed.data.setups.map((s, index) => ({
      organization_id: orgId,
      ea_version_id: parsed.data.eaVersionId,
      symbol: s.symbol,
      timeframe: s.timeframe,
      preset_ref: s.presetRef,
      tested_minimum_lot: s.testedMinimumLot,
      notes: s.notes,
      is_supported: s.isSupported,
      position: index,
    }));

    const { error: delErr } = await supabase
      .from("ea_version_setups")
      .delete()
      .eq("ea_version_id", parsed.data.eaVersionId);
    if (delErr) return mapPostgrestError(delErr);

    const { error: insErr } = await supabase.from("ea_version_setups").insert(rows);
    if (insErr) {
      return mapPostgrestError(insErr, {
        unique: {
          ea_version_setups_ea_version_id_symbol_timeframe_key: {
            path: "setups",
            message: "Ada konfigurasi simbol/timeframe yang duplikat.",
          },
        },
      });
    }

    await writeAudit(orgId, userId, "ea_setup:manage", "ea_version", parsed.data.eaVersionId, { count: rows.length });
    revalidatePath(`/ea-products/${version.ea_product_id}`);
    return ok({ count: rows.length });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menyimpan konfigurasi.");
  }
}
