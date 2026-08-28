import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="route-state-page">
      <FileQuestion aria-hidden="true" size={40} />
      <h1>Halaman tidak ditemukan</h1>
      <p>Tautan mungkin sudah berubah atau data tidak tersedia untuk organisasi Anda.</p>
      <Link className="primary-button" href="/dashboard">
        Kembali ke dashboard
      </Link>
    </main>
  );
}
