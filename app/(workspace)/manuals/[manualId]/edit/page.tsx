import { notFound } from "next/navigation";
import { ManualBuilder } from "@/features/manuals/manual-builder";
import { getWorkspaceContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel } from "@/lib/manual/view-model";

export const dynamic = "force-dynamic";

export default async function ManualBuilderPage({
  params,
}: {
  params: Promise<{ manualId: string }>;
}) {
  const { manualId } = await params;
  const ctx = await getWorkspaceContext();

  const source = new SupabaseManualDataSource(ctx.activeOrg!.id);
  const vm = await assembleManualViewModel(source, manualId);
  if (!vm) notFound();

  const canEdit = canAny(ctx.activeOrg?.roles ?? [], "manual:update");

  return <ManualBuilder vm={vm} canEdit={canEdit} />;
}
