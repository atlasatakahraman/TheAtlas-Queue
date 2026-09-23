import "server-only";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { setupChannel } from "@/lib/server/onboard";
import { Welcome } from "./welcome";

export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false } };

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user?.name) redirect("/login?callbackUrl=/welcome");
  return <Welcome username={session.user.name} setup={setupChannel} />;
}
