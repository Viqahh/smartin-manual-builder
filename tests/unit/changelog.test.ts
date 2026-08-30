/**
 * Phase 6 slice 4 — structured changelog: schema validation, Pasal 8 reminder applicability,
 * and the review-fingerprint's changelog inclusion (§11 A–I, §23).
 */
import { describe, it, expect } from "vitest";
import { computeContentFingerprint } from "@/lib/reviews/fingerprint";
import type { FingerprintChangelogEntry } from "@/lib/reviews/fingerprint";
import { changelogEntrySchema } from "@/features/changelog/schema";
import { pasal8ReminderApplies } from "@/lib/changelog/reminder";
import { makeVm, passingContent, passingGroups, passingSupport } from "./_validation-fixtures";

const vm = () =>
  makeVm({ content: passingContent(), groups: passingGroups, support: passingSupport, requirements: { pbkScope: "IN_SCOPE" } });

const entry = (over: Partial<FingerprintChangelogEntry> = {}): FingerprintChangelogEntry => ({
  position: 0,
  entryType: "ADDED",
  body: "Menambahkan filter berita.",
  sourceEaVersionId: "e0000000-0000-4000-8000-00000000000e",
  isFeatureChange: false,
  openPositionImpact: null,
  ...over,
});

const hash = (changelog: FingerprintChangelogEntry[]) => computeContentFingerprint({ vm: vm(), changelog });

describe("review fingerprint — changelog inclusion (§11)", () => {
  it("A. same manual + same changelog → same fingerprint", () => {
    expect(hash([entry()])).toBe(hash([entry()]));
  });

  it("B. adding a changelog entry changes the hash", () => {
    expect(hash([entry()])).not.toBe(hash([entry(), entry({ position: 1, body: "Perbaikan lain." })]));
  });

  it("C. changing a changelog body changes the hash", () => {
    expect(hash([entry({ body: "A" })])).not.toBe(hash([entry({ body: "B" })]));
  });

  it("D. changing entry_type changes the hash", () => {
    expect(hash([entry({ entryType: "ADDED" })])).not.toBe(hash([entry({ entryType: "CHANGED" })]));
  });

  it("E. changing source_ea_version_id changes the hash", () => {
    expect(hash([entry({ sourceEaVersionId: "e0000000-0000-4000-8000-00000000000e" })])).not.toBe(
      hash([entry({ sourceEaVersionId: "e0000000-0000-4000-8000-00000000000f" })]),
    );
  });

  it("F. changing is_feature_change changes the hash", () => {
    expect(hash([entry({ isFeatureChange: false })])).not.toBe(hash([entry({ isFeatureChange: true })]));
  });

  it("G. changing open_position_impact changes the hash", () => {
    expect(hash([entry({ entryType: "BREAKING", openPositionImpact: "Tutup posisi dulu." })])).not.toBe(
      hash([entry({ entryType: "BREAKING", openPositionImpact: "Tidak ada dampak." })]),
    );
  });

  it("H. reordering changelog entries changes the hash", () => {
    const a = [entry({ position: 0, body: "satu" }), entry({ position: 1, body: "dua" })];
    const b = [entry({ position: 0, body: "dua" }), entry({ position: 1, body: "satu" })];
    expect(hash(a)).not.toBe(hash(b));
  });

  it("the authoritative path (vm.changelog, no explicit param) is included in the hash", () => {
    const withNone = vm();
    withNone.changelog = [];
    const withOne = vm();
    withOne.changelog = [
      { id: "cl-x", position: 0, entryType: "ADDED", body: "fitur", sourceEaVersionId: null, isFeatureChange: true, openPositionImpact: null },
    ];
    expect(computeContentFingerprint({ vm: withNone })).not.toBe(computeContentFingerprint({ vm: withOne }));
    // an explicit changelog arg still wins over vm.changelog
    expect(computeContentFingerprint({ vm: withOne, changelog: [] })).toBe(computeContentFingerprint({ vm: withNone }));
  });

  it("I. the projection is semantic — a DB row id / volatile field is not part of the hash", () => {
    // the fingerprint input carries no id or timestamp; two entries differing only by an extra
    // (ignored) field hash identically
    const withId = [{ ...entry(), id: "row-1", updatedAt: "2026-01-01" } as unknown as FingerprintChangelogEntry];
    const withOtherId = [{ ...entry(), id: "row-2", updatedAt: "2027-09-09" } as unknown as FingerprintChangelogEntry];
    expect(hash(withId)).toBe(hash(withOtherId));
    expect(hash(withId)).toBe(hash([entry()]));
  });
});

describe("changelog schema (§23, slice-5 source now mandatory)", () => {
  const SRC = "e0000000-0000-4000-8000-00000000000e";

  it("accepts a valid ADDED entry and trims the body", () => {
    const r = changelogEntrySchema.safeParse({ entryType: "ADDED", body: "  fitur baru  ", sourceEaVersionId: SRC });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe("fitur baru");
  });

  it("rejects an empty / whitespace body", () => {
    expect(changelogEntrySchema.safeParse({ entryType: "ADDED", body: "   ", sourceEaVersionId: SRC }).success).toBe(false);
  });

  it("rejects a missing / null source EA version (PRD-VER-006)", () => {
    expect(changelogEntrySchema.safeParse({ entryType: "ADDED", body: "x" }).success).toBe(false);
    expect(changelogEntrySchema.safeParse({ entryType: "ADDED", body: "x", sourceEaVersionId: null }).success).toBe(false);
  });

  it("BREAKING requires a non-empty open-position impact", () => {
    expect(changelogEntrySchema.safeParse({ entryType: "BREAKING", body: "ubah SL", sourceEaVersionId: SRC }).success).toBe(false);
    expect(
      changelogEntrySchema.safeParse({ entryType: "BREAKING", body: "ubah SL", sourceEaVersionId: SRC, openPositionImpact: "   " }).success,
    ).toBe(false);
    const ok = changelogEntrySchema.safeParse({
      entryType: "BREAKING",
      body: "ubah SL",
      sourceEaVersionId: SRC,
      openPositionImpact: "Tutup posisi terbuka sebelum update.",
    });
    expect(ok.success).toBe(true);
  });

  it("non-BREAKING impact is optional", () => {
    expect(changelogEntrySchema.safeParse({ entryType: "FIXED", body: "perbaiki bug", sourceEaVersionId: SRC }).success).toBe(true);
  });

  it("rejects an unknown entry type", () => {
    expect(changelogEntrySchema.safeParse({ entryType: "REMOVED", body: "x", sourceEaVersionId: SRC }).success).toBe(false);
  });
});

describe("Pasal 8 reminder applicability (§23, PRD-OQ-010)", () => {
  it("IN_SCOPE + a feature-change entry → reminder", () => {
    expect(pasal8ReminderApplies("IN_SCOPE", [{ isFeatureChange: true }])).toBe(true);
  });
  it("IN_SCOPE + no feature-change entry → no reminder", () => {
    expect(pasal8ReminderApplies("IN_SCOPE", [{ isFeatureChange: false }])).toBe(false);
    expect(pasal8ReminderApplies("IN_SCOPE", [])).toBe(false);
  });
  it("OUT_OF_SCOPE + a feature-change entry → no PBK reminder", () => {
    expect(pasal8ReminderApplies("OUT_OF_SCOPE", [{ isFeatureChange: true }])).toBe(false);
  });
});
