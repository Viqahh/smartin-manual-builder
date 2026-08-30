import { notFound } from "next/navigation";
import { ManualBuilder, type ReviewBundle } from "@/features/manuals/manual-builder";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel } from "@/lib/manual/view-model";
import { listOrgImages } from "@/features/images/queries";
import { listParameterGroups } from "@/features/parameters/queries";
import { currentProviderMode } from "@/lib/ai/providers";
import { getValidation } from "@/features/validation/actions";
import {
  getReviewContext,
  listAssignableReviewers,
  listReviewComments,
  getPublishedSnapshotMeta,
} from "@/features/reviews/queries";
import { listSourceEaVersions } from "@/features/changelog/queries";
import { eaPbkScope } from "@/lib/validation/rules";
import type { ChangelogBundle, CloneBundle, PublicationBundle } from "@/features/manuals/manual-builder";

export const dynamic = "force-dynamic";

export default async function ManualBuilderPage({
  params,
}: {
  params: Promise<{ manualId: string }>;
}) {
  const { manualId } = await params;
  const { user, activeOrg } = await getRequiredWorkspacePageContext();
  const orgId = activeOrg.id;
  const userId = user.id;

  const source = new SupabaseManualDataSource(orgId);
  const vm = await assembleManualViewModel(source, manualId);
  if (!vm) notFound();

  const roles = activeOrg.roles;
  const isDraft = vm.manualVersion.status === "DRAFT";
  const canAuthor = canAny(roles, "manual:update");
  // Content is authored only in DRAFT (server-enforced by a DB trigger; the UI reflects it).
  const canEdit = canAuthor && isDraft;
  const canReview = canAny(roles, "review:technical") || canAny(roles, "review:compliance");
  const isAdmin = roles.includes("ADMIN");

  const [images, groups, validationRes, reviewCtx, assignT, assignC, comments, sourceEaVersions, snapshotMeta] =
    await Promise.all([
      listOrgImages(orgId).catch(() => []),
      listParameterGroups(orgId, vm.eaVersion.id).catch(() => []),
      getValidation({ manualId }).catch(() => null),
      getReviewContext(orgId, vm.manualVersion.id).catch(() => null),
      isAdmin ? listAssignableReviewers(orgId, "TECHNICAL_REVIEWER").catch(() => []) : Promise.resolve([]),
      isAdmin ? listAssignableReviewers(orgId, "COMPLIANCE_REVIEWER").catch(() => []) : Promise.resolve([]),
      listReviewComments(orgId, vm.manualVersion.id).catch(() => []),
      listSourceEaVersions(orgId, vm.eaProduct.id).catch(() => []),
      getPublishedSnapshotMeta(orgId, vm.manualVersion.id).catch(() => null),
    ]);

  const validation = validationRes && validationRes.ok ? validationRes.data : null;
  const lastRc = (reviewCtx?.currentRoundDecisions ?? [])
    .filter((d) => d.decision === "REQUEST_CHANGES")
    .slice(-1)[0];

  // slice 3 — comment capabilities: create is stage-gated to the assigned reviewer of the active
  // stage; resolve/reopen is allowed to the assigned reviewer of the matching type in any stage.
  const isAssignedTech = canAny(roles, "review:technical") && reviewCtx?.technicalReviewerId === userId;
  const isAssignedComp = canAny(roles, "review:compliance") && reviewCtx?.complianceReviewerId === userId;
  const canComment: "TECHNICAL" | "COMPLIANCE" | null =
    reviewCtx?.status === "TECHNICAL_REVIEW" && isAssignedTech
      ? "TECHNICAL"
      : reviewCtx?.status === "COMPLIANCE_REVIEW" && isAssignedComp
        ? "COMPLIANCE"
        : null;

  const review: ReviewBundle | null = reviewCtx
    ? {
        manualId,
        status: reviewCtx.status,
        reviewRound: reviewCtx.reviewRound,
        isAdmin,
        isAssignedTechnical: canAny(roles, "review:technical") && reviewCtx.technicalReviewerId === userId,
        isAssignedCompliance: canAny(roles, "review:compliance") && reviewCtx.complianceReviewerId === userId,
        canSubmit: canAny(roles, "manual:submit_review"),
        canBeginRevision: canAuthor,
        technicalReviewerId: reviewCtx.technicalReviewerId,
        complianceReviewerId: reviewCtx.complianceReviewerId,
        technicalReviewerName: reviewCtx.technicalReviewerName,
        complianceReviewerName: reviewCtx.complianceReviewerName,
        blockingReasons: validation && !validation.eligibility.ready ? validation.eligibility.blockingReasons : [],
        lastRequestChangesSummary: lastRc?.summary ?? null,
        assignableTechnical: assignT,
        assignableCompliance: assignC,
        comments,
        canComment,
        canResolveTechnical: isAssignedTech,
        canResolveCompliance: isAssignedComp,
      }
    : null;

  const clone: CloneBundle | null = canAny(roles, "manual:create")
    ? {
        sourceManualVersionId: vm.manualVersion.id,
        sourceVersion: vm.manualVersion.version,
        sourceEaVersionLabel: `v${vm.eaVersion.version} (${vm.eaVersion.platform})`,
        linkedEaVersionId: vm.eaVersion.id,
        targetOptions: sourceEaVersions,
      }
    : null;

  const currentDecisions = reviewCtx?.currentRoundDecisions ?? [];
  const techApprove = currentDecisions.find((d) => d.reviewType === "TECHNICAL" && d.decision === "APPROVE");
  const compApprove = currentDecisions.find((d) => d.reviewType === "COMPLIANCE" && d.decision === "APPROVE");
  const publication: PublicationBundle | null = reviewCtx
    ? {
        manualId,
        status: reviewCtx.status,
        isAdmin,
        reviewRound: reviewCtx.reviewRound,
        eaName: vm.eaProduct.name,
        eaVersion: `v${vm.eaVersion.version} (${vm.eaVersion.platform})`,
        manualVersion: vm.manualVersion.version,
        publicSlug: vm.eaProduct.slug,
        technicalDecision: techApprove
          ? { reviewerName: techApprove.reviewerName, decidedAt: techApprove.decidedAt }
          : null,
        complianceDecision: compApprove
          ? { reviewerName: compApprove.reviewerName, decidedAt: compApprove.decidedAt }
          : null,
        readinessPercent: validation?.score.percent ?? null,
        publishBlockers: (validation?.items ?? [])
          .filter((it) => (it.required && it.state === "MISSING") || (it.publishBlocking && it.state === "WARNING"))
          .map((it) => ({ checkKey: it.checkKey, label: it.label, state: it.state })),
        snapshot: snapshotMeta
          ? {
              contentHash: snapshotMeta.contentHash,
              publicSlug: snapshotMeta.publicSlug,
              publicVersion: snapshotMeta.publicVersion,
              publishedAt: snapshotMeta.publishedAt,
            }
          : null,
      }
    : null;

  const changelog: ChangelogBundle = {
    manualVersionId: vm.manualVersion.id,
    canEdit,
    entries: (vm.changelog ?? []).map((c) => ({
      id: c.id,
      position: c.position,
      entryType: c.entryType,
      body: c.body,
      sourceEaVersionId: c.sourceEaVersionId,
      isFeatureChange: c.isFeatureChange,
      openPositionImpact: c.openPositionImpact,
    })),
    pbkScope: eaPbkScope(vm.eaVersion.requirements),
    sourceOptions: sourceEaVersions,
    linkedEaVersionId: vm.eaVersion.id,
  };

  return (
    <ManualBuilder
      vm={vm}
      canEdit={canEdit}
      canReview={canReview}
      images={images}
      groups={groups.map((g) => ({ id: g.id, name: g.name, count: g.parameters.length }))}
      aiProviderMode={currentProviderMode()}
      initialValidation={validation}
      review={review}
      changelog={changelog}
      clone={clone}
      publication={publication}
    />
  );
}
