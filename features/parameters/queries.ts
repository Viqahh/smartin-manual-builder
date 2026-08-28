import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EaParameterRow, ParameterGroupRow } from "@/lib/supabase/database.types";

export type ParameterGroupWithParams = ParameterGroupRow & { parameters: EaParameterRow[] };

/** Parameter definitions for an EA VERSION (GI-11). Shared by every manual version that links it. */
export async function listParameterGroups(
  orgId: string,
  eaVersionId: string,
): Promise<ParameterGroupWithParams[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("parameter_groups")
    .select("*, ea_parameters(*)")
    .eq("organization_id", orgId)
    .eq("ea_version_id", eaVersionId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((g) => {
    const { ea_parameters, ...group } = g as ParameterGroupRow & { ea_parameters: EaParameterRow[] };
    return {
      ...(group as ParameterGroupRow),
      parameters: [...(ea_parameters ?? [])].sort((a, b) => a.position - b.position),
    };
  });
}
