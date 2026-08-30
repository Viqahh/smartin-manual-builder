/**
 * Phase 7 slice 4 — make a Chromium-generated PDF byte-deterministic for one immutable snapshot.
 *
 * For the SAME print HTML + SAME Chromium build + SAME viewport, `page.pdf()` output is identical
 * EXCEPT three inherently volatile fields: the Info-dict `/CreationDate` and `/ModDate`, and the
 * trailer file `/ID`. This does a byte-length-preserving in-place rewrite of those three, deriving
 * the fixed date from `publishedAt` (an immutable publication fact — never `new Date()`), so three
 * generations of the same snapshot produce identical SHA-256.
 *
 * Same-length replacement keeps every xref byte-offset valid, so nothing else in the file shifts.
 * If a field's on-disk form is an unexpected length it is left untouched and reported via the
 * returned `changed` map (the caller logs a determinism warning rather than corrupting the PDF).
 */

/** `D:YYYYMMDDHHmmSS+00'00'` — 22 chars, the exact shape Chromium writes. */
function pdfDate(iso: string): string {
  const d = new Date(iso);
  const t = Number.isFinite(d.getTime()) ? d : new Date(0);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `D:${p(t.getUTCFullYear(), 4)}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}` +
    `${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}+00'00'`
  );
}

/** replace the bytes between `(` and `)` after `key` with `value`, padded/truncated to fit. */
function rewriteParenValue(latin1: string, key: string, value: string): { s: string; hit: boolean } {
  const re = new RegExp(`(/${key}\\s*\\()([^)]*)(\\))`);
  let hit = false;
  const s = latin1.replace(re, (_m, open: string, inner: string, close: string) => {
    hit = true;
    const fit = value.length <= inner.length ? value.padEnd(inner.length, " ") : value.slice(0, inner.length);
    return open + fit + close;
  });
  return { s, hit };
}

/**
 * Zero both hex strings in `/ID [ <..> <..> ]` (same length). `hit` is true when there was
 * nothing volatile to do (Skia/PDF, the Chromium engine, emits no file `/ID`) OR it was rewritten.
 */
function zeroFileId(latin1: string): { s: string; hit: boolean } {
  const re = /(\/ID\s*\[\s*<)([0-9a-fA-F]*)(>\s*<)([0-9a-fA-F]*)(>\s*\])/;
  if (!re.test(latin1)) return { s: latin1, hit: true };
  const s = latin1.replace(re, (_m, a: string, h1: string, b: string, h2: string, c: string) =>
    a + "0".repeat(h1.length) + b + "0".repeat(h2.length) + c,
  );
  return { s, hit: true };
}

export function normalizePdf(
  pdf: Uint8Array,
  publishedAt: string,
): { bytes: Buffer; changed: { creationDate: boolean; modDate: boolean; fileId: boolean } } {
  let latin1 = Buffer.from(pdf).toString("latin1");
  const date = pdfDate(publishedAt);

  const c = rewriteParenValue(latin1, "CreationDate", date);
  latin1 = c.s;
  const m = rewriteParenValue(latin1, "ModDate", date);
  latin1 = m.s;
  const id = zeroFileId(latin1);
  latin1 = id.s;

  return {
    bytes: Buffer.from(latin1, "latin1"),
    changed: { creationDate: c.hit, modDate: m.hit, fileId: id.hit },
  };
}
