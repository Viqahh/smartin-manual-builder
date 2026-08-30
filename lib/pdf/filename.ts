/**
 * Phase 7 slice 4 — PDF download filename (AC-P7-7 / PRD-POUT-004): `Manual_<EAName>_v<X.Y.Z>.pdf`.
 *
 * Pure. Sanitises the EA name for a `Content-Disposition` header and a filesystem: no control
 * chars (CR/LF/tab), no quote, no path separator, no wildcard/reserved chars; runs of whitespace
 * collapse to a single `_`.
 */

const stripControl = (s: string) =>
  Array.from(s, (ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? " " : ch)).join("");

const UNSAFE = /["/\\:*?<>|]+/g;

export function pdfFilename(eaName: string, version: string): string {
  const name =
    stripControl(eaName || "")
      .replace(UNSAFE, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "_")
      .slice(0, 80)
      .replace(/_+$/, "") || "EA";

  const ver = /^\d+\.\d+\.\d+$/.test(version)
    ? version
    : (version || "").replace(/[^0-9.]/g, "") || "0.0.0";

  return `Manual_${name}_v${ver}.pdf`;
}

/** RFC 6266 value: an ASCII `filename` plus a UTF-8 `filename*` for non-ASCII names. */
export function contentDisposition(filename: string): string {
  const ascii = Array.from(filename, (ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x20 && c < 0x7f && ch !== '"' ? ch : "_";
  }).join("");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
