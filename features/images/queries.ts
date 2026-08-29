import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  const out: OrgImage[] = [];
  for (const a of data ?? []) {
    const { data: signed } = await supabase.storage
      .from("manual-images")
      .createSignedUrl(a.storage_key as string, 60 * 30);
    out.push({
      id: a.id as string,
      altText: (a.alt_text as string | null) ?? null,
      caption: (a.caption as string | null) ?? null,
      width: (a.width as number | null) ?? null,
      height: (a.height as number | null) ?? null,
      signedUrl: signed?.signedUrl ?? null,
    });
  }
  return out;
}
