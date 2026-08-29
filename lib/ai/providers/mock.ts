/**
 * MockAIProvider — deterministic, useful for development, automated tests and browser
 * acceptance (PRD-AI-002). It is NOT a fake "magic AI": it produces recognisable, grounded
 * proposals and obeys every rule the configured provider must — grounding, fact references,
 * the `ADDITIONAL_INFORMATION_REQUIRED` sentinel, and the result schema.
 *
 * No content is ever invented: transforms are lexical only (whitespace, casing, a small fixed
 * plain-language / de-marketing dictionary) so no number, symbol, or timeframe is introduced.
 */

import { assertGroundedRequestShape } from "../grounded-request";
import { scanClaims } from "../claim-scanner";
import type { AIProvider, AiResult, ClaimFinding, Fact, GroundedRequest, RevisionOperation } from "../types";

const MIN_SOURCE = 3;

const PLAIN_LANGUAGE: [RegExp, string][] = [
  [/\butilise?\b/gi, "gunakan"],
  [/\bmengutilisasi\b/gi, "menggunakan"],
  [/\bmengonfigurasikan\b/gi, "mengatur"],
  [/\bmelakukan inisialisasi\b/gi, "menyiapkan"],
  [/\beksekusi\b/gi, "menjalankan"],
  [/\bimplementasi\b/gi, "penerapan"],
  [/\bprerequisite[s]?\b/gi, "syarat"],
];

const DE_MARKETING: RegExp[] = [
  /\bluar biasa\b/gi,
  /\brevolusioner\b/gi,
  /\bterbaik di kelasnya\b/gi,
  /\bpaling (hebat|canggih|unggul)\b/gi,
  /\bamazing\b/gi,
  /\bbest[-\s]?in[-\s]?class\b/gi,
  /\bgame[-\s]?changer\b/gi,
];

function tidy(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function sentenceCase(s: string): string {
  return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function ensureTerminalPunctuation(s: string): string {
  const t = s.trimEnd();
  if (!t) return t;
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function blockContent(facts: Fact[]): { text: string; refs: string[] } {
  const f = facts.find((x) => x.id === "blockContent:current");
  return { text: typeof f?.value === "string" ? f.value : "", refs: f ? [f.id] : [] };
}

function chapterFact(facts: Fact[]): Fact | undefined {
  return facts.find((x) => x.kind === "chapter");
}

function proposalText(text: string, factRefs: string[], operation: RevisionOperation): AiResult {
  return {
    status: "PROPOSAL",
    operation,
    output: { kind: "text", text },
    factReferences: factRefs,
  };
}

function air(missing: { label: string; hint?: string; surface?: string }[]): AiResult {
  return { status: "ADDITIONAL_INFORMATION_REQUIRED", missingFacts: missing };
}

/** The lexical rewrite shared by improve / simplify / technicalRewrite. */
function rewrite(req: GroundedRequest, kind: RevisionOperation): AiResult {
  const content = blockContent(req.factBundle.facts);
  const usedBlockContent = req.selectedText.trim().length < MIN_SOURCE && content.text.trim().length >= MIN_SOURCE;
  const source = (usedBlockContent ? content.text : req.selectedText).trim();
  if (source.length < MIN_SOURCE) {
    return air([
      {
        label: "Teks sumber",
        hint: "Tulis dulu isi paragraf pada blok teks, lalu jalankan operasi ini.",
        surface: "Blok teks",
      },
    ]);
  }
  let out = tidy(source);
  if (kind === "simplifyText") {
    for (const [re, rep] of PLAIN_LANGUAGE) out = out.replace(re, rep);
  }
  if (kind === "technicalRewrite") {
    for (const re of DE_MARKETING) out = out.replace(re, "");
    out = tidy(out);
  }
  out = ensureTerminalPunctuation(sentenceCase(out));
  const refs = new Set<string>();
  if (usedBlockContent) content.refs.forEach((r) => refs.add(r));
  const ch = chapterFact(req.factBundle.facts);
  if (ch) refs.add(ch.id);
  return proposalText(out, [...refs], kind);
}

export class MockAIProvider implements AIProvider {
  readonly mode = "mock" as const;
  readonly label = "Mock AI";

  async improveText(req: GroundedRequest): Promise<AiResult> {
    assertGroundedRequestShape(req);
    return rewrite(req, "improveText");
  }

  async simplifyText(req: GroundedRequest): Promise<AiResult> {
    assertGroundedRequestShape(req);
    return rewrite(req, "simplifyText");
  }

  async technicalRewrite(req: GroundedRequest): Promise<AiResult> {
    assertGroundedRequestShape(req);
    return rewrite(req, "technicalRewrite");
  }

  async generateSteps(req: GroundedRequest): Promise<AiResult> {
    assertGroundedRequestShape(req);
    const source = req.selectedText.trim() || blockContent(req.factBundle.facts).text.trim();
    const rawLines = source
      .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"'])/)
      .map((l) => tidy(l))
      .filter((l) => l.replace(/[^\p{L}\p{N}]/gu, "").length >= 4);
    if (rawLines.length === 0) {
      return air([
        {
          label: "Instruksi sumber untuk langkah",
          hint: "Tulis instruksi pemasangan/penggunaan pada blok teks (satu langkah per baris), lalu buat langkah.",
          surface: "Blok teks",
        },
      ]);
    }
    const steps = rawLines.slice(0, 60).map((line) => {
      const words = line.split(/\s+/);
      const title = sentenceCase(words.slice(0, 8).join(" ")).replace(/[.]+$/, "");
      return { title: title || "Langkah", instruction: ensureTerminalPunctuation(sentenceCase(line)) };
    });
    const refs = new Set<string>(blockContent(req.factBundle.facts).refs);
    const ch = chapterFact(req.factBundle.facts);
    if (ch) refs.add(ch.id);
    return { status: "PROPOSAL", operation: "generateSteps", output: { kind: "steps", steps }, factReferences: [...refs] };
  }

  async generateCaption(req: GroundedRequest): Promise<AiResult> {
    assertGroundedRequestShape(req);
    const img = req.factBundle.facts.find((f) => f.kind === "image");
    const meta = (img?.value ?? {}) as { altText?: string | null; caption?: string | null };
    const basis = (meta.altText || meta.caption || "").trim();
    if (!basis) {
      return air([
        {
          label: "Teks alternatif (ALT) gambar",
          hint: "Isi ALT gambar dengan deskripsi faktual isinya, lalu buat keterangan.",
          surface: "Metadata gambar",
        },
      ]);
    }
    const ch = chapterFact(req.factBundle.facts);
    const chapterTitle = (ch?.value as { title?: string } | undefined)?.title;
    const caption = ensureTerminalPunctuation(
      sentenceCase(tidy(chapterTitle ? `${basis} pada bagian ${chapterTitle}` : basis)),
    ).slice(0, 500);
    const refs = [img!.id, ...(ch ? [ch.id] : [])];
    return { status: "PROPOSAL", operation: "generateCaption", output: { kind: "caption", caption }, factReferences: refs };
  }

  async detectClaims(input: { text: string; locale: string }): Promise<ClaimFinding[]> {
    return scanClaims(input.text);
  }
}
