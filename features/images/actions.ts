"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, type ActionResult } from "@/lib/errors";
import { imageDimensions } from "@/lib/domain/image-dimensions";
import { writeAudit } from "@/features/audit/write";

const MAX_BYTES = 10 * 1024 * 1024;
// Accepted formats per docs/DATA_MODEL.md `image_assets` + supabase/config.toml bucket.
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type UploadedImage = { id: string; storageKey: string; width: number; height: number };

/**
 * Private image upload (AC-P2-19).
 *
 * The `image_assets` id and the FINAL storage key are computed up front, so the row is never
 * written with a `pending-…` key. Order of operations, with full cleanup on every failure path:
 *   1. insert image_assets (final storage_key, width/height)
 *   2. upload the object     — on failure: delete the row, return error
 *   3. (no step 3 — nothing to reconcile)
 * No success result can leave `storage_key = pending-…`, an orphan object, or an orphan row.
 */
export async function uploadManualImage(formData: FormData): Promise<ActionResult<UploadedImage>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "image:upload");

    const file = formData.get("file");
    const altText = (formData.get("altText") as string | null)?.trim() || null;
    const caption = (formData.get("caption") as string | null)?.trim() || null;

    if (!(file instanceof File)) return fail("VALIDATION", "Berkas tidak ditemukan.");
    if (!ALLOWED.has(file.type)) return fail("VALIDATION", "Format gambar harus PNG, JPG, WebP, atau GIF.");
    if (file.size <= 0 || file.size > MAX_BYTES) return fail("VALIDATION", "Ukuran gambar maksimal 10 MB.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const dims = imageDimensions(bytes, file.type);
    if (!dims) return fail("VALIDATION", "Berkas gambar tidak dapat dibaca (header tidak valid).");

    const supabase = await createSupabaseServerClient();
    const assetId = crypto.randomUUID();
    const storageKey = `${orgId}/${assetId}.${EXT[file.type]}`;

    const { error: insErr } = await supabase.from("image_assets").insert({
      id: assetId,
      organization_id: orgId,
      owner_id: userId,
      storage_key: storageKey, // FINAL key — no pending state
      mime_type: file.type,
      byte_size: file.size,
      width: dims.width,
      height: dims.height,
      caption,
      alt_text: altText,
      scan_status: "pending",
    });
    if (insErr) return fail("UPLOAD", "Gagal mencatat gambar.");

    const { error: upErr } = await supabase.storage
      .from("manual-images")
      .upload(storageKey, file, { contentType: file.type, upsert: false });
    if (upErr) {
      // roll back the metadata row so nothing points at a non-existent object
      await supabase.from("image_assets").delete().eq("id", assetId);
      return fail("UPLOAD", "Gagal mengunggah gambar.");
    }

    await writeAudit(orgId, userId, "image:upload", "image_asset", assetId, {
      mime: file.type,
      width: dims.width,
      height: dims.height,
    });
    return ok({ id: assetId, storageKey, width: dims.width, height: dims.height });
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code, e.message);
    if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
    return fail("UPLOAD", "Gagal mengunggah gambar.");
  }
}
