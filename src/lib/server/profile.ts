import "server-only";
import type { Session } from "next-auth";
import { adminDb } from "@/lib/server/admin-db";

// The signed-in Kick user, from the NextAuth session.
export function kickUser(session: Session | null): { kickUserId: number; username: string; image?: string | null } | null {
  const kickUserId = Number((session as { kickUserId?: string } | null)?.kickUserId ?? session?.user?.id);
  const username = session?.user?.name;
  if (!Number.isSafeInteger(kickUserId) || kickUserId <= 0 || !username) return null;
  return { kickUserId, username, image: session?.user?.image };
}

// The profiles row for the session (created on first use); its id is the minted JWT's sub.
// null = not signed in; a database failure throws, so callers never mistake it for a sign-out.
export async function ensureProfile(session: Session | null): Promise<string | null> {
  const user = kickUser(session);
  if (!user) return null;
  const { data, error } = await adminDb()
    .from("profiles")
    .upsert(
      {
        kick_user_id: user.kickUserId,
        username: user.username.slice(0, 64),
        avatar_url: user.image?.startsWith("https://") ? user.image : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "kick_user_id" },
    )
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`profile ${error?.code ?? "no-row"}`);
  }
  return data.id as string;
}
