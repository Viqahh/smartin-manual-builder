import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EaVersionSetupRow } from "@/lib/supabase/database.types";

export type EaVersionListItem = {
  id: string;
  version: string;
  platform: "MT4" | "MT5";
  releaseDate: string | null;
  setupCount: number;
  manualVersionCount: number;
};

export async function listEaVersions(orgId: string, productId: string): Promise<EaVersionListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ea_versions")
    .select("id, version, platform, release_date, ea_version_setups(count), manual_versions(count)")
    .eq("organization_id", orgId)
    .eq("ea_product_id", productId)
    .order("release_date", { ascending: false })
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    version: row.version as string,
    platform: row.platform as "MT4" | "MT5",
    releaseDate: (row.release_date as string | null) ?? null,
    setupCount: countOf(row.ea_version_setups),
    manualVersionCount: countOf(row.manual_versions),
  }));
}

export async function getEaVersionWithSetups(orgId: string, versionId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: version, error } = await supabase
    .from("ea_versions")
    .select("id, ea_product_id, version, platform, release_date, requirements, support")
    .eq("organization_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  if (!version) return null;

  const { data: setups, error: setupErr } = await supabase
    .from("ea_version_setups")
    .select("*")
    .eq("ea_version_id", versionId)
    .order("position", { ascending: true });
  if (setupErr) throw setupErr;

  return { version, setups: (setups ?? []) as EaVersionSetupRow[] };
}

/** For the wizard's "existing EA" path: products + their versions, org-scoped. */
export async function listProductsWithVersions(orgId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ea_products")
    .select("id, name, ea_versions(id, version, platform, release_date)")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    versions: (
      (p.ea_versions as { id: string; version: string; platform: string; release_date: string | null }[]) ?? []
    ).map((v) => ({ id: v.id, version: v.version, platform: v.platform as "MT4" | "MT5" })),
  }));
}

function countOf(rel: unknown): number {
  if (Array.isArray(rel)) return (rel[0] as { count?: number } | undefined)?.count ?? 0;
  if (rel && typeof rel === "object" && "count" in rel) return (rel as { count: number }).count;
  return 0;
}
