export default function WorkspaceLoading() {
  return (
    <div className="page-container" aria-busy="true" aria-live="polite">
      <div className="skeleton skeleton-header" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-block" />
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
