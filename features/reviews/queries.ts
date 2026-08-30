import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ManualStatusDb } from "@/lib/supabase/database.types";
import type { OrgRole } from "@/lib/permissions/actions";
import {
  REVIEW_QUEUE_STATUS,
  REVIEW_QUEUE_ASSIGNMENT_COL,
  type ReviewQueueType,
} from "@/features/reviews/queue-contract";

export type ReviewQueueRow = {
  manualId: string;
  manualVersionId: string;
  eaName: string;
  eaVersion: string;
  manualVersion: string;
  status: ManualStatusDb;
  reviewRound: number;
  updatedAt: string;
  assignedToMe: boolean;
};

type Rel<T> = T | T[];
function one<T>(v: Rel<T>): T {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Assignment-scoped review queue (PRD-REV-003/009, AC-P6-3). A `TECHNICAL_REVIEWER` sees only
 * versions in `TECHNICAL_REVIEW` assigned to them; a `COMPLIANCE_REVIEWER` only versions in
 * `COMPLIANCE_REVIEW` assigned to them; an `ADMIN` sees every version in that one review state in
 * the org. RLS already scopes rows to the org; the assignment filter is applied here.
 */
export async function listReviewQueue(
  orgId: string,
  userId: string,
  roles: OrgRole[],
  type: ReviewQueueType,
): Promise<ReviewQueueRow[]> {
  const supabase = await createSupabaseServerClient();
  const status: ManualStatusDb = REVIEW_QUEUE_STATUS[type];
  const assignmentCol = REVIEW_QUEUE_ASSIGNMENT_COL[type];
  const isAdmin = roles.includes("ADMIN");

  let q = supabase
    .from("manual_versions")
    .select(
      "id, version, status, review_round, updated_at, manual_id, technical_reviewer_id, compliance_reviewer_id, " +
        "manuals!inner(id, ea_products!inner(name)), ea_versions!inner(version)",
    )
    .eq("organization_id", orgId)
    .eq("status", status)
    .order("updated_at", { ascending: false });
  if (!isAdmin) q = q.eq(assignmentCol, userId);

  const { data, error } = await q;
  if (error) throw error;

  type RawRow = {
    id: string;
    version: string;
    status: ManualStatusDb;
    review_round: number;
    updated_at: string;
    manual_id: string;
    technical_reviewer_id: string | null;
    compliance_reviewer_id: string | null;
    manuals: Rel<{ id: string; ea_products: Rel<{ name: string }> }>;
    ea_versions: Rel<{ version: string }>;
  };

  return ((data ?? []) as unknown as RawRow[]).map((r) => {
    const m = one(r.manuals);
    return {
      manualId: m.id,
      manualVersionId: r.id,
      eaName: one(m.ea_products).name,
      eaVersion: one(r.ea_versions).version,
      manualVersion: r.version,
      status: r.status,
      reviewRound: Number(r.review_round),
      updatedAt: r.updated_at,
      assignedToMe:
        (type === "technical" ? r.technical_reviewer_id : r.compliance_reviewer_id) === userId,
    };
  });
}

export type AssignableReviewer = { id: string; name: string; email: string };

/** Active members of the org who can be assigned to a given review role. */
export async function listAssignableReviewers(
  orgId: string,
  role: "TECHNICAL_REVIEWER" | "COMPLIANCE_REVIEWER",
): Promise<AssignableReviewer[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, profiles!inner(id, display_name, email)")
    .eq("organization_id", orgId)
    .eq("role", role)
    .eq("is_active", true);
  if (error) throw error;
  type RawRow = { user_id: string; profiles: Rel<{ id: string; display_name: string; email: string }> };
  const seen = new Set<string>();
  const out: AssignableReviewer[] = [];
  for (const r of (data ?? []) as unknown as RawRow[]) {
    const p = one(r.profiles);
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: p.display_name || p.email, email: p.email });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Review comments (slice 3)
// ---------------------------------------------------------------------------
export type ReviewCommentAnchor =
  | { kind: "manual" }
  | { kind: "section"; sectionId: string; sectionKey: string; title: string }
  | {
      kind: "block";
      blockId: string;
      sectionId: string;
      sectionKey: string;
      sectionTitle: string;
      blockType: string;
      position: number;
      deleted: boolean;
    };

export type ReviewCommentRow = {
  id: string;
  round: number;
  reviewType: "TECHNICAL" | "COMPLIANCE";
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  resolved: boolean;
  resolvedByName: string | null;
  resolvedAt: string | null;
  anchor: ReviewCommentAnchor;
};

/**
 * All comments on a manual version, ordered `round_number ASC, created_at ASC` (deterministic,
 * oldest round first). Includes author + resolver display names and the minimal anchor metadata a
 * client needs to navigate to the section/block. RLS scopes rows to org members (001300 policy);
 * this returns no profile object, no secrets, no unrelated-org data.
 */
export async function listReviewComments(orgId: string, manualVersionId: string): Promise<ReviewCommentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("review_comments")
    .select(
      "id, round_number, review_type, body, author_id, section_id, block_id, resolved, resolved_by, resolved_at, created_at",
    )
    .eq("organization_id", orgId)
    .eq("manual_version_id", manualVersionId)
    .order("round_number", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  type RawRow = {
    id: string;
    round_number: number;
    review_type: "TECHNICAL" | "COMPLIANCE";
    body: string;
    author_id: string;
    section_id: string | null;
    block_id: string | null;
    resolved: boolean;
    resolved_by: string | null;
    resolved_at: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as RawRow[];
  if (rows.length === 0) return [];

  const personIds = new Set<string>();
  for (const r of rows) {
    personIds.add(r.author_id);
    if (r.resolved_by) personIds.add(r.resolved_by);
  }
  const names = new Map<string, string>();
  if (personIds.size) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", [...personIds]);
    for (const p of profs ?? [])
      names.set(p.id as string, (p.display_name as string) || (p.email as string));
  }

  const sectionIds = [...new Set(rows.map((r) => r.section_id).filter(Boolean) as string[])];
  const blockIds = [...new Set(rows.map((r) => r.block_id).filter(Boolean) as string[])];

  const sectionMeta = new Map<string, { key: string; title: string }>();
  if (sectionIds.length) {
    const { data: secs } = await supabase
      .from("manual_sections")
      .select("id, section_key, title")
      .in("id", sectionIds);
    for (const s of secs ?? [])
      sectionMeta.set(s.id as string, { key: s.section_key as string, title: s.title as string });
  }

  const blockMeta = new Map<
    string,
    { sectionId: string; blockType: string; position: number; deleted: boolean }
  >();
  if (blockIds.length) {
    const { data: blks } = await supabase
      .from("manual_blocks")
      .select("id, manual_section_id, block_type, position, deleted_at")
      .in("id", blockIds);
    const missingSecs = new Set<string>();
    for (const b of blks ?? []) {
      blockMeta.set(b.id as string, {
        sectionId: b.manual_section_id as string,
        blockType: b.block_type as string,
        position: Number(b.position),
        deleted: b.deleted_at != null,
      });
      if (!sectionMeta.has(b.manual_section_id as string)) missingSecs.add(b.manual_section_id as string);
    }
    if (missingSecs.size) {
      const { data: secs2 } = await supabase
        .from("manual_sections")
        .select("id, section_key, title")
        .in("id", [...missingSecs]);
      for (const s of secs2 ?? [])
        sectionMeta.set(s.id as string, { key: s.section_key as string, title: s.title as string });
    }
  }

  return rows.map((r) => {
    let anchor: ReviewCommentAnchor = { kind: "manual" };
    if (r.section_id) {
      const m = sectionMeta.get(r.section_id);
      anchor = { kind: "section", sectionId: r.section_id, sectionKey: m?.key ?? "", title: m?.title ?? "Bab" };
    } else if (r.block_id) {
      const b = blockMeta.get(r.block_id);
      const m = b ? sectionMeta.get(b.sectionId) : undefined;
      anchor = {
        kind: "block",
        blockId: r.block_id,
        sectionId: b?.sectionId ?? "",
        sectionKey: m?.key ?? "",
        sectionTitle: m?.title ?? "Bab",
        blockType: b?.blockType ?? "blok",
        position: b?.position ?? 0,
        deleted: b?.deleted ?? false,
      };
    }
    return {
      id: r.id,
      round: Number(r.round_number),
      reviewType: r.review_type,
      body: r.body,
      authorId: r.author_id,
      authorName: names.get(r.author_id) ?? "—",
      createdAt: r.created_at,
      resolved: r.resolved,
      resolvedByName: r.resolved_by ? names.get(r.resolved_by) ?? null : null,
      resolvedAt: r.resolved_at,
      anchor,
    };
  });
}

export type ReviewContext = {
  manualVersionId: string;
  status: ManualStatusDb;
  reviewRound: number;
  technicalReviewerId: string | null;
  complianceReviewerId: string | null;
  technicalReviewerName: string | null;
  complianceReviewerName: string | null;
  /** decisions of the CURRENT round (0..2 rows) */
  currentRoundDecisions: {
    reviewType: "TECHNICAL" | "COMPLIANCE";
    decision: "APPROVE" | "REQUEST_CHANGES";
    summary: string;
    reviewerName: string | null;
    decidedAt: string;
  }[];
};

/** Review context for the builder / review panel of one manual version. */
export async function getReviewContext(orgId: string, manualVersionId: string): Promise<ReviewContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data: mv } = await supabase
    .from("manual_versions")
    .select("id, status, review_round, technical_reviewer_id, compliance_reviewer_id")
    .eq("id", manualVersionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!mv) return null;

  const ids = [mv.technical_reviewer_id, mv.compliance_reviewer_id].filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, display_name, email").in("id", ids);
    for (const p of profs ?? []) names.set(p.id as string, (p.display_name as string) || (p.email as string));
  }

  const { data: decisions } = await supabase
    .from("reviews")
    .select("review_type, decision, summary, reviewer_id, decided_at")
    .eq("manual_version_id", manualVersionId)
    .eq("round_number", mv.review_round)
    .order("decided_at", { ascending: true });

  const decisionReviewerIds = (decisions ?? []).map((d) => d.reviewer_id as string).filter(Boolean);
  if (decisionReviewerIds.length) {
    const missing = decisionReviewerIds.filter((id) => !names.has(id));
    if (missing.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name, email").in("id", missing);
      for (const p of profs ?? []) names.set(p.id as string, (p.display_name as string) || (p.email as string));
    }
  }

  return {
    manualVersionId: mv.id as string,
    status: mv.status as ManualStatusDb,
    reviewRound: Number(mv.review_round),
    technicalReviewerId: mv.technical_reviewer_id as string | null,
    complianceReviewerId: mv.compliance_reviewer_id as string | null,
    technicalReviewerName: mv.technical_reviewer_id ? names.get(mv.technical_reviewer_id as string) ?? null : null,
    complianceReviewerName: mv.compliance_reviewer_id ? names.get(mv.compliance_reviewer_id as string) ?? null : null,
    currentRoundDecisions: (decisions ?? []).map((d) => ({
      reviewType: d.review_type as "TECHNICAL" | "COMPLIANCE",
      decision: d.decision as "APPROVE" | "REQUEST_CHANGES",
      summary: (d.summary as string) ?? "",
      reviewerName: names.get(d.reviewer_id as string) ?? null,
      decidedAt: d.decided_at as string,
    })),
  };
}

