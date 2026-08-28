import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ManualStatusDb } from "@/lib/supabase/database.types";

export type ManualListRow = {
  manualId: string;
  eaName: string;
  platform: "MT4" | "MT5";
  eaVersion: string;
  manualVersion: string;
  status: ManualStatusDb;
  updatedAt: string;
  sectionsTotal: number;
};

/**
 * Manuals for the org, shaped for /manuals and the dashboard. One row per manual, showing
 * its latest manual version. Real data only — no localStorage (AC-P2-24).
 */
export async function listManuals(orgId: string): Promise<ManualListRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("manual_versions")
    .select(
      "id, version, status, updated_at, manual_id, " +
        "manuals!inner(id, ea_product_id, ea_products!inner(name)), " +
        "ea_versions!inner(version, platform), " +
        "manual_sections(count)",
    )
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  type RawRow = {
    id: string;
    version: string;
    status: ManualStatusDb;
    updated_at: string;
    manual_id: string;
    manuals: { id: string; ea_product_id: string; ea_products: { name: string } | { name: string }[] };
    ea_versions: { version: string; platform: string } | { version: string; platform: string }[];
    manual_sections: { count: number }[];
  };

  return ((data ?? []) as unknown as RawRow[]).map((r): ManualListRow => {
    const manualRel = r.manuals;
    const product = Array.isArray(manualRel.ea_products) ? manualRel.ea_products[0] : manualRel.ea_products;
    const eaVer = Array.isArray(r.ea_versions) ? r.ea_versions[0] : r.ea_versions;
    const secCount = Array.isArray(r.manual_sections) ? r.manual_sections[0]?.count ?? 0 : 0;
    return {
      manualId: manualRel.id,
      eaName: product?.name ?? "EA",
      platform: (eaVer?.platform as "MT4" | "MT5") ?? "MT5",
      eaVersion: eaVer?.version ?? "",
      manualVersion: r.version as string,
      status: r.status as ManualStatusDb,
      updatedAt: r.updated_at as string,
      sectionsTotal: secCount,
    };
  });
}

export type DashboardMetrics = {
  eaProducts: number;
  manualsActive: number;
  awaitingReview: number;
  published: number;
};

export async function dashboardMetrics(orgId: string): Promise<DashboardMetrics> {
  const supabase = await createSupabaseServerClient();
  const [{ count: eaProducts }, { data: versions }] = await Promise.all([
    supabase.from("ea_products").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("archived_at", null),
    supabase.from("manual_versions").select("status").eq("organization_id", orgId),
  ]);
  const rows = (versions ?? []) as { status: ManualStatusDb }[];
  return {
    eaProducts: eaProducts ?? 0,
    manualsActive: rows.filter((r) => ["DRAFT", "CHANGES_REQUESTED"].includes(r.status)).length,
    awaitingReview: rows.filter((r) => ["TECHNICAL_REVIEW", "COMPLIANCE_REVIEW"].includes(r.status)).length,
    published: rows.filter((r) => r.status === "PUBLISHED").length,
  };
}
