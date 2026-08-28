import { UserRoundX } from "lucide-react";
import { getWorkspaceContext } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/app/login/sign-out-button";

export default async function NoMembershipPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx.configured) redirect("/login");
  if (!ctx.user) redirect("/login");
  if (ctx.activeOrg) redirect("/dashboard");

  return (
    <main className="route-state-page">
      <UserRoundX aria-hidden="true" size={40} />
      <h1>Belum tergabung dalam organisasi</h1>
      <p>
        Akun <strong>{ctx.user.email}</strong> sudah masuk, tetapi belum menjadi anggota organisasi
        mana pun. Minta admin workspace untuk menambahkan Anda, lalu masuk kembali.
      </p>
      <SignOutButton />
    </main>
  );
}
