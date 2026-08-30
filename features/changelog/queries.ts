import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SourceEaVersionOption = { id: string; label: string };

/**
 * EA versions in the SAME EA product lineage — the only valid `source_ea_version_id` values for a
 * changelog entry (mirrors `app.assert_changelog_source`). RLS already scopes to the caller's org.
 */
export async function listSourceEaVersions(
  orgId: string,
  eaProductId: string,
): Promise<SourceEaVersionOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ea_versions")
    .select("id, version, platform")
    .eq("organization_id", orgId)
    .eq("ea_product_id", eaProductId)
    .order("release_date", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((v) => ({
    id: v.id as string,
    label: `v${v.version as string} (${v.platform as string})`,
  }));
}
