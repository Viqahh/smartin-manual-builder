-- Migration 32 · Phase 8A.5 follow-up — at-most-once creation for client-authored blocks.
--
-- Root cause (Manual Builder persistence race): the editor decides create-vs-update from a
-- React-deferred `blocksRef`, so a coalesced autosave that fires right after a `createBlock`
-- can run the CREATE path again before the new id is reconciled → a duplicate `manual_blocks`
-- row that the client abandons (orphan live row, reappears on reload).
--
-- The client fix reconciles the temp identity → persisted id synchronously. This migration is
-- the database-level backstop: one logical client-created block carries a stable `client_token`
-- (a UUID generated once when the draft is created, unchanged across debounce / autosave /
-- retry / re-render, never derived from content). A partial unique index makes a second insert
-- with the same token impossible; the create action recovers the existing row instead.
--
-- Legacy rows created before this migration have `client_token IS NULL` and are unconstrained
-- (the index is partial). Nothing is backfilled.

alter table manual_blocks
  add column if not exists client_token uuid;

comment on column manual_blocks.client_token is
  'Stable client-generated identity of one logical client-created block (Phase 8A.5). '
  'Set once at draft creation; resent on every create retry. NULL for rows created before '
  'migration 32 and for server-side inserts (clone/duplicate) that never race.';

-- At-most-once: for a given section, a non-null token may back exactly one LIVE block row.
-- Scoped to `deleted_at is null` so a soft-deleted draft frees its token (restore updates the
-- same row in place; it never re-inserts).
create unique index if not exists manual_blocks_section_client_token_uk
  on manual_blocks (manual_section_id, client_token)
  where client_token is not null and deleted_at is null;
