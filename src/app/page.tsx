import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Home } from "@/components/home";
import { LAST_CHANNEL_COOKIE } from "@/components/queue/tabs";
import { auth } from "@/lib/auth";
import { ensureProfile, kickUser } from "@/lib/server/profile";
import { userDb } from "@/lib/server/user-db";

type Props = { searchParams: Promise<{ callbackUrl?: string }> };

// Only same-site paths: an open redirect would hand a signed-in user to anyone's page.
function safePath(p: string | undefined): string | null {
  return p && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : null;
}

// `/` (spec D11): signed out, the home page, which is also the sign-in page; signed in, the
// streamer's own channel, else the last channel they opened, else any they moderate, else
// onboarding.
export default async function RootPage({ searchParams }: Props) {
  const callbackUrl = safePath((await searchParams).callbackUrl);
  const session = await auth();
  const user = kickUser(session);
  if (!user) return <Home callbackUrl={callbackUrl ?? "/"} />;
  if (callbackUrl && callbackUrl !== "/") redirect(callbackUrl);

  const profileId = await ensureProfile(session);
  const { data } = await userDb(profileId!)
    .from("channel_members")
    .select("role, channels(slug)")
    .eq("kick_user_id", user.kickUserId)
    .eq("blocked", false);
  const slugs = (data ?? []).map((m) => ({
    role: m.role as string,
    slug: (m.channels as unknown as { slug: string } | null)?.slug,
  }));
  const last = (await cookies()).get(LAST_CHANNEL_COOKIE)?.value;
  const target =
    slugs.find((m) => m.role === "owner")?.slug ?? slugs.find((m) => m.slug === last)?.slug ?? slugs[0]?.slug;
  redirect(target ? `/c/${target}` : "/welcome");
}