export type PublishedSnapshotMeta = {
  id: string;
  contentHash: string;
  publicSlug: string;
  publicVersion: string;
  publishedAt: string;
};

/** Snapshot metadata for the builder Metadata panel (Phase 6 slice 6). Bytes stay server-side. */
export async function getPublishedSnapshotMeta(
  orgId: string,
  manualVersionId: string,
): Promise<PublishedSnapshotMeta | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("published_snapshots")
    .select("id, content_hash, public_slug, public_version, published_at")
    .eq("organization_id", orgId)
    .eq("manual_version_id", manualVersionId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    contentHash: data.content_hash as string,
    publicSlug: data.public_slug as string,
    publicVersion: data.public_version as string,
    publishedAt: data.published_at as string,
  };
}

// ---------------------------------------------------------------------------
// Review history (slice 7 — AC-P6-15). Decision + comment history for ONE Manual
// Version, every round, org-scoped. Reuses `listReviewComments` (deleted-block anchors,
// resolver names) and returns only the actor display fields a client needs — no profiles,
// no secrets, no cross-org data (RLS scopes every query to the caller's org).
// ---------------------------------------------------------------------------
export type ReviewHistoryDecision = {
  reviewType: "TECHNICAL" | "COMPLIANCE";
  decision: "APPROVE" | "REQUEST_CHANGES";
  actorName: string;
  decidedAt: string;
  summary: string;
};

