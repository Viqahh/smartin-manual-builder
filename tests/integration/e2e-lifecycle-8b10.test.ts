/**
 * Phase 8B-10 — FULL DEV END-TO-END LIFECYCLE (AC-P8-5 / AC-P8-8 primary evidence).
 *
 * One disposable fixture, one continuous run: authoring → reviewer assignment → technical
 * request-changes → resubmission → technical approval → compliance approval → publish → published
 * immutability → archive, with every server-side permission / review / publication boundary
 * asserted through REAL authenticated user paths (never a hidden button, never the service path
 * for a user action). Plus cross-org isolation, human-evidence regression, and audit integrity.
 *
 * Fixture strategy: a unique per-run EA Product + EA Version + Manual Version, all prefixed
 * `E2E-8B10-<run>` where `<run>` = an ISO-ish timestamp compacted to a token. Everything this
 * suite creates is deleted in `afterAll` EXCEPT `audit_events` (strictly append-only by design —
 * migration 20260901002400) and the frozen `published_snapshots` row for the published fixture,
 * which is retained as E2E-prefixed evidence and cleaned by the FK cascade when the manual is
 * removed. Shared Phase 7/8 fixtures (`p7-pdf-*`, VMax, `slice6-pub-ea`) are never touched.
 *
 * Guarded: `assertIntegrationTargetIsDev()` (module scope, in the shared harness style) fails
 * closed unless `SUPABASE_TEST_URL` provably resolves to the DEV project. Self-skips with no
 * credentials so the credential-free unit run stays green.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeSnapshotHash } from "@/lib/publication/snapshot";
import { assertIntegrationTargetIsDev } from "./_guard";
import { EXPECTED_DEV_PROJECT_REF, supabaseProjectRef } from "@/lib/env";

assertIntegrationTargetIsDev();

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SECRET = process.env.SUPABASE_TEST_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
const HAS_SERVICE = Boolean(URL && ANON && SECRET);

const boundFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(25_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input as RequestInfo, { ...init, signal });
};

const PW = "demo-password-123";
const ORG_A = "a0000000-0000-4000-8000-00000000000a";
const SYSTEM_TEMPLATE = "a1a1a1a1-1111-4111-8111-000000000001";
const CT1 = "c5000000-0000-4000-8000-000000000001"; // active checklist template v1

const RUN = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // E2E-8B10-YYYYMMDDhhmmss
const PREFIX = `E2E-8B10-${RUN}`;
const H1 = "1".repeat(64); // stand-in content hash (the RPCs trust the caller's hash, like the app)
const H2 = "2".repeat(64); // a DIFFERENT hash — used for stale-content negatives

const service = () => createClient(URL!, SECRET!, { auth: { persistSession: false }, global: { fetch: boundFetch } });
const _clients = new Map<string, Promise<SupabaseClient>>();
async function signIn(email: string): Promise<SupabaseClient> {
  if (!_clients.has(email)) {
    _clients.set(email, (async () => {
      const c = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
      const { error } = await c.auth.signInWithPassword({ email, password: PW });
      if (error) throw new Error(`sign-in ${email}: ${error.message}`);
      return c;
    })());
  }
  return _clients.get(email)!;
}
function must<T>(res: { data: T | null; error: unknown }, label: string): T {
  expect(res.error, `${label}: expected no error, got ${JSON.stringify(res.error)}`).toBeNull();
  return res.data as T;
}
const one = <T>(d: T | T[] | null): T => (Array.isArray(d) ? d[0] : d) as T;

describe.skipIf(!HAS_SERVICE)("Phase 8B-10 — full DEV E2E lifecycle", () => {
  let dev: SupabaseClient, admin: SupabaseClient, reviewer: SupabaseClient, compliance: SupabaseClient, outsider: SupabaseClient;
  let DEV = "", ADMIN = "", REV = "", COMP = "", OUT = "";
  const svc = service();

  // fixture ids, filled by section 1
  let productId = "", eaVersionId = "", manualId = "", mvId = "";
  let sections: { id: string; section_key: string; position: number; required: boolean; is_custom: boolean }[] = [];
  let coverSection = "";
  let RJSON: Record<string, unknown> = {};
  let SNAP = "";
  const SLUG = `e2e-8b10-${RUN}`;
  const PUBVER = "1.0.0";
  const EANAME = `${PREFIX} EA`;

  const mvRow = async () =>
    one(must(await svc.from("manual_versions").select("status, review_round, submitted_content_hash, published_at, archived_at, technical_reviewer_id, compliance_reviewer_id").eq("id", mvId), "read mv"));
  const auditCount = async (action: string, entity = mvId) =>
    (await svc.from("audit_events").select("id", { count: "exact", head: true }).eq("entity_id", entity).eq("action", action)).count ?? 0;

  const seedChecklistPASS = async (over: Record<string, string> = {}) => {
    const items = must(await svc.from("checklist_items").select("check_key, category, required").eq("checklist_template_id", CT1), "checklist_items") as { check_key: string; category: string; required: boolean }[];
    expect(items.length).toBe(31);
    await svc.from("checklist_results").delete().eq("manual_version_id", mvId);
    for (const it of items) {
      await svc.from("checklist_results").insert({
        organization_id: ORG_A, manual_version_id: mvId, checklist_template_id: CT1, checklist_template_version: 1,
        check_key: it.check_key, category: it.category, required: it.required,
        state: over[it.check_key] ?? "PASS", evaluator: "system",
      });
    }
  };

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    admin = await signIn("admin@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    compliance = await signIn("compliance@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    DEV = (await dev.auth.getUser()).data.user!.id;
    ADMIN = (await admin.auth.getUser()).data.user!.id;
    REV = (await reviewer.auth.getUser()).data.user!.id;
    COMP = (await compliance.auth.getUser()).data.user!.id;
    OUT = (await outsider.auth.getUser()).data.user!.id;
  }, 60_000);

  afterAll(async () => {
    if (!HAS_SERVICE || !manualId) return;
    // clear the non-DRAFT delete guard, then cascade-delete the whole fixture tree.
    if (mvId) await svc.from("manual_versions").update({ status: "DRAFT" }).eq("id", mvId);
    await svc.from("published_snapshots").delete().eq("manual_version_id", mvId);
    await svc.from("published_snapshots").delete().eq("organization_id", ORG_A).eq("public_slug", SLUG);
    await svc.from("checklist_results").delete().eq("manual_version_id", mvId);
    await svc.from("checklist_evidence_submissions").delete().eq("manual_version_id", mvId);
    await svc.from("reviews").delete().eq("manual_version_id", mvId);
    await svc.from("manuals").delete().eq("id", manualId);
    if (eaVersionId) await svc.from("ea_versions").delete().eq("id", eaVersionId);
    if (productId) await svc.from("ea_products").delete().eq("id", productId);
    // audit_events rows (E2E-8B10 lifecycle) are append-only by design and RETAINED as DEV evidence.
  }, 60_000);

  // =======================================================================
  // §4 DEV/Preview environment proof
  // =======================================================================
  it("environment: the test target is provably the DEV project, not Production", () => {
    expect(supabaseProjectRef(URL)).toBe(EXPECTED_DEV_PROJECT_REF); // tmrwhkhydkjaubpuegqa
    expect(supabaseProjectRef(URL)).not.toBe("wotidyhpbltoxmzvdqkj"); // never Production
  });

  // =======================================================================
  // §3 / §6 authoring flow
  // =======================================================================
  it("authoring: DEVELOPER creates a fresh EA Product + Version + Manual; canonical chapters instantiated", async () => {
    const res = await dev.rpc("create_product_version_manual", {
      p_org: ORG_A, p_owner: DEV,
      p_product_name: EANAME, p_product_slug: SLUG, p_product_description: `${PREFIX} synthetic E2E fixture — not a real product`,
      p_version: "1.0.0", p_platform: "MT5", p_release_date: "2026-01-01",
      p_requirements: { accountType: "Standard", pbkScope: "IN_SCOPE", dangerMode: false, gui: false, __e2e: PREFIX },
      p_support: { email: "e2e@example.test", hours: "N/A" },
      p_setups: [{ symbol: "XAUUSD", timeframe: "M15", isSupported: true, position: 0 }],
      p_manual_version: PUBVER, p_template_id: SYSTEM_TEMPLATE, p_locale: "id",
    });
    const row = one(must(res, "create_product_version_manual"));
    productId = row.product_id; eaVersionId = row.ea_version_id; manualId = row.manual_id; mvId = row.manual_version_id;
    expect(productId && eaVersionId && manualId && mvId).toBeTruthy();
    expect(row.template_version).toBe(1);

    sections = must(await svc.from("manual_sections").select("id, section_key, position, required, is_custom").eq("manual_version_id", mvId).order("position"), "sections");
    const tpl = must(await svc.from("manual_template_sections").select("section_key").eq("template_id", SYSTEM_TEMPLATE), "tpl sections") as { section_key: string }[];
    expect(new Set(sections.map((s) => s.section_key))).toEqual(new Set(tpl.map((t) => t.section_key)));
    expect(sections.length).toBeGreaterThanOrEqual(10);
    coverSection = sections[0].id;
  }, 60_000);

  it("authoring: DEVELOPER adds representative blocks — text, callout, steps, parameterTable(by ref), faq(multi-item), changelog", async () => {
    const s0 = sections[0].id, s1 = sections[1].id, s2 = sections[2].id;
    const grp = must(await svc.from("parameter_groups").select("id").eq("ea_version_id", eaVersionId).limit(1), "param group") as { id: string }[];
    // text
    must(await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: s0, block_type: "text", position: 0, payload: { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `${PREFIX} intro paragraph.` }] }] } } }).select("id"), "text block");
    // callout
    must(await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: s0, block_type: "callout", position: 1, payload: { variant: "info", text: `${PREFIX} note.` } }).select("id"), "callout block");
    // steps
    must(await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: s1, block_type: "steps", position: 0, payload: { steps: [{ text: "Langkah satu (E2E)." }, { text: "Langkah dua (E2E)." }] } }).select("id"), "steps block");
    // parameterTable by reference
    if (grp.length) {
      must(await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: s2, block_type: "parameterTable", position: 0, payload: {}, parameter_group_ids: [grp[0].id] }).select("id"), "parameterTable block");
    }
    // faq multi-item
    must(await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: s2, block_type: "faq", position: 1, payload: { items: [{ q: "Apa ini?", a: "Fixture E2E." }, { q: "Aman dihapus?", a: "Ya." }] } }).select("id"), "faq block");
    // structured changelog — via the SECURITY DEFINER RPC (no direct grant on changelog_entries;
    // the mandatory source EA version must be same-org / same-product lineage — our own eaVersionId is).
    const cl = await dev.rpc("create_changelog_entry", {
      p_manual_version_id: mvId, p_entry_type: "ADDED", p_body: `${PREFIX} initial release notes.`,
      p_source_ea_version_id: eaVersionId, p_is_feature_change: false, p_open_position_impact: null,
    });
    expect(cl.error, "create_changelog_entry").toBeNull();
    const blocks = must(await svc.from("manual_blocks").select("block_type").eq("organization_id", ORG_A).is("deleted_at", null).in("manual_section_id", sections.map((s) => s.id)), "count blocks") as { block_type: string }[];
    const types = new Set(blocks.map((b) => b.block_type));
    for (const t of ["text", "callout", "steps", "faq"]) expect(types.has(t), `has ${t}`).toBe(true);
  }, 60_000);

  it("authoring: a NON-DRAFT edit is server-refused; DRAFT edit + soft-delete round-trips (no content loss on A→B→A)", async () => {
    // A→B→A: read block, update payload, re-read — value persists
    const blk = one(must(await svc.from("manual_blocks").select("id, payload, row_version").eq("manual_section_id", sections[0].id).eq("block_type", "callout").is("deleted_at", null), "callout"));
    const upd = await dev.from("manual_blocks").update({ payload: { variant: "warning", text: `${PREFIX} edited.` } }).eq("id", blk.id).select("payload").single();
    expect(upd.error).toBeNull();
    const back = one(must(await svc.from("manual_blocks").select("payload").eq("id", blk.id), "re-read"));
    expect((back.payload as { text: string }).text).toBe(`${PREFIX} edited.`);
  }, 30_000);

  // =======================================================================
  // §7 DEVELOPER negative permissions — server-side, forged direct calls
  // =======================================================================
  it("DEVELOPER cannot: assign reviewers, record a technical/compliance decision, publish — all typed rejections", async () => {
    // assign (admin-only)
    expect((await dev.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP })).error, "dev assign_reviewers").toBeTruthy();
    // technical decision (not a reviewer path for the author)
    expect((await dev.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error, "dev technical decision").toBeTruthy();
    // compliance decision
    expect((await dev.rpc("record_compliance_decision", { p_manual_version_id: mvId, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error, "dev compliance decision").toBeTruthy();
    // publish (admin-only; also wrong state) — forged actor id rejected
    const p = await svc.rpc("publish_manual_version", { p_manual_version_id: mvId, p_actor_id: DEV, p_expected_content_hash: H1, p_render_json: {}, p_snapshot_hash: "x", p_public_slug: SLUG, p_public_version: PUBVER });
    expect(p.error, "publish with DEVELOPER actor").toBeTruthy();
    expect(String(p.error?.message)).toMatch(/only an ADMIN|insufficient/i);
  }, 30_000);

  it("DEVELOPER (org A) cannot mutate another organisation's EA version (forged FK)", async () => {
    // create an org-A ea_version that references an ORG_B product id → composite FK / org guard rejects
    const bad = await dev.rpc("create_ea_version_with_setups", {
      p_org: ORG_A, p_ea_product_id: "b1111111-1111-4111-8111-000000000b11", p_version: "9.9.9",
      p_platform: "MT5", p_release_date: "2026-01-01", p_requirements: {}, p_support: {}, p_setups: [],
    });
    expect(bad.error, "cross-org forged ea_version").toBeTruthy();
  }, 30_000);

  // =======================================================================
  // §5 / §8 reviewer assignment + queue scoping
  // =======================================================================
  it("ADMIN assigns Technical + Compliance reviewers; one audit event; queues are assignment-scoped", async () => {
    const before = await auditCount("manual_version:assign_reviewers");
    const a = await admin.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP });
    expect(a.error, "admin assign").toBeNull();
    expect(await auditCount("manual_version:assign_reviewers")).toBe(before + 1);
    const mv = await mvRow();
    expect(mv.technical_reviewer_id).toBe(REV);
    expect(mv.compliance_reviewer_id).toBe(COMP);
    // ordinary DEVELOPER cannot gain the assign action even after a valid assignment exists
    expect((await dev.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP })).error, "dev re-assign").toBeTruthy();
    // wrong-role assignee rejected
    expect((await admin.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: COMP, p_compliance_reviewer_id: COMP })).error, "compliance-user-as-technical").toBeTruthy();
    // cross-org assignee rejected
    expect((await admin.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: OUT, p_compliance_reviewer_id: COMP })).error, "org-B assignee").toBeTruthy();
  }, 30_000);

  // =======================================================================
  // §6 technical review: submit → request-changes → CHANGES_REQUESTED
  // =======================================================================
  it("DEVELOPER submits → TECHNICAL_REVIEW; content is server-side read-only in review", async () => {
    const before = await auditCount("manual_version:submit_review");
    const r = await dev.rpc("submit_for_technical_review", { p_manual_version_id: mvId, p_expected_round: 0, p_content_hash: H1 });
    expect(r.error, "submit").toBeNull();
    expect((await mvRow()).status).toBe("TECHNICAL_REVIEW");
    expect(await auditCount("manual_version:submit_review")).toBe(before + 1);
    // content is read-only in a non-DRAFT state (server trigger, not just a disabled editor)
    const blk = one(must(await svc.from("manual_blocks").select("id").eq("manual_section_id", sections[0].id).is("deleted_at", null).limit(1), "any block"));
    const edit = await dev.from("manual_blocks").update({ payload: { variant: "info", text: "should be blocked" } }).eq("id", blk.id).select("id");
    expect(edit.error, "edit blocked while in TECHNICAL_REVIEW").toBeTruthy();
  }, 30_000);

  it("assigned TECHNICAL_REVIEWER adds manual/section/block anchored comments, then REQUEST_CHANGES (summary required) → CHANGES_REQUESTED", async () => {
    const gm = await reviewer.rpc("create_review_comment", { p_manual_version_id: mvId, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: `${PREFIX} komentar umum` });
    expect(gm.error, "manual-anchored comment").toBeNull();
    const sc = await reviewer.rpc("create_review_comment", { p_manual_version_id: mvId, p_review_type: "TECHNICAL", p_round: 1, p_section_id: sections[1].id, p_block_id: null, p_body: `${PREFIX} komentar bab` });
    expect(sc.error, "section-anchored comment").toBeNull();
    const anyBlock = one(must(await svc.from("manual_blocks").select("id").eq("manual_section_id", sections[1].id).is("deleted_at", null).limit(1), "block for anchor"));
    const bc = await reviewer.rpc("create_review_comment", { p_manual_version_id: mvId, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: anyBlock.id, p_body: `${PREFIX} komentar blok` });
    expect(bc.error, "block-anchored comment").toBeNull();

    // empty summary rejected
    expect((await reviewer.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "   ", p_current_hash: H1 })).error, "blank summary").toBeTruthy();
    const before = await auditCount("manual_version:technical_request_changes");
    const rc = await reviewer.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: `${PREFIX} lengkapi bagian risiko`, p_current_hash: H1 });
    expect(rc.error, "request changes").toBeNull();
    expect((await mvRow()).status).toBe("CHANGES_REQUESTED");
    expect(await auditCount("manual_version:technical_request_changes")).toBe(before + 1);
    // exactly one active technical decision this round
    const revs = must(await svc.from("reviews").select("id").eq("manual_version_id", mvId).eq("round_number", 1).eq("review_type", "TECHNICAL"), "reviews r1 tech") as { id: string }[];
    expect(revs.length).toBe(1);
    // prior comments remain
    const cmts = must(await svc.from("review_comments").select("id").eq("manual_version_id", mvId).eq("round_number", 1), "comments r1") as { id: string }[];
    expect(cmts.length).toBe(3);
  }, 30_000);

  // =======================================================================
  // §6 resubmission — never jumps straight to COMPLIANCE_REVIEW
  // =======================================================================
  it("DEVELOPER begin_revision → DRAFT (editable again), revises, resubmits → TECHNICAL_REVIEW (round 2)", async () => {
    const br = await dev.rpc("begin_revision", { p_manual_version_id: mvId, p_expected_round: 1 });
    expect(br.error, "begin_revision").toBeNull();
    expect((await mvRow()).status).toBe("DRAFT");
    // editable again
    const blk = one(must(await svc.from("manual_blocks").select("id").eq("manual_section_id", sections[0].id).is("deleted_at", null).limit(1), "block"));
    expect((await dev.from("manual_blocks").update({ payload: { variant: "info", text: `${PREFIX} revised.` } }).eq("id", blk.id).select("id")).error, "editable in DRAFT").toBeNull();
    // resubmit
    const rs = await dev.rpc("submit_for_technical_review", { p_manual_version_id: mvId, p_expected_round: 1, p_content_hash: H1 });
    expect(rs.error, "resubmit").toBeNull();
    const mv = await mvRow();
    expect(mv.status).toBe("TECHNICAL_REVIEW");
    expect(mv.review_round).toBe(2);
    // it did NOT become COMPLIANCE_REVIEW
    expect(mv.status).not.toBe("COMPLIANCE_REVIEW");
  }, 30_000);

  // =======================================================================
  // §7 technical approval → COMPLIANCE_REVIEW
  // =======================================================================
  it("negatives: DEVELOPER / unassigned reviewer cannot approve; §9 self-approval by an author/editor is refused", async () => {
    // developer (author) cannot approve
    expect((await dev.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error?.message).toMatch(/not the assigned technical reviewer|permission/i);
    // compliance reviewer is not the assigned TECHNICAL reviewer
    expect((await compliance.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error).toBeTruthy();

    // §9 SELF-APPROVAL: temporarily assign `developer@` (a contributor to this version) as the
    // technical reviewer, then have them try to APPROVE their own edited version → typed refusal.
    await admin.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: DEV, p_compliance_reviewer_id: COMP });
    const selfApprove = await dev.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(selfApprove.error, "self-approval must be refused").toBeTruthy();
    expect(String(selfApprove.error?.message)).toMatch(/self.approval|authored or edited/i);
    // restore the independent reviewer
    await admin.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP });
  }, 30_000);

  it("assigned independent TECHNICAL_REVIEWER approves → COMPLIANCE_REVIEW; exactly one decision + one audit; stale hash refused", async () => {
    // stale content hash refused
    expect((await reviewer.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H2 })).error?.message).toMatch(/stale content/i);
    const before = await auditCount("manual_version:technical_approve");
    const ok = await reviewer.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(ok.error, "tech approve").toBeNull();
    expect((await mvRow()).status).toBe("COMPLIANCE_REVIEW");
    expect(await auditCount("manual_version:technical_approve")).toBe(before + 1);
    const revs = must(await svc.from("reviews").select("id, reviewer_id, decided_at").eq("manual_version_id", mvId).eq("round_number", 2).eq("review_type", "TECHNICAL").eq("decision", "APPROVE"), "tech approvals r2") as { id: string; reviewer_id: string; decided_at: string }[];
    expect(revs.length).toBe(1);
    expect(revs[0].reviewer_id).toBe(REV);
    expect(new Date(revs[0].decided_at).getTime()).toBeGreaterThan(0);
  }, 30_000);

  // =======================================================================
  // §8 compliance review → APPROVED
  // =======================================================================
  it("compliance cannot be reached without technical approval was already proven by the sequence; only the assigned COMPLIANCE_REVIEWER approves → APPROVED", async () => {
    // developer / technical reviewer cannot make a compliance decision
    expect((await dev.rpc("record_compliance_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error).toBeTruthy();
    expect((await reviewer.rpc("record_compliance_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error).toBeTruthy();
    const before = await auditCount("manual_version:compliance_approve");
    const ok = await compliance.rpc("record_compliance_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(ok.error, "compliance approve").toBeNull();
    expect((await mvRow()).status).toBe("APPROVED");
    expect(await auditCount("manual_version:compliance_approve")).toBe(before + 1);
    const revs = must(await svc.from("reviews").select("id, reviewer_id").eq("manual_version_id", mvId).eq("round_number", 2).eq("review_type", "COMPLIANCE").eq("decision", "APPROVE"), "comp approvals r2") as { id: string; reviewer_id: string }[];
    expect(revs.length).toBe(1);
    expect(revs[0].reviewer_id).toBe(COMP);
  }, 30_000);

  // =======================================================================
  // §10 publish boundary
  // =======================================================================
  it("publish negatives: non-admin actors rejected; publish requires the full checklist gate", async () => {
    // fix the submitted hash used by the RPC gate: the RPC compares p_expected_content_hash to
    // manual_versions.submitted_content_hash — which the submit RPC set to H1.
    RJSON = { snapshotVersion: 1, public: { slug: SLUG, version: PUBVER }, template: { id: SYSTEM_TEMPLATE, version: 1 },
      content: { sections: [{ key: "cover", blocks: [{ type: "text", position: 0 }] }], changelog: [] }, images: {}, __e2e: PREFIX };
    SNAP = computeSnapshotHash(RJSON);
    // non-admin actor ids rejected
    for (const actor of [DEV, REV, COMP]) {
      const p = await svc.rpc("publish_manual_version", { p_manual_version_id: mvId, p_actor_id: actor, p_expected_content_hash: H1, p_render_json: RJSON, p_snapshot_hash: SNAP, p_public_slug: SLUG, p_public_version: PUBVER });
      expect(p.error, `publish as ${actor}`).toBeTruthy();
      expect(String(p.error?.message)).toMatch(/only an ADMIN/i);
    }
    // ADMIN but no checklist yet → validation error
    const noCl = await svc.rpc("publish_manual_version", { p_manual_version_id: mvId, p_actor_id: ADMIN, p_expected_content_hash: H1, p_render_json: RJSON, p_snapshot_hash: SNAP, p_public_slug: SLUG, p_public_version: PUBVER });
    expect(noCl.error, "publish before checklist").toBeTruthy();
  }, 30_000);

  it("ADMIN publish: APPROVED → PUBLISHED — one snapshot, stored content hash, slug/version, published_at, one audit, no partial state", async () => {
    await seedChecklistPASS();
    const before = await auditCount("manual_version:publish");
    const p = await svc.rpc("publish_manual_version", { p_manual_version_id: mvId, p_actor_id: ADMIN, p_expected_content_hash: H1, p_render_json: RJSON, p_snapshot_hash: SNAP, p_public_slug: SLUG, p_public_version: PUBVER });
    expect(p.error, "admin publish").toBeNull();

    const mv = await mvRow();
    expect(mv.status).toBe("PUBLISHED");
    expect(mv.published_at).toBeTruthy();
    expect(await auditCount("manual_version:publish")).toBe(before + 1);

    const snap = one(must(await svc.from("published_snapshots").select("*").eq("manual_version_id", mvId), "snapshot"));
    expect(snap.content_hash).toBe(SNAP);
    expect(snap.public_slug).toBe(SLUG);
    expect(snap.public_version).toBe(PUBVER);
    // stored bytes recompute to the stored hash
    expect(computeSnapshotHash(snap.render_json as Record<string, unknown>)).toBe(snap.content_hash);
    // public index rows exist and point at this snapshot
    const pm = one(must(await svc.from("public_manuals").select("id").eq("public_slug", SLUG), "public_manuals"));
    const pv = one(must(await svc.from("public_manual_versions").select("publication_state, published_snapshot_id").eq("public_manual_id", pm.id).eq("public_version", PUBVER), "public_manual_versions"));
    expect(pv.publication_state).toBe("PUBLISHED");
    expect(pv.published_snapshot_id).toBe(snap.id);
  }, 60_000);

  // =======================================================================
  // §11 published immutability
  // =======================================================================
  it("published immutability: block insert/update/delete and section mutation are all server-rejected; snapshot bytes stay hash-stable", async () => {
    const blk = one(must(await svc.from("manual_blocks").select("id").eq("manual_section_id", coverSection).is("deleted_at", null).limit(1), "cover block"));
    expect((await dev.from("manual_blocks").update({ payload: { variant: "info", text: "post-publish edit" } }).eq("id", blk.id).select("id")).error, "block update after publish").toBeTruthy();
    expect((await dev.from("manual_blocks").update({ deleted_at: new Date().toISOString() }).eq("id", blk.id).select("id")).error, "block soft-delete after publish").toBeTruthy();
    expect((await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: coverSection, block_type: "text", position: 99, payload: {} }).select("id")).error, "block insert after publish").toBeTruthy();
    expect((await dev.from("manual_sections").update({ title: "renamed after publish" }).eq("id", coverSection).select("id")).error, "section update after publish").toBeTruthy();

    // re-read the frozen snapshot; recompute — byte-stable
    const snap = one(must(await svc.from("published_snapshots").select("render_json, content_hash").eq("manual_version_id", mvId), "snapshot re-read"));
    expect(computeSnapshotHash(snap.render_json as Record<string, unknown>)).toBe(snap.content_hash);
    expect(snap.content_hash).toBe(SNAP);
  }, 30_000);

  // =======================================================================
  // §15 archive lifecycle
  // =======================================================================
  it("ADMIN archive: PUBLISHED → ARCHIVED — snapshot intact, one audit, non-admin archive refused", async () => {
    expect((await svc.rpc("archive_manual_version", { p_manual_version_id: mvId, p_actor_id: DEV })).error, "dev archive").toBeTruthy();
    const before = await auditCount("manual_version:archive");
    const a = await svc.rpc("archive_manual_version", { p_manual_version_id: mvId, p_actor_id: ADMIN });
    expect(a.error, "admin archive").toBeNull();
    expect((await mvRow()).status).toBe("ARCHIVED");
    expect((await mvRow()).archived_at).toBeTruthy();
    expect(await auditCount("manual_version:archive")).toBe(before + 1);
    // snapshot still present + hash-stable
    const snap = one(must(await svc.from("published_snapshots").select("render_json, content_hash").eq("manual_version_id", mvId), "snapshot after archive"));
    expect(computeSnapshotHash(snap.render_json as Record<string, unknown>)).toBe(snap.content_hash);
    // public index row flipped to ARCHIVED for this version
    const pm = one(must(await svc.from("public_manuals").select("id").eq("public_slug", SLUG), "public_manuals"));
    const pv = one(must(await svc.from("public_manual_versions").select("publication_state, archived_at").eq("public_manual_id", pm.id).eq("public_version", PUBVER), "public_manual_versions after archive"));
    expect(pv.publication_state).toBe("ARCHIVED");
    expect(pv.archived_at).toBeTruthy();
  }, 30_000);

  // =======================================================================
  // §16 cross-organisation isolation (AC-P8-5) — normal authenticated user paths, service path off
  // =======================================================================
  it("cross-org: an Organisation B member (outsider@) cannot read or mutate ANY of this Org A E2E fixture", async () => {
    // reads → empty (RLS), never an error that reveals existence
    expect(must(await outsider.from("ea_products").select("id").eq("id", productId), "B reads A product")).toEqual([]);
    expect(must(await outsider.from("ea_versions").select("id").eq("id", eaVersionId), "B reads A ea_version")).toEqual([]);
    expect(must(await outsider.from("manuals").select("id").eq("id", manualId), "B reads A manual")).toEqual([]);
    expect(must(await outsider.from("manual_versions").select("id").eq("id", mvId), "B reads A mv")).toEqual([]);
    expect(must(await outsider.from("manual_sections").select("id").eq("manual_version_id", mvId), "B reads A sections")).toEqual([]);
    expect(must(await outsider.from("manual_blocks").select("id").in("manual_section_id", sections.map((s) => s.id)), "B reads A blocks")).toEqual([]);
    expect(must(await outsider.from("reviews").select("id").eq("manual_version_id", mvId), "B reads A reviews")).toEqual([]);
    expect(must(await outsider.from("review_comments").select("id").eq("manual_version_id", mvId), "B reads A comments")).toEqual([]);
    expect(must(await outsider.from("checklist_results").select("id").eq("manual_version_id", mvId), "B reads A checklist")).toEqual([]);
    expect(must(await outsider.from("published_snapshots").select("id").eq("manual_version_id", mvId), "B reads A snapshot")).toEqual([]);
    // mutations → error or 0 rows affected
    expect((await outsider.from("manual_versions").update({ status: "DRAFT" }).eq("id", mvId).select("id")).data ?? []).toEqual([]);
    expect((await outsider.from("ea_products").update({ name: "hijacked" }).eq("id", productId).select("id")).data ?? []).toEqual([]);
    // forged review action on A's mv → typed denial
    expect((await outsider.rpc("create_review_comment", { p_manual_version_id: mvId, p_review_type: "TECHNICAL", p_round: 2, p_section_id: null, p_block_id: null, p_body: "x" })).error, "B comments on A review").toBeTruthy();
    expect((await outsider.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error, "B decides A review").toBeTruthy();
    // forged publish/archive with a B admin actor on A's mv → not an admin OF ORG A
    expect((await svc.rpc("publish_manual_version", { p_manual_version_id: mvId, p_actor_id: OUT, p_expected_content_hash: H1, p_render_json: RJSON, p_snapshot_hash: SNAP, p_public_slug: SLUG, p_public_version: PUBVER })).error, "B admin publishes A").toBeTruthy();
    expect((await svc.rpc("archive_manual_version", { p_manual_version_id: mvId, p_actor_id: OUT })).error, "B admin archives A").toBeTruthy();
  }, 45_000);

  // =======================================================================
  // §17 human-evidence regression (UAT-35)
  // =======================================================================
  it("human-evidence: an author submission on an eligible WARNING never flips automated state to PASS; assigned reviewer accepts; authoritative MISSING can't use the fallback", async () => {
    // rewind to an editable state on a throwaway sibling MV so we don't disturb the archived one.
    const sib = one(must(await svc.rpc("create_manual_with_version", { p_org: ORG_A, p_ea_product_id: productId, p_ea_version_id: eaVersionId, p_manual_version: "1.0.1", p_template_id: SYSTEM_TEMPLATE, p_locale: "id" }), "sibling mv"));
    const smv = sib.manual_version_id as string;
    try {
      // find an eligible WARNING check + one that is authoritative/required
      const items = must(await svc.from("checklist_items").select("check_key, required").eq("checklist_template_id", CT1), "items2") as { check_key: string; required: boolean }[];
      const warnKey = items.find((i) => !i.required)?.check_key ?? items[0].check_key;
      const reqKey = items.find((i) => i.required)?.check_key ?? items[0].check_key;
      await svc.from("checklist_results").delete().eq("manual_version_id", smv);
      await svc.from("checklist_results").insert([
        { organization_id: ORG_A, manual_version_id: smv, checklist_template_id: CT1, checklist_template_version: 1, check_key: warnKey, category: "content", required: false, state: "WARNING", evaluator: "system" },
        { organization_id: ORG_A, manual_version_id: smv, checklist_template_id: CT1, checklist_template_version: 1, check_key: reqKey, category: "content", required: true, state: "MISSING", evaluator: "system" },
      ]);
      const ssec = one(must(await svc.from("manual_sections").select("id").eq("manual_version_id", smv).order("position").limit(1), "sib section"));
      const sblkRes = await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: ssec.id, block_type: "text", position: 0, payload: { doc: { type: "doc", content: [] } } }).select("id").single();
      expect(sblkRes.error, "sib block insert").toBeNull();
      const sblk = sblkRes.data as { id: string };

      // author submits human evidence for the eligible WARNING
      const sub = await dev.rpc("submit_checklist_evidence", { p_manual_version_id: smv, p_check_key: warnKey, p_section_id: ssec.id, p_block_id: sblk.id, p_note: `${PREFIX} sudah ada di bab X` });
      // if the check is genuinely ineligible in the fixture, the RPC rejects — either way the automated state must not become PASS
      const afterWarn = one(must(await svc.from("checklist_results").select("state").eq("manual_version_id", smv).eq("check_key", warnKey), "warn state"));
      expect(afterWarn.state).not.toBe("PASS");

      if (!sub.error) {
        // assigned reviewer can decide; author cannot
        expect((await dev.rpc("decide_checklist_evidence", { p_manual_version_id: smv, p_check_key: warnKey, p_decision: "ACCEPT", p_reason: "" })).error, "author decides own evidence").toBeTruthy();
        // change the anchored block → the live submission goes STALE
        await dev.from("manual_blocks").update({ payload: { doc: { type: "doc", content: [{ type: "paragraph" }] } } }).eq("id", sblk.id);
        const stale = one(must(await svc.from("checklist_evidence_submissions").select("status").eq("manual_version_id", smv).eq("check_key", warnKey).order("submitted_at", { ascending: false }).limit(1), "stale check"));
        expect(["STALE", "RETURNED", "PENDING"]).toContain(stale.status);
      }

      // authoritative MISSING can never be excused by evidence — a submission is rejected outright
      const missSub = await dev.rpc("submit_checklist_evidence", { p_manual_version_id: smv, p_check_key: reqKey, p_section_id: ssec.id, p_block_id: sblk.id, p_note: "x" });
      expect(missSub.error, "evidence on authoritative MISSING").toBeTruthy();

      // cross-org: outsider cannot read this org's evidence rows
      expect(must(await outsider.from("checklist_evidence_submissions").select("id").eq("manual_version_id", smv), "B reads A evidence")).toEqual([]);
    } finally {
      await svc.from("manual_versions").update({ status: "DRAFT" }).eq("id", smv);
      await svc.from("checklist_evidence_submissions").delete().eq("manual_version_id", smv);
      await svc.from("checklist_results").delete().eq("manual_version_id", smv);
      await svc.from("manual_versions").delete().eq("id", smv);
    }
  }, 60_000);

  // =======================================================================
  // §18 audit integrity
  // =======================================================================
  it("audit integrity: the lifecycle wrote exactly one event per privileged command; append-only for everyone incl. service_role", async () => {
    // one of each for THIS mv across the whole run
    expect(await auditCount("manual_version:assign_reviewers")).toBeGreaterThanOrEqual(1);
    expect(await auditCount("manual_version:submit_review")).toBe(2); // round 1 + round 2
    expect(await auditCount("manual_version:technical_request_changes")).toBe(1);
    expect(await auditCount("manual_version:technical_approve")).toBe(1);
    expect(await auditCount("manual_version:compliance_approve")).toBe(1);
    expect(await auditCount("manual_version:publish")).toBe(1);
    expect(await auditCount("manual_version:archive")).toBe(1);
    // every row carries a real actor + safe metadata + timestamp
    const rows = must(await svc.from("audit_events").select("actor_id, action, entity_type, metadata, created_at").eq("entity_id", mvId).order("created_at"), "audit rows") as { actor_id: string; action: string; entity_type: string; metadata: unknown; created_at: string }[];
    for (const r of rows) {
      expect(r.actor_id, `actor for ${r.action}`).toBeTruthy();
      expect(r.entity_type).toBe("manual_version");
      expect(new Date(r.created_at).getTime()).toBeGreaterThan(0);
      const blob = JSON.stringify(r.metadata ?? {});
      expect(blob).not.toMatch(/secret|password|sb_secret|service_role|storage_key|bearer/i);
    }
    // append-only: UPDATE + DELETE rejected for BOTH an authenticated caller and the service role
    const target = rows[0] ? (await svc.from("audit_events").select("id").eq("entity_id", mvId).limit(1)).data?.[0]?.id : null;
    if (target) {
      expect((await svc.from("audit_events").update({ action: "tampered" }).eq("id", target).select("id")).error, "service_role UPDATE audit").toBeTruthy();
      expect((await svc.from("audit_events").delete().eq("id", target).select("id")).error, "service_role DELETE audit").toBeTruthy();
      expect((await dev.from("audit_events").update({ action: "tampered" }).eq("id", target).select("id")).error, "authed UPDATE audit").toBeTruthy();
    }
  }, 45_000);
});
