import { notFound } from "next/navigation";
import { ManualBuilder } from "@/features/manuals/manual-builder";
import { getWorkspaceContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel } from "@/lib/manual/view-model";
import { listOrgImages } from "@/features/images/queries";
import { listParameterGroups } from "@/features/parameters/queries";

export const dynamic = "force-dynamic";

export default async function ManualBuilderPage({
  params,
}: {
  params: Promise<{ manualId: string }>;
}) {
  const { manualId } = await params;
  const ctx = await getWorkspaceContext();
  const orgId = ctx.activeOrg!.id;

  const source = new SupabaseManualDataSource(orgId);
  const vm = await assembleManualViewModel(source, manualId);
  if (!vm) notFound();

  const canEdit = canAny(ctx.activeOrg?.roles ?? [], "manual:update");

  // Editor context: org images for placement, and the linked EA Version's parameter groups
  // (parameterTable blocks may only reference these — GI-11 / AC-P3-8).
  const [images, groups] = await Promise.all([
    listOrgImages(orgId).catch(() => []),
    listParameterGroups(orgId, vm.eaVersion.id).catch(() => []),
  ]);

  return (
    <ManualBuilder
      vm={vm}
      canEdit={canEdit}
      images={images}
      groups={groups.map((g) => ({ id: g.id, name: g.name, count: g.parameters.length }))}
    />
  );
}
