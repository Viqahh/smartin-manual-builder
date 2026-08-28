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
 * Replace the full Supported Configuration list for an EA version (AC-P2-9b, spec §5).
 * Explicit rows only — the payload IS the truth; nothing is inferred (GI-10).
 *
 * ATOMIC: delegates to the `replace_ea_version_setups` RPC, whose DELETE + re-INSERT run in
 * ONE transaction. If the insert fails (e.g. a DB-level duplicate), the whole call rolls back
 * and the previous configuration list is left intact — it can never end up with zero rows.
 */
export async function replaceSupportedSetups(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_setup:manage");

    const parsed = replaceSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }

    const supabase = await createSupabaseServerClient();

    const { data: version, error: verErr } = await supabase
      .from("ea_versions")
      .select("id, ea_product_id")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.eaVersionId)
      .maybeSingle();
    if (verErr) return mapPostgrestError(verErr);
    if (!version) return fail("NOT_FOUND", "Versi EA tidak ditemukan.");

    const { data, error } = await supabase.rpc("replace_ea_version_setups", {
      p_org: orgId,
      p_ea_version_id: parsed.data.eaVersionId,
      p_setups: parsed.data.setups.map((s, index) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        presetRef: s.presetRef,
        testedMinimumLot: s.testedMinimumLot,
        notes: s.notes,
        isSupported: s.isSupported,
        position: index,
      })),
    });
    if (error) {
      return mapPostgrestError(error, {
        unique: {
          ea_version_setups_ea_version_id_symbol_timeframe_key: {
            path: "setups",
            message: "Ada konfigurasi simbol/timeframe yang duplikat.",
          },
        },
      });
    }

    const count = Number(data ?? parsed.data.setups.length);
    await writeAudit(orgId, userId, "ea_setup:manage", "ea_version", parsed.data.eaVersionId, { count });
    revalidatePath(`/ea-products/${version.ea_product_id}`);
    return ok({ count });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menyimpan konfigurasi.");
  }
}
