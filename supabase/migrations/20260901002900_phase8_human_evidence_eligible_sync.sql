-- Phase 8 · UAT-35 — sync `checklist_items.human_evidence_eligible` with the SYSTEMATIC model.
--
-- Eligibility is `owner === "author" AND the rule is WARNING-capable` (see lib/validation/types.ts).
-- The resolved set for template v1: CHK-VERSI-DUA, CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES.
-- Migration 29 flagged only the latter two; this migration replaces that with the full set and
-- explicitly clears the flag on every other row, so the column is self-correcting and matches the
-- code exactly. Additive, idempotent, no data loss.
update checklist_items
  set human_evidence_eligible =
      (check_key in ('CHK-VERSI-DUA', 'CHK-INSTALL-AUTOTRADING', 'CHK-PACKAGE-FILES'));
