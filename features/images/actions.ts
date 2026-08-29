"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
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

/** A fresh 30-minute signed URL for one org image (editor picker after an upload). */
export async function signImageUrl(id: unknown): Promise<ActionResult<{ id: string; url: string | null }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:read");
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success) return validationFail([{ path: "id", message: "ID gambar tidak valid." }]);
    const supabase = await createSupabaseServerClient();
    const { data: asset } = await supabase
      .from("image_assets")
      .select("storage_key")
      .eq("organization_id", orgId)
      .eq("id", parsed.data)
      .maybeSingle();
    if (!asset) return fail("NOT_FOUND", "Gambar tidak ditemukan.");
    const { data: signed } = await supabase.storage
      .from("manual-images")
      .createSignedUrl(asset.storage_key as string, 60 * 30);
    return ok({ id: parsed.data, url: signed?.signedUrl ?? null });
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code, e.message);
    if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
    return fail("INTERNAL", "Gagal menandatangani URL gambar.");
  }
}

const updateImageAssetSchema = z.object({
  id: z.uuid(),
  altText: z.string().trim().max(300).nullable().optional(),
  caption: z.string().trim().max(500).nullable().optional(),
});

/**
 * Edit an image asset's caption / alt text (AC-P3-9). Author-only (`image:upload`) and
 * org-scoped by RLS. Alt text lives on the asset, not the block payload, so every image block
 * referencing the asset stays consistent.
 */
export async function updateImageAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "image:upload");
    const parsed = updateImageAssetSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.altText !== undefined) patch.alt_text = parsed.data.altText || null;
    if (parsed.data.caption !== undefined) patch.caption = parsed.data.caption || null;
    if (Object.keys(patch).length === 0) return ok({ id: parsed.data.id });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("image_assets")
      .update(patch)
      .eq("organization_id", orgId)
      .eq("id", parsed.data.id)
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "42501" || error.code === "PGRST301") return fail("FORBIDDEN", "Akses ditolak.");
      return fail("INTERNAL", "Gagal memperbarui gambar.");
    }
    if (!data) return fail("NOT_FOUND", "Gambar tidak ditemukan.");
    await writeAudit(orgId, userId, "image:upload", "image_asset", parsed.data.id, { op: "update_meta" });
    return ok({ id: parsed.data.id });
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code, e.message);
    if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
    return fail("INTERNAL", "Gagal memperbarui gambar.");
  }
}