export type ReviewHistoryRound = {
  round: number;
  decisions: ReviewHistoryDecision[];
  comments: ReviewCommentRow[];
};

export type ReviewHistory = {
  manualId: string;
  manualVersionId: string;
  manualVersion: string;
  eaName: string;
  eaVersion: string;
  eaPlatform: string;
  status: ManualStatusDb;
  reviewRound: number;
  technicalReviewerName: string | null;
  complianceReviewerName: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  rounds: ReviewHistoryRound[];
};

/** Full decision + comment history for the given Manual Version, or null if not in this org. */
export async function getReviewHistory(
  orgId: string,
  manualId: string,
  manualVersionId: string,
): Promise<ReviewHistory | null> {
  const supabase = await createSupabaseServerClient();

  const { data: mvRaw } = await supabase
    .from("manual_versions")
    .select(
      "id, manual_id, version, status, review_round, technical_reviewer_id, compliance_reviewer_id, " +
        "published_at, archived_at, ea_versions!inner(version, platform), manuals!inner(id, ea_products!inner(name))",
    )
    .eq("organization_id", orgId)
    .eq("id", manualVersionId)
    .eq("manual_id", manualId)
    .maybeSingle();
  if (!mvRaw) return null;
  const mv = mvRaw as unknown as {
    id: string;
    manual_id: string;
    version: string;
    status: ManualStatusDb;
    review_round: number;
    technical_reviewer_id: string | null;
    compliance_reviewer_id: string | null;
    published_at: string | null;
    archived_at: string | null;
    ea_versions: Rel<{ version: string; platform: string }>;
    manuals: Rel<{ id: string; ea_products: Rel<{ name: string }> }>;
  };

  const mrow = one(mv.manuals);
  const eav = one(mv.ea_versions);

  const revIds = [mv.technical_reviewer_id, mv.compliance_reviewer_id].filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (revIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, display_name, email").in("id", revIds);
    for (const p of profs ?? []) names.set(p.id as string, (p.display_name as string) || (p.email as string));
  }

  const { data: decisions } = await supabase
    .from("reviews")
    .select("round_number, review_type, decision, summary, reviewer_id, decided_at")
    .eq("organization_id", orgId)
    .eq("manual_version_id", manualVersionId)
    .order("round_number", { ascending: true })
    .order("decided_at", { ascending: true });

  const decisionActorIds = [...new Set((decisions ?? []).map((d) => d.reviewer_id as string))].filter(
    (id) => !names.has(id),
  );
  if (decisionActorIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, display_name, email").in("id", decisionActorIds);
    for (const p of profs ?? []) names.set(p.id as string, (p.display_name as string) || (p.email as string));
  }

  const comments = await listReviewComments(orgId, manualVersionId);

  const roundNums = new Set<number>();
  for (const d of decisions ?? []) roundNums.add(Number(d.round_number));
  for (const c of comments) roundNums.add(c.round);
  const rounds: ReviewHistoryRound[] = [...roundNums]
    .sort((a, b) => a - b)
    .map((round) => ({
      round,
      decisions: (decisions ?? [])
        .filter((d) => Number(d.round_number) === round)
        .map((d) => ({
          reviewType: d.review_type as "TECHNICAL" | "COMPLIANCE",
          decision: d.decision as "APPROVE" | "REQUEST_CHANGES",
          actorName: names.get(d.reviewer_id as string) ?? "—",
          decidedAt: d.decided_at as string,
          summary: (d.summary as string) ?? "",
        })),
      comments: comments.filter((c) => c.round === round),
    }));

  return {
    manualId: mrow.id,
    manualVersionId: mv.id as string,
    manualVersion: mv.version as string,
    eaName: one(mrow.ea_products).name,
    eaVersion: eav.version,
    eaPlatform: eav.platform,
    status: mv.status as ManualStatusDb,
    reviewRound: Number(mv.review_round),
    technicalReviewerName: mv.technical_reviewer_id ? names.get(mv.technical_reviewer_id as string) ?? null : null,
    complianceReviewerName: mv.compliance_reviewer_id ? names.get(mv.compliance_reviewer_id as string) ?? null : null,
    publishedAt: (mv.published_at as string | null) ?? null,
    archivedAt: (mv.archived_at as string | null) ?? null,
    rounds,
  };
}
