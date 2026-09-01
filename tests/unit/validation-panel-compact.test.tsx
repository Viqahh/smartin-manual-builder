// @vitest-environment jsdom
/**
 * §1 / §4 — the readiness inspector is compact by default: owner groups collapse (only the
 * highest-priority one open), each finding is a single line until expanded, PASS / N/A collapse.
 *
 * PLUS: the panel is bound to the current manual/version identity — navigating to another manual
 * fully resets it (no cross-manual state, count, grouped-finding, human-evidence, or
 * expand/collapse leakage), and it never renders raw evidence metadata.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { HumanEvidence, ItemResult, ValidationView, ChecklistState } from "@/lib/validation/types";

vi.mock("@/features/validation/actions", () => ({
  getValidation: vi.fn(async () => ({ ok: false, message: "unused" })),
  refreshValidation: vi.fn(async () => ({ ok: false, message: "unused" })),
  overrideChecklistItem: vi.fn(),
  submitChecklistEvidence: vi.fn(),
  decideChecklistEvidence: vi.fn(),
}));

import { ValidationPanel } from "@/features/validation/validation-panel";

const item = (
  checkKey: string,
  state: ChecklistState,
  label: string,
  extra: Partial<ItemResult> = {},
): ItemResult => ({
  checkKey,
  label,
  category: "identity",
  required: true,
  publishBlocking: false,
  state,
  systemState: state,
  evaluator: "system",
  reason: `Alasan untuk ${label}.`,
  // shape of a PERSISTED checklist_results.evidence blob — raw rule keys + internal `_` keys.
  evidence: { sectionId: "sec-1", has247: true, _reason: "internal copy", _systemState: state, _navigateSectionKey: "cover" },
  navigateSectionKey: "cover",
  override: null,
  humanEvidenceEligible: false,
  humanEvidence: null,
  ...extra,
});

// ---- manual A: 4 actionable across three owners, 2 pass, 1 NA
const viewA: ValidationView = {
  manualVersionId: "mv-A",
  templateId: "t",
  templateVersion: 1,
  pbkScope: "IN_SCOPE",
  items: [
    item("CHK-VERSI-MATCH", "WARNING", "Author A"),
    item("CHK-INSTALASI", "MISSING", "Author B"),
    item("CHK-CARA-KERJA", "WARNING", "Cara kerja EA"),
    item("CHK-KONTAK", "MISSING", "Kontak dukungan"),
    item("CHK-NO-PROHIBITED-CLAIMS", "PASS", "Lolos 1"),
    item("CHK-VERSI-DUA", "PASS", "Lolos 2"),
    item("CHK-PERIODE-EFEKTIF", "NOT_APPLICABLE", "NA 1"),
  ],
  score: { numerator: 2, denominator: 6, percent: 33 },
  eligibility: { ready: false, blockingReasons: ["Author B"] },
  counts: { PASS: 2, WARNING: 2, MISSING: 2, NOT_APPLICABLE: 1 } as Record<ChecklistState, number>,
  evaluatedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
};

// ---- manual B: DIFFERENT — one actionable (author only), a human-evidence submission pending,
//      more passes, different score/counts
const pendingEvidence: HumanEvidence = {
  id: "ev-b",
  status: "PENDING",
  automatedStateAtSubmit: "WARNING",
  submittedByName: "Dewi",
  submittedAt: new Date("2026-09-02T00:00:00Z").toISOString(),
  sectionId: "sec-x",
  sectionKey: "installation",
  blockId: null,
  note: "sudah dijelaskan",
  decidedByName: null,
  decidedAt: null,
  decisionReviewType: null,
  returnReason: null,
  isStale: false,
  effectiveResolution: null,
};
const viewB: ValidationView = {
  manualVersionId: "mv-B",
  templateId: "t",
  templateVersion: 1,
  pbkScope: "IN_SCOPE",
  items: [
    item("CHK-INSTALL-AUTOTRADING", "WARNING", "Algo Trading B", {
      humanEvidenceEligible: true,
      humanEvidence: pendingEvidence,
    }),
    item("CHK-VERSI-DUA", "PASS", "B Lolos 1"),
    item("CHK-VERSI-MATCH", "PASS", "B Lolos 2"),
    item("CHK-NO-PROHIBITED-CLAIMS", "PASS", "B Lolos 3"),
  ],
  score: { numerator: 3, denominator: 4, percent: 75 },
  eligibility: { ready: true, blockingReasons: [] },
  counts: { PASS: 3, WARNING: 1, MISSING: 0, NOT_APPLICABLE: 0 } as Record<ChecklistState, number>,
  evaluatedAt: new Date("2026-09-02T00:00:00Z").toISOString(),
};

const panel = (over: { manualId?: string; manualVersionId?: string; initial?: ValidationView; canReview?: boolean }) => {
  const initial = over.initial ?? viewA;
  return (
    <ValidationPanel
      manualId={over.manualId ?? "m1"}
      // default to the payload's own version so the PAYLOAD GUARD is not tripped by the fixture
      manualVersionId={over.manualVersionId ?? initial.manualVersionId}
      canReview={over.canReview ?? false}
      initial={initial}
      refreshNonce={0}
      onNavigateSection={() => {}}
    />
  );
};
const renderPanel = () => render(panel({}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ValidationPanel — compact by default", () => {
  it("shows '4 membutuhkan tindakan' and one owner-group button per non-empty owner", () => {
    renderPanel();
    expect(screen.getByText("membutuhkan tindakan").parentElement?.textContent).toContain("4");
    expect(screen.getByRole("button", { name: /Bisa kamu perbaiki/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Butuh data teknis/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Butuh Admin/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("only the highest-priority owner group renders its findings list initially", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /Author A/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cara kerja EA/ })).not.toBeInTheDocument();
  });

  it("a finding row is one line until expanded, then shows reason + owner CTA", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: /Author A/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Alasan untuk Author A.")).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Alasan untuk Author A.")).toBeInTheDocument();
    expect(screen.getByText(/Bisa kamu perbaiki langsung di bab terkait\./)).toBeInTheDocument();
  });

  it("an expanded finding never leaks raw evidence metadata into the UI", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Author A/ }));
    const text = document.body.textContent ?? "";
    for (const leak of ["has247", "_reason", "_systemState", "_navigateSectionKey", "sectionId", "sec-1"]) {
      expect(text, `evidence key "${leak}" must not appear in the panel`).not.toContain(leak);
    }
  });

  it("routes the CTA by owner — source-of-truth points at developer / source-of-truth", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Butuh data teknis/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cara kerja EA/ }));
    expect(screen.getByText(/data teknis EA yang dikonfirmasi developer \/ source-of-truth/)).toBeInTheDocument();
  });

  it("PASS and N/A checks are collapsed behind their own toggles", () => {
    renderPanel();
    const passToggle = screen.getByRole("button", { name: /pemeriksaan lainnya lolos/ });
    expect(passToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Lolos 1")).not.toBeInTheDocument();
    fireEvent.click(passToggle);
    expect(screen.getByText("Lolos 1")).toBeInTheDocument();

    const naToggle = screen.getByRole("button", { name: /tidak berlaku/ });
    expect(naToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /NA 1/ })).not.toBeInTheDocument();
  });

  it("'Lihat semua' opens every owner group + finding; 'Tutup semua' collapses them", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua" }));
    expect(screen.getByRole("button", { name: /Cara kerja EA/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Kontak dukungan/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Alasan untuk Cara kerja EA.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tutup semua" }));
    expect(screen.getByRole("button", { name: /Bisa kamu perbaiki/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Author A/ })).not.toBeInTheDocument();
  });
});

const withMv = (v: ValidationView, id: string): ValidationView => ({ ...v, manualVersionId: id });

describe("ValidationPanel — bound to manual/version identity (no cross-manual leakage)", () => {
  const idA = { manualId: "manual-A", manualVersionId: "mv-A", initial: viewA };
  const idB = { manualId: "manual-B", manualVersionId: "mv-B", initial: viewB };

  it("A → B: counts, grouped findings and human-evidence follow the new manual", () => {
    const { rerender } = render(panel(idA));
    expect(screen.getByRole("region").getAttribute("data-panel-manual-id")).toBe("manual-A");
    expect(screen.getByText("membutuhkan tindakan").parentElement?.textContent).toContain("4");
    expect(screen.getByRole("button", { name: /Author A/ })).toBeInTheDocument();

    rerender(panel(idB));
    const region = screen.getByRole("region");
    expect(region.getAttribute("data-panel-manual-id")).toBe("manual-B");
    expect(region.getAttribute("data-panel-version-id")).toBe("mv-B");
    // B's single actionable finding, none of A's
    expect(screen.getByText("membutuhkan tindakan").parentElement?.textContent).toContain("1");
    expect(screen.queryByRole("button", { name: /Author A/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kontak dukungan/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Algo Trading B/ })).toBeInTheDocument();
    // B's score + pass count
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pemeriksaan lainnya lolos/ }).textContent).toContain("3");
    // B's pending human-evidence surfaces
    fireEvent.click(screen.getByRole("button", { name: /Algo Trading B/ }));
    expect(screen.getByText(/Menunggu verifikasi reviewer/i)).toBeInTheDocument();
  });

  it("B → A: A's fuller state is fully restored, B's human-evidence is gone", () => {
    const { rerender } = render(panel(idB));
    rerender(panel(idA));
    expect(screen.getByRole("region").getAttribute("data-panel-manual-id")).toBe("manual-A");
    expect(screen.getByText("membutuhkan tindakan").parentElement?.textContent).toContain("4");
    expect(screen.getByRole("button", { name: /Author A/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Algo Trading B/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Menunggu verifikasi reviewer/i)).not.toBeInTheDocument();
  });

  it("expanded/collapsed state does NOT carry across a manual switch", () => {
    const { rerender } = render(panel(idA));
    // open every disclosure on A
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua" }));
    fireEvent.click(screen.getByRole("button", { name: /pemeriksaan lainnya lolos/ }));
    expect(screen.getByRole("button", { name: /Author A/ })).toHaveAttribute("aria-expanded", "true");

    rerender(panel(idB));
    // B starts compact again: only its top owner group open, its one finding collapsed, pass list hidden
    expect(screen.getByRole("button", { name: /Bisa kamu perbaiki/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Algo Trading B/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /pemeriksaan lainnya lolos/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("B Lolos 1")).not.toBeInTheDocument();
  });

  it("same manualId but a NEW manualVersionId also resets the panel", () => {
    const { rerender } = render(panel({ manualId: "same", manualVersionId: "v1", initial: withMv(viewA, "v1") }));
    expect(screen.getByText("membutuhkan tindakan").parentElement?.textContent).toContain("4");
    rerender(panel({ manualId: "same", manualVersionId: "v2", initial: withMv(viewB, "v2") }));
    expect(screen.getByRole("region").getAttribute("data-panel-version-id")).toBe("v2");
    expect(screen.getByText("membutuhkan tindakan").parentElement?.textContent).toContain("1");
    expect(screen.queryByRole("button", { name: /Author A/ })).not.toBeInTheDocument();
  });

  it("PAYLOAD GUARD: a `view` computed for the WRONG version is never rendered — it is dropped and re-fetched", async () => {
    const { getValidation } = await import("@/features/validation/actions");
    (getValidation as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      ok: true,
      data: withMv(viewB, "correct-mv"), // server returns the RIGHT manual's payload
    });
    // panel bound to "correct-mv" but handed manual A's payload (stamped "mv-A")
    render(panel({ manualId: "same", manualVersionId: "correct-mv", initial: withMv(viewA, "mv-A") }));
    // A's findings must NOT be on screen — the wrong payload was discarded
    expect(screen.queryByRole("button", { name: /Author A/ })).not.toBeInTheDocument();
    expect(getValidation).toHaveBeenCalledWith({ manualId: "same" });
    // after the re-fetch resolves, B's (correct) data renders
    expect(await screen.findByRole("button", { name: /Algo Trading B/ })).toBeInTheDocument();
    expect(screen.getByRole("region").getAttribute("data-view-version-id")).toBe("correct-mv");
  });

  it("no raw evidence metadata in either manual, with every finding expanded", () => {
    const { rerender } = render(panel(idA));
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua" }));
    let text = document.body.textContent ?? "";
    for (const leak of ["has247", "_reason", "_systemState", "_navigateSectionKey", "sectionId"]) {
      expect(text, `A: "${leak}"`).not.toContain(leak);
    }
    rerender(panel(idB));
    fireEvent.click(screen.getByRole("button", { name: /Algo Trading B/ }));
    text = document.body.textContent ?? "";
    for (const leak of ["has247", "_reason", "_systemState", "_navigateSectionKey", "sectionId"]) {
      expect(text, `B: "${leak}"`).not.toContain(leak);
    }
  });
});

describe("ValidationPanel — 'Sudah ada di manual' only on an eligible prose-detection WARNING", () => {
  const mkView = (items: ItemResult[]): ValidationView => ({
    manualVersionId: "mv-e",
    templateId: "t",
    templateVersion: 1,
    pbkScope: "IN_SCOPE",
    items,
    score: { numerator: 0, denominator: items.length, percent: 0 },
    eligibility: { ready: true, blockingReasons: [] },
    counts: { PASS: 0, WARNING: items.filter((i) => i.state === "WARNING").length, MISSING: 0, NOT_APPLICABLE: 0 } as Record<
      ChecklistState,
      number
    >,
    evaluatedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
  });
  const expand = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

  it("a genuine prose-detection WARNING (Algo Trading) SHOWS the button", () => {
    render(
      panel({
        manualId: "m-e",
        manualVersionId: "mv-e",
        initial: mkView([
          item("CHK-INSTALL-AUTOTRADING", "WARNING", "Instruksi Algo Trading", { humanEvidenceEligible: true }),
        ]),
      }),
    );
    expand(/Instruksi Algo Trading/);
    expect(screen.getByRole("button", { name: "Sudah ada di manual" })).toBeInTheDocument();
  });

  it("an invalid-SemVer WARNING (CHK-VERSI-DUA) does NOT show the button", () => {
    render(
      panel({
        manualId: "m-e",
        manualVersionId: "mv-e",
        initial: mkView([
          // author-owned WARNING, but humanEvidenceEligible is false (data-quality, not a prose miss)
          item("CHK-VERSI-DUA", "WARNING", "Versi EA & versi manual ditampilkan terpisah", {
            humanEvidenceEligible: false,
          }),
        ]),
      }),
    );
    expand(/Versi EA & versi manual/);
    expect(screen.queryByRole("button", { name: "Sudah ada di manual" })).not.toBeInTheDocument();
  });

  it("a MISSING never shows the button, even for an eligible check", () => {
    render(
      panel({
        manualId: "m-e",
        manualVersionId: "mv-e",
        initial: mkView([
          item("CHK-INSTALL-AUTOTRADING", "MISSING", "Instruksi Algo Trading", { humanEvidenceEligible: true }),
        ]),
      }),
    );
    expand(/Instruksi Algo Trading/);
    expect(screen.queryByRole("button", { name: "Sudah ada di manual" })).not.toBeInTheDocument();
  });

  it("PASS shows no button", () => {
    render(
      panel({
        manualId: "m-e",
        manualVersionId: "mv-e",
        initial: mkView([
          item("CHK-INSTALL-AUTOTRADING", "PASS", "Instruksi Algo Trading", { humanEvidenceEligible: true }),
        ]),
      }),
    );
    expect(screen.queryByRole("button", { name: "Sudah ada di manual" })).not.toBeInTheDocument();
  });
});
