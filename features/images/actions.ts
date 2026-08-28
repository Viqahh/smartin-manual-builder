"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, type ActionResult } from "@/lib/errors";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type UploadedImage = { id: string; storageKey: string };

/**
 * Private image upload (AC-P2-19). Object path: `<organization_id>/<image_asset_id>.<ext>`
 * in the private `manual-images` bucket. Access is later granted only via short-lived signed
 * URLs; the object is never public.
 */
export async function uploadManualImage(formData: FormData): Promise<ActionResult<UploadedImage>> {
  try {
    const { orgId, userId, role } = await requireActiveOrg();
    assertCan(role, "image:upload");

    const file = formData.get("file");
    const altText = (formData.get("altText") as string | null)?.trim() || null;
    const caption = (formData.get("caption") as string | null)?.trim() || null;

    if (!(file instanceof File)) return fail("VALIDATION", "Berkas tidak ditemukan.");
    if (!ALLOWED.has(file.type)) return fail("VALIDATION", "Format gambar harus PNG, JPG, WebP, atau GIF.");
    if (file.size <= 0 || file.size > MAX_BYTES) return fail("VALIDATION", "Ukuran gambar maksimal 10 MB.");

    const supabase = await createSupabaseServerClient();

    const { data: inserted, error: insErr } = await supabase
      .from("image_assets")
      .insert({
        organization_id: orgId,
        owner_id: userId,
        storage_key: "pending",
        mime_type: file.type,
        byte_size: file.size,
        caption,
        alt_text: altText,
        scan_status: "pending",
      })
      .select("id")
      .single();
    if (insErr || !inserted) return fail("UPLOAD", "Gagal mencatat gambar.");

    const assetId = inserted.id as string;
    const storageKey = `${orgId}/${assetId}.${EXT[file.type]}`;

    const { error: upErr } = await supabase.storage
      .from("manual-images")
      .upload(storageKey, file, { contentType: file.type, upsert: false });
    if (upErr) {
      await supabase.from("image_assets").delete().eq("id", assetId);
      return fail("UPLOAD", "Gagal mengunggah gambar.");
    }

    await supabase.from("image_assets").update({ storage_key: storageKey }).eq("id", assetId);
    return ok({ id: assetId, storageKey });
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code, e.message);
    if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
    return fail("UPLOAD", "Gagal mengunggah gambar.");
  }
}
