import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";
import { setupChannel } from "@/lib/server/onboard";
import { Welcome } from "./welcome";

export async function generateMetadata(): Promise<Metadata> {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  return { title: translate(lang, "welcome.title"), robots: { index: false, follow: false } };
}

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user?.name) redirect("/?callbackUrl=/welcome");
  return <Welcome username={session.user.name} setup={setupChannel} />;
}
