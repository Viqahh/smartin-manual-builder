import type { PublicVersion } from "@/lib/publication/get-public-manual";

/**
 * Phase 7 slice 2 — published-version switcher (server component, plain links: no-JS, crawlable).
 *
 * Lists only currently PUBLISHED versions, newest first (publication chronology, decided by
 * `getPublicManual`). Links use the FROZEN `public_manuals.public_slug`, never a mutable EA slug.
 * On an ARCHIVED direct URL the archived version is shown separately and NOT re-added to the list.
 */
export function VersionNav({
  versions,
  current,
  slug,
  state,
}: {
  versions: PublicVersion[];
  current: string;
  slug: string;
  state: "PUBLISHED" | "ARCHIVED";
}) {
  const archivedCurrent = state === "ARCHIVED";

  return (
    <nav className="pm-versions" aria-label="Versi manual">
      <p className="pm-versions-label">Versi Manual</p>

      {archivedCurrent && (
        <p className="pm-versions-viewing">
          Versi yang sedang dilihat: <strong>{current}</strong> — Diarsipkan
        </p>
      )}

      {versions.length === 0 ? (
        <p className="pm-versions-empty">Belum ada versi terbit lain untuk manual ini.</p>
      ) : (
        <ul>
          {versions.map((v) => {
            const isCurrent = !archivedCurrent && v.publicVersion === current;
            return (
              <li key={v.publicVersion}>
                <a
                  href={`/manual/${slug}/${v.publicVersion}`}
                  aria-current={isCurrent ? "page" : undefined}
                  className={isCurrent ? "is-current" : undefined}
                >
                  <span className="pm-versions-num">{v.publicVersion}</span>
                  {isCurrent && <span className="pm-versions-tag">sedang dilihat</span>}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
