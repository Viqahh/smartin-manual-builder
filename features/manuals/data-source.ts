import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ManualDataSource, ManualViewModel } from "@/lib/manual/view-model";
import type { BlockType } from "@/lib/domain/blocks";
import type {
  EaParamTypeDb,
  EaParamMutabilityDb,
  MtTimeframeDb,
  ManualStatusDb,
  SectionCompletionStateDb,
} from "@/lib/supabase/database.types";

/**
 * The one server-side assembler for the Manual View Model (spec §18). It loads the manual's
 * LATEST version by `manualId` and every related fact by explicit id — it never falls back to
 * "a" manual, so it cannot leak VMax into Polaris (AC-P2-12). RLS additionally guarantees the
 * caller's org.
 */
export class SupabaseManualDataSource implements ManualDataSource {
  constructor(private orgId: string) {}

  async loadManualVersionByManualId(manualId: string): Promise<ManualViewModel | null> {
    const supabase = await createSupabaseServerClient();

    const { data: manual, error: manualErr } = await supabase
      .from("manuals")
      .select("id, locale, ea_product_id, organization_id")
      .eq("organization_id", this.orgId)
      .eq("id", manualId)
      .maybeSingle();
    if (manualErr) throw manualErr;
    if (!manual) return null;

    const { data: version, error: verErr } = await supabase
      .from("manual_versions")
      .select("id, version, status, row_version, updated_at, ea_version_id")
      .eq("organization_id", this.orgId)
      .eq("manual_id", manualId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verErr) throw verErr;
    if (!version) return null;

    const [{ data: product }, { data: eaVersion }, { data: org }] = await Promise.all([
      supabase.from("ea_products").select("id, name, slug, description, owner_id").eq("id", manual.ea_product_id).single(),
      supabase
        .from("ea_versions")
        .select("id, version, platform, release_date, requirements, support")
        .eq("id", version.ea_version_id)
        .single(),
      supabase.from("organizations").select("id, name").eq("id", this.orgId).single(),
    ]);

    const [{ data: setups }, { data: sections }, { data: groups }] = await Promise.all([
      supabase.from("ea_version_setups").select("*").eq("ea_version_id", version.ea_version_id).order("position"),
      supabase
        .from("manual_sections")
        .select("*, manual_blocks(*)")
        .eq("manual_version_id", version.id)
        .order("position"),
      supabase
        .from("parameter_groups")
        .select("*, ea_parameters(*)")
        .eq("ea_version_id", version.ea_version_id)
        .order("position"),
    ]);

    let developerName: string | null = null;
    if (product?.owner_id) {
      const { data: owner } = await supabase.from("profiles").select("display_name").eq("id", product.owner_id).maybeSingle();
      developerName = owner?.display_name ?? null;
    }

    const vm: ManualViewModel = {
      manual: { id: manual.id as string, locale: (manual.locale as string) ?? "id" },
      manualVersion: {
        id: version.id as string,
        version: version.version as string,
        status: version.status as ManualStatusDb,
        rowVersion: Number(version.row_version ?? 1),
        updatedAt: version.updated_at as string,
      },
      eaProduct: {
        id: product?.id as string,
        name: (product?.name as string) ?? "EA",
        slug: (product?.slug as string) ?? "",
        description: (product?.description as string) ?? "",
      },
      eaVersion: {
        id: eaVersion?.id as string,
        version: (eaVersion?.version as string) ?? "",
        platform: (eaVersion?.platform as "MT4" | "MT5") ?? "MT5",
        releaseDate: (eaVersion?.release_date as string | null) ?? null,
        requirements: (eaVersion?.requirements as Record<string, unknown>) ?? {},
        support: (eaVersion?.support as Record<string, unknown>) ?? {},
      },
      organization: { id: this.orgId, name: (org?.name as string) ?? "Organisasi" },
      developer: developerName ? { name: developerName } : null,
      supportedSetups: (setups ?? []).map((s) => ({
        id: s.id as string,
        symbol: s.symbol as string,
        timeframe: s.timeframe as MtTimeframeDb,
        presetRef: (s.preset_ref as string | null) ?? null,
        testedMinimumLot: s.tested_minimum_lot === null ? null : Number(s.tested_minimum_lot),
        notes: (s.notes as string | null) ?? null,
        isSupported: Boolean(s.is_supported),
        position: Number(s.position ?? 0),
      })),
      sections: (sections ?? []).map((sec) => {
        const blocks = ((sec.manual_blocks as Record<string, unknown>[]) ?? [])
          .filter((b) => b.deleted_at == null)
          .map((b) => ({
            id: b.id as string,
            type: b.block_type as BlockType,
            payload: (b.payload as Record<string, unknown>) ?? {},
            position: Number(b.position ?? 0),
            imageAssetId: (b.image_asset_id as string | null) ?? null,
            parameterGroupIds: (b.parameter_group_ids as string[]) ?? [],
            rowVersion: Number(b.row_version ?? 1),
          }));
        return {
          id: sec.id as string,
          key: sec.section_key as string,
          title: sec.title as string,
          required: Boolean(sec.required),
          isCustom: Boolean(sec.is_custom),
          position: Number(sec.position ?? 0),
          completionState: sec.completion_state as SectionCompletionStateDb,
          rowVersion: Number(sec.row_version ?? 1),
          blocks,
        };
      }),
      parameterGroups: (groups ?? []).map((g) => ({
        id: g.id as string,
        name: g.name as string,
        position: Number(g.position ?? 0),
        parameters: ((g.ea_parameters as Record<string, unknown>[]) ?? []).map((p) => ({
          id: p.id as string,
          displayName: p.display_name as string,
          technicalName: p.technical_name as string,
          paramType: p.param_type as EaParamTypeDb,
          defaultValue: (p.default_value as string | null) ?? null,
          unit: (p.unit as string | null) ?? null,
          safeRange: (p.safe_range as string | null) ?? null,
          description: (p.description as string | null) ?? null,
          orderEffect: (p.order_effect as string | null) ?? null,
          mutability: p.mutability as EaParamMutabilityDb,
          required: Boolean(p.required),
          position: Number(p.position ?? 0),
        })),
      })),
      images: {},
    };

    // Sign URLs for images referenced by blocks (private bucket).
    const assetIds = Array.from(
      new Set(vm.sections.flatMap((s) => s.blocks.map((b) => b.imageAssetId).filter((x): x is string => Boolean(x)))),
    );
    if (assetIds.length) {
      const { data: assets } = await supabase
        .from("image_assets")
        .select("id, storage_key, alt_text, caption")
        .in("id", assetIds);
      for (const a of assets ?? []) {
        const { data: signed } = await supabase.storage
          .from("manual-images")
          .createSignedUrl(a.storage_key as string, 60 * 30);
        vm.images[a.id as string] = {
          id: a.id as string,
          altText: (a.alt_text as string | null) ?? null,
          caption: (a.caption as string | null) ?? null,
          signedUrl: signed?.signedUrl ?? null,
        };
      }
    }

    return vm;
  }
}
