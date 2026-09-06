import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signManualImageUrls } from "@/lib/images/sign-urls";

export type OrgImage = {
  id: string;
  altText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  signedUrl: string | null;
};

/**
 * Recent images for the current org, with short-lived signed URLs for the editor's asset
 * picker (AC-P3-9). Private bucket only — no public URL is ever produced.
 */
export async function listOrgImages(orgId: string, limit = 60): Promise<OrgImage[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("image_assets")
    .select("id, storage_key, alt_text, caption, width, height")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Phase 8B-8 — one batched sign request for the whole picker list, not one round-trip per image.
  const urlByKey = await signManualImageUrls(
    supabase.storage,
    rows.map((a) => a.storage_key as string),
  );

  return rows.map((a) => ({
    id: a.id as string,
    altText: (a.alt_text as string | null) ?? null,
    caption: (a.caption as string | null) ?? null,
    width: (a.width as number | null) ?? null,
    height: (a.height as number | null) ?? null,
    signedUrl: urlByKey.get(a.storage_key as string) ?? null,
  }));
}
