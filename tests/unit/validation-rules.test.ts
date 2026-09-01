/**
 * Phase 5 — deterministic checklist rule matrix (AC-P5-4/5, PRD-COMP-002/005, spec §38/§39/§43/§44).
 *
 * Template v1 carries all 31 items (PRD-OQ-004 final). Every required check has a FAILING fixture
 * and a PASSING fixture. Pure — no DB, no network, no LLM. Fixtures are self-contained.
 */

import { describe, it, expect } from "vitest";
import type { ManualViewModel } from "@/lib/manual/view-model";
import { CHECKLIST_V1, RULES, RULE_KEYS } from "@/lib/validation/rules";
import { evaluateManual } from "@/lib/validation/evaluate";
import {
  makeVm,
  passingContent,
  passingGroups,
  passingSupport,
  textBlock,
  calloutBlock,
  paramTableBlock,
  stepsBlock,
  imageBlock,
} from "./_validation-fixtures";

const base = (extra: Parameters<typeof makeVm>[0] = {}) =>
  makeVm({ content: passingContent(), support: passingSupport, groups: passingGroups, requirements: { pbkScope: "IN_SCOPE" }, ...extra });

const evalKey = (vm: ManualViewModel, key: string) => {
  const view = evaluateManual(vm, CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
  const item = view.items.find((i) => i.checkKey === key);
  if (!item) throw new Error(`no item ${key}`);
  return item;
};

/** Same fixture, one chapter mutated. */
const withChapter = (key: string, blocks: ReturnType<typeof textBlock>[] | undefined, extra: Parameters<typeof makeVm>[0] = {}) => {
  const c = passingContent();
  if (blocks === undefined) delete c[key];
  else c[key] = blocks;
  return base({ content: c, ...extra });
};

// ===========================================================================
// Template membership / integrity (AC-P5-13, drift guard §9)
// ===========================================================================
describe("checklist v1 template membership (PRD-OQ-004)", () => {
  const EXPECTED = [
    "CHK-VERSI-DUA", "CHK-VERSI-MATCH", "CHK-DEV-LEGAL", "CHK-INSTALASI", "CHK-INSTALL-AUTOTRADING",
    "CHK-DEPENDENCIES-LISTED", "CHK-PACKAGE-FILES", "CHK-CARA-KERJA", "CHK-SPECIAL-CONDITIONS", "CHK-SETTING",
    "CHK-PARAM-COMPLETE", "CHK-PARAM-DEFAULT-MATCH", "CHK-UNITS-DEFINED", "CHK-QUICKSTART-DEMO", "CHK-SAFE-STOP",
    "CHK-DISCLAIMER-5-5-D", "CHK-RISK-GENERAL", "CHK-PAST-NOT-FUTURE", "CHK-DANGER-MODE-WARN", "CHK-NO-PROHIBITED-CLAIMS",
    "CHK-KONTAK", "CHK-KONTAK-SPLIT", "CHK-TRANSPARANSI", "CHK-BAHASA-ALGO", "CHK-PERIODE-EFEKTIF",
    "CHK-PERFORMANCE-KONDISI", "CHK-CHANGELOG-VERSI", "CHK-DISCLOSURE-REF", "CHK-ONBOARDING-MARGIN",
    "CHK-FITUR-DIJELASKAN", "CHK-INTERFACE",
  ];

  it("contains exactly the 31 decided check ids, in order", () => {
    expect(CHECKLIST_V1.map((i) => i.checkKey)).toEqual(EXPECTED);
  });
  it("has no duplicate check ids", () => {
    expect(new Set(CHECKLIST_V1.map((i) => i.checkKey)).size).toBe(CHECKLIST_V1.length);
  });
  it("positions are 0..30 with no gaps", () => {
    expect(CHECKLIST_V1.map((i) => i.position)).toEqual(Array.from({ length: 31 }, (_, i) => i));
  });
  it("drift guard: every template rule_key maps to a registered evaluator", () => {
    for (const item of CHECKLIST_V1) {
      expect(RULES[item.ruleKey], `no evaluator for ${item.checkKey} (rule_key=${item.ruleKey})`).toBeTypeOf("function");
    }
  });
  it("drift guard: every registered evaluator is used by exactly one item", () => {
    const used = CHECKLIST_V1.map((i) => i.ruleKey).sort();
    expect([...RULE_KEYS].sort()).toEqual(used);
  });
  it("only CHK-PACKAGE-FILES is not required; the bappebti_only set is the seven scoped items", () => {
    expect(CHECKLIST_V1.filter((i) => !i.required).map((i) => i.checkKey)).toEqual(["CHK-PACKAGE-FILES"]);
    expect(CHECKLIST_V1.filter((i) => i.bappebtiOnly).map((i) => i.checkKey)).toEqual([
      "CHK-DISCLAIMER-5-5-D", "CHK-KONTAK", "CHK-TRANSPARANSI", "CHK-BAHASA-ALGO", "CHK-PERIODE-EFEKTIF",
      "CHK-DISCLOSURE-REF", "CHK-ONBOARDING-MARGIN",
    ]);
  });
});

describe("no item silently defaults to PASS (§9 J)", () => {
  it("an all-empty manual: every content check is MISSING, none is a blanket PASS or unknown-rule", () => {
    const vm = makeVm({ content: {}, support: {}, groups: [], requirements: { pbkScope: "IN_SCOPE" } });
    const view = evaluateManual(vm, CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
    expect(view.items.every((i) => !i.reason.includes("Aturan tidak dikenal"))).toBe(true);
    for (const key of ["CHK-INSTALASI", "CHK-CARA-KERJA", "CHK-SETTING", "CHK-DISCLAIMER-5-5-D", "CHK-KONTAK", "CHK-CHANGELOG-VERSI", "CHK-TRANSPARANSI"]) {
      expect(view.items.find((i) => i.checkKey === key)!.state, key).toBe("MISSING");
    }
    expect(view.items.filter((i) => i.state === "MISSING").length).toBeGreaterThan(15);
    // The only PASSes an all-empty-CONTENT manual can earn are the metadata / "nothing contradicts"
    // checks that do not depend on chapter body: the two version-metadata checks (§2 — EA + manual
    // version are two valid semver fields, values may match) and the two "nothing prohibited" scans.
    expect(view.items.filter((i) => i.state === "PASS").map((i) => i.checkKey).sort()).toEqual(
      ["CHK-NO-PROHIBITED-CLAIMS", "CHK-VERSI-DUA", "CHK-VERSI-MATCH"],
    );
  });
});

// ===========================================================================
// The all-pass fixture
// ===========================================================================
describe("passingContent() — every v1 item is PASS or NOT_APPLICABLE", () => {
  it("no MISSING, no WARNING", () => {
    const view = evaluateManual(base(), CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
    const bad = view.items.filter((i) => i.state === "MISSING" || i.state === "WARNING");
    expect(bad.map((b) => `${b.checkKey}:${b.state}`)).toEqual([]);
    expect(view.score.percent).toBe(100);
    expect(view.eligibility.ready).toBe(true);
  });
});

// ===========================================================================
// AC-P5-4 — nine machine-checkable checks, fail -> pass
// ===========================================================================
describe("CHK-INSTALASI (PRD-COMP-002 — cara instalasi)", () => {
  it("MISSING when the installation chapter has no ordered steps block", () => {
    expect(evalKey(withChapter("installation", [textBlock("Salin file lalu jalankan.")]), "CHK-INSTALASI").state).toBe("MISSING");
  });
  it("MISSING when the steps block has fewer than 5 steps", () => {
    expect(evalKey(withChapter("installation", [stepsBlock(["a", "b", "c"])]), "CHK-INSTALASI").state).toBe("MISSING");
  });
  it("PASS with a >=5-step block that names the Data Folder / Navigator path", () => {
    expect(evalKey(base(), "CHK-INSTALASI").state).toBe("PASS");
  });
});

describe("CHK-INSTALL-AUTOTRADING (PRD-COMP-002)", () => {
  it("MISSING when Algo Trading is never mentioned in installation", () => {
    expect(
      evalKey(withChapter("installation", [stepsBlock(["1", "2", "3", "4", "5", "6 open data folder navigator refresh"])]), "CHK-INSTALL-AUTOTRADING").state,
    ).toBe("MISSING");
  });
  it("PASS when Algo Trading + Allow Algo Trading + smiley are covered", () => {
    expect(evalKey(base(), "CHK-INSTALL-AUTOTRADING").state).toBe("PASS");
  });
});

describe("CHK-CARA-KERJA (PRD-COMP-002 — cara kerja)", () => {
  it("MISSING when how-it-works is thin", () => {
    expect(evalKey(withChapter("how-it-works", [textBlock("EA pakai MA.")]), "CHK-CARA-KERJA").state).toBe("MISSING");
  });
  it("PASS when entry / management / exit are all described", () => {
    expect(evalKey(base(), "CHK-CARA-KERJA").state).toBe("PASS");
  });
});

describe("CHK-SPECIAL-CONDITIONS (CONTENT_REQUIREMENTS §6)", () => {
  it("MISSING when none of the five special conditions are answered", () => {
    expect(
      evalKey(
        withChapter("how-it-works", [textBlock("Kondisi masuk MA cross. Kondisi keluar TP atau SL. Manajemen posisi tunggal. ".repeat(3))]),
        "CHK-SPECIAL-CONDITIONS",
      ).state,
    ).toBe("MISSING");
  });
  it("PASS when at least four of five are answered", () => {
    expect(evalKey(base(), "CHK-SPECIAL-CONDITIONS").state).toBe("PASS");
  });
});

describe("CHK-SETTING (PRD-COMP-002 — cara setting)", () => {
  it("MISSING when the parameters chapter has neither a linked parameterTable nor settings prose", () => {
    expect(evalKey(withChapter("parameters", [textBlock("Atur sesuai selera.")]), "CHK-SETTING").state).toBe("MISSING");
  });
  it("PASS with a parameterTable that references a linked EA-Version group", () => {
    expect(evalKey(base(), "CHK-SETTING").state).toBe("PASS");
  });
});

describe("CHK-PARAM-COMPLETE", () => {
  it("MISSING when a group with parameters is not referenced by any parameterTable", () => {
    expect(evalKey(withChapter("parameters", [textBlock("Lihat tabel.")]), "CHK-PARAM-COMPLETE").state).toBe("MISSING");
  });
  it("MISSING when the parameterTable references only a foreign group id", () => {
    expect(evalKey(withChapter("parameters", [paramTableBlock(["grp-FOREIGN"])]), "CHK-PARAM-COMPLETE").state).toBe("MISSING");
  });
  it("PASS when every EA parameter group is referenced by a linked-EA-Version parameterTable", () => {
    expect(evalKey(base(), "CHK-PARAM-COMPLETE").state).toBe("PASS");
  });
});

describe("CHK-PARAM-DEFAULT-MATCH", () => {
  it("WARNING when prose states a default that disagrees with the EA definition", () => {
    const vm = withChapter("parameters", [paramTableBlock(["grp-0"]), textBlock("Catatan: FixedLot default 0.5 pada akun besar.", 1)]);
    const r = evalKey(vm, "CHK-PARAM-DEFAULT-MATCH");
    expect(r.state).toBe("WARNING");
    expect(JSON.stringify(r.evidence)).toContain("FixedLot");
  });
  it("PASS when no conflicting stated default appears", () => {
    expect(evalKey(base(), "CHK-PARAM-DEFAULT-MATCH").state).toBe("PASS");
  });
});

describe("CHK-UNITS-DEFINED", () => {
  it("WARNING when 'pip' is used without a definition", () => {
    const c = passingContent();
    c["how-it-works"] = [textBlock("Jarak trailing 20 pip dari harga entry masuk keluar tutup posisi.")];
    expect(evalKey(base({ content: c }), "CHK-UNITS-DEFINED").state).toBe("WARNING");
  });
  it("PASS when the unit is defined (mentions _Point)", () => {
    const c = passingContent();
    c.parameters = [paramTableBlock(["grp-0"]), textBlock("Jarak dinyatakan dalam poin mengikuti _Point; pada 5 digit 200 poin = 20 pip.", 1)];
    expect(evalKey(base({ content: c }), "CHK-UNITS-DEFINED").state).toBe("PASS");
  });
  it("NOT_APPLICABLE when the manual uses no points/pips term", () => {
    expect(evalKey(base(), "CHK-UNITS-DEFINED").state).toBe("NOT_APPLICABLE");
  });
});

describe("CHK-VERSI-MATCH (PRD-VER-003)", () => {
  it("MISSING when the text names a different EA version", () => {
    const vm = withChapter("changelog", [textBlock("EA versi 2.5.0 memperkenalkan mode baru.")], { eaVersion: "1.0.0" });
    const r = evalKey(vm, "CHK-VERSI-MATCH");
    expect(r.state).toBe("MISSING");
    expect(String(r.evidence.conflictingVersions)).toContain("2.5.0");
  });
  it("PASS when no conflicting EA version is mentioned", () => {
    expect(evalKey(base({ eaVersion: "1.2.0" }), "CHK-VERSI-MATCH").state).toBe("PASS");
  });
});

describe("CHK-PERFORMANCE-KONDISI (PRD-CNT-008)", () => {
  it("WARNING when a performance figure appears without test conditions", () => {
    expect(evalKey(withChapter("performance", [textBlock("Win rate 92% pada pengujian internal kami.")]), "CHK-PERFORMANCE-KONDISI").state).toBe("WARNING");
  });
  it("PASS when the figure carries broker/spread/model/date-range/deposit context", () => {
    expect(
      evalKey(
        withChapter("performance", [textBlock("Win rate 62% (broker Exness, spread 15 poin, model setiap tick, periode Jan 2024 sampai Jun 2024, deposit USD 1000).")]),
        "CHK-PERFORMANCE-KONDISI",
      ).state,
    ).toBe("PASS");
  });
  it("NOT_APPLICABLE when no performance figure is shown", () => {
    expect(evalKey(base(), "CHK-PERFORMANCE-KONDISI").state).toBe("NOT_APPLICABLE");
  });
});

describe("CHK-DANGER-MODE-WARN", () => {
  it("MISSING when the EA declares a danger mode but the risk chapter has no top warning callout", () => {
    const vm = withChapter("risk", [textBlock("Manajemen dana wajar.")], { requirements: { dangerMode: true } });
    expect(evalKey(vm, "CHK-DANGER-MODE-WARN").state).toBe("MISSING");
  });
  it("PASS when the risk chapter opens with a warning callout", () => {
    const vm = withChapter(
      "risk",
      [calloutBlock("warning", "PERINGATAN: EA memakai martingale — drawdown bisa besar.", 0), textBlock("Detail.", 1)],
      { requirements: { dangerMode: true } },
    );
    expect(evalKey(vm, "CHK-DANGER-MODE-WARN").state).toBe("PASS");
  });
  it("NOT_APPLICABLE when the EA declares no danger mode", () => {
    expect(evalKey(base(), "CHK-DANGER-MODE-WARN").state).toBe("NOT_APPLICABLE");
  });
});

// ===========================================================================
// AC-P5-5 — claim aggregate
// ===========================================================================
describe("CHK-NO-PROHIBITED-CLAIMS (AC-P5-5, §39)", () => {
  it("PASS on a clean manual", () => {
    expect(evalKey(base(), "CHK-NO-PROHIBITED-CLAIMS").state).toBe("PASS");
  });
  it("WARNING when a §4 prohibited claim is present; publish-blocking categories marked; text unchanged", () => {
    const vm = withChapter("overview", [textBlock("EA ini menjamin profit pasti tanpa risiko setiap hari.")]);
    const before = JSON.stringify(vm.sections);
    const r = evalKey(vm, "CHK-NO-PROHIBITED-CLAIMS");
    expect(r.state).toBe("WARNING");
    expect((r.evidence.publishBlockingCategories as string[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(vm.sections)).toBe(before);
  });
});

// ===========================================================================
// PRD-COMP-002 — the four mandatory manual elements are all evaluated
// ===========================================================================
describe("PRD-COMP-002 — four mandatory elements exist as evaluated items", () => {
  it("cara kerja / cara instalasi / cara setting / kontak all resolve to a real state", () => {
    const view = evaluateManual(base(), CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
    for (const key of ["CHK-CARA-KERJA", "CHK-INSTALASI", "CHK-SETTING", "CHK-KONTAK"]) {
      const it = view.items.find((i) => i.checkKey === key)!;
      expect(["PASS", "WARNING", "MISSING", "NOT_APPLICABLE"]).toContain(it.state);
      expect(it.evaluator).toBe("system");
    }
  });
});

describe("CHK-KONTAK (PRD-COMP-002)", () => {
  it("MISSING when EA Version has no support channel", () => {
    expect(evalKey(base({ support: {} }), "CHK-KONTAK").state).toBe("MISSING");
  });
  it("WARNING when a channel exists but no 24/7 statement is present", () => {
    const vm = withChapter("support", [textBlock("Email support@test.demo. Jam kerja Senin-Jumat 09.00-17.00.")], {
      support: { email: "support@test.demo", hours: "Senin-Jumat" },
    });
    expect(evalKey(vm, "CHK-KONTAK").state).toBe("WARNING");
  });
  it("PASS with a real channel + a 24/7 availability statement", () => {
    expect(evalKey(base(), "CHK-KONTAK").state).toBe("PASS");
  });
});

// ===========================================================================
// PRD-COMP-005 — referenced obligations (fail/pass or scope)
// ===========================================================================
describe("CHK-DEV-LEGAL (PRD-COMP-005)", () => {
  it("MISSING for a third-party developer with no cooperation note", () => {
    const vm = base({ organization: "PT Klien Mandiri", developer: { name: "Rekanan Dev" } });
    expect(evalKey(vm, "CHK-DEV-LEGAL").state).toBe("MISSING");
  });
  it("PASS when the third-party developer + cooperation note appear", () => {
    const c = passingContent();
    c.transparency = [
      textBlock(
        "Strategi memakai MA cross sebagai sistem trading. Algoritma ditulis dalam Bahasa Indonesia. Periode efektif 12 bulan. EA dikembangkan oleh Rekanan Dev melalui perjanjian kerja sama lisensi pengembang dengan PT Klien Mandiri.",
      ),
    ];
    const vm = base({ content: c, organization: "PT Klien Mandiri", developer: { name: "Rekanan Dev" } });
    expect(evalKey(vm, "CHK-DEV-LEGAL").state).toBe("PASS");
  });
  it("PASS (self-built) when org is Smartin and the cover names it", () => {
    expect(evalKey(base(), "CHK-DEV-LEGAL").state).toBe("PASS");
  });
});

describe("CHK-TRANSPARANSI (PRD-COMP-005)", () => {
  it("MISSING when the transparency chapter is thin", () => {
    expect(evalKey(withChapter("transparency", [textBlock("Rahasia.")]), "CHK-TRANSPARANSI").state).toBe("MISSING");
  });
  it("PASS with a plain-language strategy description", () => {
    expect(evalKey(base(), "CHK-TRANSPARANSI").state).toBe("PASS");
  });
});

describe("CHK-BAHASA-ALGO (PRD-COMP-005)", () => {
  it("MISSING when the algorithm language is never stated", () => {
    expect(
      evalKey(
        withChapter("transparency", [
          textBlock("Strategi memakai MA cross dan RSI sebagai sistem trading utama, konsisten dengan cara kerja. Periode efektif dua belas bulan sejak aktivasi lisensi advisory."),
        ]),
        "CHK-BAHASA-ALGO",
      ).state,
    ).toBe("MISSING");
  });
  it("PASS when it states Bahasa Indonesia / English", () => {
    expect(evalKey(base(), "CHK-BAHASA-ALGO").state).toBe("PASS");
  });
});

describe("CHK-PERIODE-EFEKTIF (PRD-COMP-005)", () => {
  it("MISSING when no effective period is stated", () => {
    expect(
      evalKey(
        withChapter("transparency", [
          textBlock("Strategi memakai MA cross dan RSI sebagai sistem trading. Algoritma ditulis dalam Bahasa Indonesia. Deskripsi cukup panjang untuk memenuhi ambang isi minimal bab transparansi ini."),
        ]),
        "CHK-PERIODE-EFEKTIF",
      ).state,
    ).toBe("MISSING");
  });
  it("PASS when the effective period is stated", () => {
    expect(evalKey(base(), "CHK-PERIODE-EFEKTIF").state).toBe("PASS");
  });
});

describe("CHK-DISCLOSURE-REF (PRD-COMP-005, Pasal 9)", () => {
  it("MISSING when the disclosure statement / video process is not referenced", () => {
    const vm = withChapter("disclaimer", [
      textBlock("EA ini sistem otomatis alat bantu. Tidak menjamin keuntungan. Tidak menghilangkan risiko Perdagangan Berjangka Komoditi. Hasil masa lalu tidak menjamin hasil di masa depan."),
    ]);
    expect(evalKey(vm, "CHK-DISCLOSURE-REF").state).toBe("MISSING");
  });
  it("PASS when the Pasal 9 disclosure + recorded video process is referenced", () => {
    expect(evalKey(base(), "CHK-DISCLOSURE-REF").state).toBe("PASS");
  });
});

describe("CHK-ONBOARDING-MARGIN (PRD-COMP-005, Pasal 5(7))", () => {
  it("MISSING when no minimum margin expectation is mentioned", () => {
    const c = passingContent();
    c.overview = [textBlock("EA masuk pasar dengan MA cross M15. Satu posisi. Mode semi-otomatis. Bukan untuk scalper.")];
    c.risk = [textBlock("Trading berisiko dan modal dapat hilang. Hasil masa lalu tidak menjamin hasil di masa depan.")];
    c.transparency = [textBlock("Strategi MA cross. Bahasa Indonesia. Periode efektif 12 bulan sejak aktivasi lisensi advisory.")];
    c.requirements = [textBlock("MetaTrader 5 build 4000. Akun hedging. Deposit demo USD 1000.")];
    expect(evalKey(base({ content: c }), "CHK-ONBOARDING-MARGIN").state).toBe("MISSING");
  });
  it("PASS when the >= Rp50.000.000 onboarding margin is mentioned", () => {
    expect(evalKey(base(), "CHK-ONBOARDING-MARGIN").state).toBe("PASS");
  });
});

// ===========================================================================
// identity / version / changelog
// ===========================================================================
describe("CHK-VERSI-DUA (PRD-VER-003) — UAT-12A/§2: identical semver is VALID, no body prose required", () => {
  it("PASS when EA version and manual version are identical (two distinct metadata fields)", () => {
    // the requirement is two DISTINCT metadata concepts, not two different strings
    expect(evalKey(base({ eaVersion: "1.0.0", manualVersion: "1.0.0" }), "CHK-VERSI-DUA").state).toBe("PASS");
  });
  it("PASS when both versions are distinct", () => {
    expect(evalKey(base(), "CHK-VERSI-DUA").state).toBe("PASS");
  });
  it("PASS even when the Cover body has no 'Dokumentasi ini berlaku untuk versi X.Y.Z' sentence (§2 — that is a separate concern)", () => {
    const c = passingContent();
    c.cover = [textBlock("Manual EA TestEA untuk MetaTrader 5. Diterbitkan oleh PT Smartin Advisor Sistem.")];
    const out = evalKey(base({ content: c, eaVersion: "1.0.0", manualVersion: "1.0.0" }), "CHK-VERSI-DUA");
    expect(out.state).toBe("PASS");
    expect(out.reason).not.toMatch(/berlaku untuk versi/i);
  });
  it("WARNING only when a version is not valid semver", () => {
    expect(evalKey(base({ eaVersion: "v1", manualVersion: "1.0.0" }), "CHK-VERSI-DUA").state).toBe("WARNING");
  });
  it("MISSING when a version value is absent", () => {
    expect(evalKey(base({ eaVersion: "" }), "CHK-VERSI-DUA").state).toBe("MISSING");
  });
});

describe("CHK-CHANGELOG-VERSI (PRD-VER, Pasal 8)", () => {
  it("MISSING when the changelog has no version entry", () => {
    expect(evalKey(withChapter("changelog", [textBlock("Belum ada catatan.")]), "CHK-CHANGELOG-VERSI").state).toBe("MISSING");
  });
  it("PASS when a [X.Y.Z] entry is present (legacy free-text fallback)", () => {
    expect(evalKey(base(), "CHK-CHANGELOG-VERSI").state).toBe("PASS");
  });
  it("MISSING → PASS when a structured changelog entry is added (slice 4)", () => {
    const noText = withChapter("changelog", [textBlock("Belum ada catatan.")]);
    expect(evalKey(noText, "CHK-CHANGELOG-VERSI").state).toBe("MISSING");
    const structured = withChapter("changelog", [textBlock("Belum ada catatan.")], {
      changelog: [
        {
          id: "cl-1",
          position: 0,
          entryType: "ADDED" as const,
          body: "Menambahkan filter berita.",
          sourceEaVersionId: "ev1",
          isFeatureChange: true,
          openPositionImpact: null,
        },
      ],
    });
    expect(evalKey(structured, "CHK-CHANGELOG-VERSI").state).toBe("PASS");
  });
});

// ===========================================================================
// quick-start / risk
// ===========================================================================
describe("CHK-QUICKSTART-DEMO & CHK-SAFE-STOP", () => {
  it("CHK-QUICKSTART-DEMO MISSING without demo-first guidance", () => {
    expect(evalKey(withChapter("quick-start", [textBlock("Pasang EA, tekan OK, selesai.")]), "CHK-QUICKSTART-DEMO").state).toBe("MISSING");
  });
  it("CHK-SAFE-STOP MISSING without a safe-stop procedure", () => {
    expect(evalKey(withChapter("quick-start", [textBlock("Gunakan akun demo dulu. Pasang EA, tekan OK.")]), "CHK-SAFE-STOP").state).toBe("MISSING");
  });
  it("both PASS on the full fixture", () => {
    expect(evalKey(base(), "CHK-QUICKSTART-DEMO").state).toBe("PASS");
    expect(evalKey(base(), "CHK-SAFE-STOP").state).toBe("PASS");
  });
});

describe("CHK-RISK-GENERAL & CHK-PAST-NOT-FUTURE", () => {
  it("CHK-RISK-GENERAL MISSING without a capital-loss statement", () => {
    const c = passingContent();
    c.risk = [textBlock("Kelola dana dengan bijak.")];
    c.disclaimer = [textBlock("EA alat bantu otomatis. Tidak menjamin profit. Tidak menghilangkan risiko PBK.")];
    expect(evalKey(base({ content: c }), "CHK-RISK-GENERAL").state).toBe("MISSING");
  });
  it("CHK-PAST-NOT-FUTURE MISSING without a past<>future caveat", () => {
    const c = passingContent();
    c.risk = [textBlock("Trading forex berisiko dan modal dapat hilang.")];
    c.disclaimer = [
      textBlock("EA alat bantu otomatis. Tidak menjamin keuntungan. Tidak menghilangkan risiko Perdagangan Berjangka Komoditi. Rujukan disclosure statement dan rekaman video Perba 12/2022."),
    ];
    c.performance = [textBlock("Belum ada data.")];
    expect(evalKey(base({ content: c }), "CHK-PAST-NOT-FUTURE").state).toBe("MISSING");
  });
  it("both PASS on the full fixture", () => {
    expect(evalKey(base(), "CHK-RISK-GENERAL").state).toBe("PASS");
    expect(evalKey(base(), "CHK-PAST-NOT-FUTURE").state).toBe("PASS");
  });
});

// ===========================================================================
// dependency / package / features / interface (applicability)
// ===========================================================================
describe("applicability-gated checks", () => {
  it("CHK-DEPENDENCIES-LISTED: NA without declared deps; MISSING when a declared indicator is undocumented", () => {
    expect(evalKey(base(), "CHK-DEPENDENCIES-LISTED").state).toBe("NOT_APPLICABLE");
    const vm = base({ requirements: { pbkScope: "IN_SCOPE", customIndicators: ["SessionHighLow.ex5"] } });
    expect(evalKey(vm, "CHK-DEPENDENCIES-LISTED").state).toBe("MISSING");
  });
  it("CHK-DEPENDENCIES-LISTED: PASS when the indicator + missing-file behaviour are documented", () => {
    const c = passingContent();
    c.installation = [
      stepsBlock(["Buka terminal", "File > Open Data Folder", "MQL5/Experts salin ex5", "MQL5/Indicators salin SessionHighLow.ex5", "Navigator Refresh", "Restart"]),
      textBlock("Aktifkan Algo Trading dan Allow Algo Trading; smiley hijau berarti aktif, merah diblokir. Indikator SessionHighLow.ex5 wajib; bila hilang OnInit gagal dan smiley merah."),
    ];
    const vm = base({ content: c, requirements: { pbkScope: "IN_SCOPE", customIndicators: ["SessionHighLow.ex5"] } });
    expect(evalKey(vm, "CHK-DEPENDENCIES-LISTED").state).toBe("PASS");
  });
  it("CHK-PACKAGE-FILES: NA when nothing extra ships; WARNING (not MISSING — optional) when extra files ship but are undocumented", () => {
    expect(evalKey(base(), "CHK-PACKAGE-FILES").state).toBe("NOT_APPLICABLE");
    const c = passingContent();
    delete c.package;
    c.installation = [
      stepsBlock(["Buka terminal", "File Open Data Folder", "Salin ke folder tujuan", "Refresh Navigator", "Restart terminal"]),
      textBlock("Aktifkan Algo Trading dan Allow Algo Trading; smiley hijau berarti aktif, merah diblokir."),
    ];
    const vm = base({ content: c, requirements: { pbkScope: "IN_SCOPE", customIndicators: ["Dep.ex5"] } });
    expect(evalKey(vm, "CHK-PACKAGE-FILES").state).toBe("WARNING");
  });
  it("CHK-FITUR-DIJELASKAN: NA without verified features; MISSING/PASS otherwise", () => {
    expect(evalKey(base(), "CHK-FITUR-DIJELASKAN").state).toBe("NOT_APPLICABLE");
    const miss = base({ requirements: { pbkScope: "IN_SCOPE", verifiedFeatures: ["Panel Close All"] } });
    expect(evalKey(miss, "CHK-FITUR-DIJELASKAN").state).toBe("MISSING");
    const c = passingContent();
    c["how-it-works"] = [...(passingContent()["how-it-works"] ?? []), textBlock("Fitur Panel Close All menutup semua posisi sekaligus.")];
    const pass = base({ content: c, requirements: { pbkScope: "IN_SCOPE", verifiedFeatures: ["Panel Close All"] } });
    expect(evalKey(pass, "CHK-FITUR-DIJELASKAN").state).toBe("PASS");
  });
  it("CHK-INTERFACE: NA without a GUI; MISSING/PASS when the EA declares one", () => {
    expect(evalKey(base(), "CHK-INTERFACE").state).toBe("NOT_APPLICABLE");
    const miss = base({ requirements: { pbkScope: "IN_SCOPE", gui: true } });
    expect(evalKey(miss, "CHK-INTERFACE").state).toBe("MISSING");
    const c = passingContent();
    c.interface = [imageBlock("Panel EA beranotasi"), textBlock("Tombol Close All menutup semua posisi. Baris status menampilkan PnL terbuka dan jumlah order.")];
    const pass = base({ content: c, requirements: { pbkScope: "IN_SCOPE", gui: true } });
    expect(evalKey(pass, "CHK-INTERFACE").state).toBe("PASS");
  });
});

// ===========================================================================
// evidence & output-string safety (§43 / §44 / AC-P5-9 / AC-P5-12)
// ===========================================================================
describe("evidence & output-string safety", () => {
  it("no rule evidence or reason contains a credential / URL / forbidden approval word", () => {
    const c = passingContent();
    c.overview = [textBlock("EA ini menjamin profit pasti. Disetujui Bappebti.")];
    c.performance = [textBlock("Win rate 92%.")];
    c["how-it-works"] = [textBlock("Jarak 20 pip masuk keluar tutup posisi.")];
    const vm = base({
      content: c,
      requirements: { pbkScope: "IN_SCOPE", dangerMode: true, gui: true, customIndicators: ["X.ex5"], verifiedFeatures: ["Y"] },
    });
    const view = evaluateManual(vm, CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
    const blob = JSON.stringify(view).toLowerCase();
    for (const bad of ["ai_api_key", "sb_secret", "sb_publishable", "authorization", "bearer ", "http://", "https://", "-----begin"]) {
      expect(blob).not.toContain(bad);
    }
    for (const bad of ["bappebti approved", "certified", "compliant", "passed compliance", "regulator approved", "disetujui regulator", "lolos verifikasi"]) {
      expect(blob).not.toContain(bad);
    }
  });
});
