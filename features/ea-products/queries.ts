import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EaProductListItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  archivedAt: string | null;
  versionCount: number;
  manualCount: number;
};

export async function listEaProducts(orgId: string, opts: { includeArchived?: boolean } = {}) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("ea_products")
    .select("id, name, slug, description, archived_at, ea_versions(count), manuals(count)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (!opts.includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row): EaProductListItem => {
    const versionCount = extractCount(row.ea_versions);
    const manualCount = extractCount(row.manuals);
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: (row.description as string) ?? "",
      archivedAt: (row.archived_at as string | null) ?? null,
      versionCount,
      manualCount,
    };
  });
}

export async function getEaProduct(orgId: string, productId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ea_products")
    .select("id, name, slug, description, archived_at, owner_id, created_at")
    .eq("organization_id", orgId)
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function extractCount(rel: unknown): number {
  if (Array.isArray(rel)) {
    const first = rel[0] as { count?: number } | undefined;
    return first?.count ?? 0;
  }
  if (rel && typeof rel === "object" && "count" in rel) {
    return (rel as { count: number }).count;
  }
  return 0;
}
