-- Phase 8 · UAT-35 — re-audit `checklist_items.human_evidence_eligible`.
--
-- Eligibility is now an EXPLICIT per-rule audit (lib/validation/types.ts::HUMAN_EVIDENCE_ELIGIBLE),
-- NOT "author-owned AND WARNING-capable". CHK-VERSI-DUA is re-classified INELIGIBLE: its WARNING is
-- an invalid-SemVer / malformed-version-data defect, not a prose-detection false negative — no
-- chapter a reviewer could read makes an invalid version string valid.
--
-- Resolved eligible set for template v1: CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES.
-- (Supersedes migration 30, which had added CHK-VERSI-DUA.) Additive, idempotent, self-correcting.
update checklist_items
  set human_evidence_eligible =
      (check_key in ('CHK-INSTALL-AUTOTRADING', 'CHK-PACKAGE-FILES'));
