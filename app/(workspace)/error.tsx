"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function WorkspaceError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // No manual contents / secrets — just the message (PRD-SEC-009).
    console.error("[workspace] render error:", error.message);
  }, [error]);

  return (
    <div className="route-state-page">
      <AlertTriangle aria-hidden="true" size={40} />
      <h1>Terjadi kesalahan</h1>
      <p>Kami tidak dapat memuat bagian ini. Coba lagi, atau muat ulang halaman.</p>
      <button className="primary-button" onClick={reset}>
        Coba lagi
      </button>
    </div>
  );
}
