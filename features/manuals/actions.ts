"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { setupListInput } from "@/lib/domain/setups";
import { slugify } from "@/lib/slug";
import { writeAudit } from "@/features/audit/write";
import { createManualSchema } from "./schema";

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

const SETUP_UNIQUE_HINT = {
  ea_versions_ea_product_id_platform_version_key: { path: "version", message: "Versi EA untuk platform ini sudah ada." },
  ea_products_organization_id_slug_key: { path: "product.name", message: "Produk dengan nama serupa sudah ada." },
  ea_version_setups_ea_version_id_symbol_timeframe_key: { path: "setups", message: "Ada konfigurasi simbol/timeframe yang duplikat." },
  manual_versions_manual_id_version_key: { path: "manualVersion", message: "Versi manual sudah dipakai." },
};

/**
 * Resolve the ACTIVE versioned manual template to a concrete UUID + version.
 * Normal standard manual creation always passes this concrete id to the RPC —
 * the RPC never receives null (finding: "Template ID must be explicit").
 */
async function resolveActiveTemplate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  orgId: string,
): Promise<{ id: string; version: number } | null> {
  const { data } = await supabase
    .from("manual_templates")
    .select("id, version, organization_id")
    .eq("key", "smartin-ea-manual")
    .eq("is_active", true)
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("organization_id", { ascending: true, nullsFirst: false }) // prefer an org template if one exists
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, version: Number(data.version) } : null;
}

export async function createManual(input: unknown): Promise<ActionResult<{ manualId: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:create");

    const parsed = createManualSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }

    const supabase = await createSupabaseServerClient();
    const template = await resolveActiveTemplate(supabase, orgId);
    if (!template) return fail("INTERNAL", "Template manual aktif tidak ditemukan.");

    if (parsed.data.mode === "existing") {
      const { data, error } = await supabase.rpc("create_manual_with_version", {
        p_org: orgId,
        p_ea_product_id: parsed.data.eaProductId,
        p_ea_version_id: parsed.data.eaVersionId,
        p_manual_version: parsed.data.manualVersion,
        p_template_id: template.id, // explicit — never null
        p_locale: parsed.data.locale,
      });
      if (error) return mapPostgrestError(error, { unique: SETUP_UNIQUE_HINT });
      const row = Array.isArray(data) ? data[0] : data;
      const created = row as { manual_id: string; template_version: number | null };
      const manualId = created.manual_id;
      await writeAudit(orgId, userId, "manual:create", "manual", manualId, {
        mode: "existing",
        templateId: template.id,
        templateVersion: created.template_version,
      });
      revalidatePath("/manuals");
      return ok({ manualId });
    }

    // new-EA path — atomic (product + version + setups + manual + sections)
    assertCan(roles, "ea_product:create");
    const setupCheck = setupListInput.safeParse(parsed.data.version.setups);
    if (!setupCheck.success) {
      return validationFail(
        setupCheck.error.issues.map((i) => ({ path: `version.setups.${i.path.join(".")}`, message: i.message })),
      );
    }
    const slug = slugify(parsed.data.product.name);
    if (!slug) return validationFail([{ path: "product.name", message: "Nama menghasilkan slug kosong." }]);

    const { data, error } = await supabase.rpc("create_product_version_manual", {
      p_org: orgId,
      p_owner: userId,
      p_product_name: parsed.data.product.name,
      p_product_slug: slug,
      p_product_description: parsed.data.product.description ?? "",
      p_version: parsed.data.version.version,
      p_platform: parsed.data.version.platform,
      p_release_date: parsed.data.version.releaseDate,
      p_requirements: parsed.data.version.requirements,
      p_support: parsed.data.version.support,
      p_setups: setupCheck.data.map((s, index) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        presetRef: s.presetRef,
        testedMinimumLot: s.testedMinimumLot,
        notes: s.notes,
        isSupported: s.isSupported,
        position: index,
      })),
      p_manual_version: parsed.data.manualVersion,
      p_template_id: template.id, // explicit — never null
      p_locale: parsed.data.locale,
    });
    if (error) return mapPostgrestError(error, { unique: SETUP_UNIQUE_HINT });
    const row = Array.isArray(data) ? data[0] : data;
    const created = row as { manual_id: string; template_version: number | null };
    const manualId = created.manual_id;
    await writeAudit(orgId, userId, "manual:create", "manual", manualId, {
      mode: "new",
      templateId: template.id,
      templateVersion: created.template_version,
    });
    revalidatePath("/manuals");
    revalidatePath("/ea-products");
    return ok({ manualId });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal membuat manual.");
  }
}

/**
 * Phase 8A.5 — Preview consistency boundary. Called by the client immediately AFTER the editor's
 * save barrier (`flushPending`) confirms persistence and BEFORE navigating to Preview, so the
 * `/preview` (and `/edit`) RSC is rebuilt from current data with no browser hard refresh. Does
 * not disable caching — it just marks the two dependent routes stale. Membership-gated.
 */
export async function revalidateManualRoutes(manualId: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const { roles } = await requireActiveOrg();
    assertCan(roles, "manual:read");
    if (typeof manualId !== "string" || !/^[0-9a-f-]{36}$/i.test(manualId)) {
      return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);
    }
    revalidatePath(`/manuals/${manualId}/edit`);
    revalidatePath(`/manuals/${manualId}/preview`);
    return ok({ ok: true });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menyegarkan tampilan.");
  }
}
