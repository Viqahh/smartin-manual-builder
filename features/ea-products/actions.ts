"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import { eaProductCreateSchema, eaProductUpdateSchema } from "./schema";
import { writeAudit } from "@/features/audit/write";

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

export async function createEaProduct(input: unknown): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_product:create");

    const parsed = eaProductCreateSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const slug = slugify(parsed.data.name);
    if (!slug) return validationFail([{ path: "name", message: "Nama menghasilkan slug kosong." }]);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("ea_products")
      .insert({
        organization_id: orgId,
        owner_id: userId,
        name: parsed.data.name,
        slug,
        description: parsed.data.description ?? "",
      })
      .select("id, slug")
      .single();

    if (error) {
      return mapPostgrestError(error, {
        unique: { ea_products_organization_id_slug_key: { path: "name", message: "Produk dengan nama serupa sudah ada." } },
      });
    }

    await writeAudit(orgId, userId, "ea_product:create", "ea_product", data.id);
    revalidatePath("/ea-products");
    return ok({ id: data.id as string, slug: data.slug as string });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal membuat produk EA.");
  }
}

export async function updateEaProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_product:update");

    const parsed = eaProductUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      patch.name = parsed.data.name;
      patch.slug = slugify(parsed.data.name);
    }
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("ea_products")
      .update(patch)
      .eq("organization_id", orgId)
      .eq("id", parsed.data.id);
    if (error) return mapPostgrestError(error);

    await writeAudit(orgId, userId, "ea_product:update", "ea_product", parsed.data.id);
    revalidatePath("/ea-products");
    revalidatePath(`/ea-products/${parsed.data.id}`);
    return ok({ id: parsed.data.id });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memperbarui produk EA.");
  }
}

export async function archiveEaProduct(productId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "ea_product:archive");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("ea_products")
      .update({ archived_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", productId)
      .is("archived_at", null);
    if (error) return mapPostgrestError(error);

    await writeAudit(orgId, userId, "ea_product:archive", "ea_product", productId);
    revalidatePath("/ea-products");
    return ok({ id: productId });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengarsipkan produk EA.");
  }
}
