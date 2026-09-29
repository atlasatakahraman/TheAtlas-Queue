import "server-only";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

const kickProvider = {
  id: "kick",
  name: "Kick",
  type: "oauth" as const,
  authorization: {
    url: "https://id.kick.com/oauth/authorize",
    params: {
      // Sign-in reads who you are, nothing else (spec § Security → Auth). chat:write is asked
      // for only when chat replies are switched on (the Settings switch passes its own scope).
      scope: "user:read",
      response_type: "code",
    },
  },
  token: {
    url: "https://id.kick.com/oauth/token",
    conform: async (response: Response) => {
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json");
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  },
  client: {
    token_endpoint_auth_method: "client_secret_post" as const,
  },
  userinfo: {
    url: "https://api.kick.com/public/v1/users",
    async request({ tokens }: { tokens: { access_token: string } }) {
      const res = await fetch("https://api.kick.com/public/v1/users", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
        },
      });
      const json = await res.json();
      return json.data?.[0] ?? {};
    },
  },
  profile(profile: Record<string, unknown>) {
    const mainId = profile.user_id ?? profile.id ?? null;
    return {
      id: String(mainId ?? ""),
      name: profile.name as string | null,
      email: profile.email as string | null,
      image: profile.profile_picture as string | null,
    };
  },
  checks: ["pkce", "state"] as ("pkce" | "state" | "none")[],
  clientId: process.env.KICK_CLIENT_ID,
  clientSecret: process.env.KICK_CLIENT_SECRET,
};

export const authConfig: NextAuthConfig = {
  providers: [kickProvider],
  // The home page is the sign-in page; proxy.ts sends signed-out requests there.
  pages: { signIn: "/" },
  callbacks: {
    // The session carries who the user is and nothing else: no Kick access token.
    async jwt({ token, user, account }) {
      // The chat replies consent: its refresh token goes to kick_tokens, encrypted, never into
      // the session.
      if (account?.refresh_token && account.scope?.split(" ").includes("chat:write")) {
        const { saveChatToken } = await import("@/lib/server/kick-tokens");
        await saveChatToken(Number(account.providerAccountId), account.refresh_token, account.expires_at ?? 0, account.scope.split(" "));
      }
      if (user) {
        token.kickId = user.id;
        token.kickUsername = user.name;
        token.kickImage = user.image;
      }
      if (account) token.kickUserId = account.providerAccountId;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.kickId as string;
        session.user.name = token.kickUsername as string;
        session.user.image = token.kickImage as string;
      }
      (session as unknown as Record<string, unknown>).kickUserId = token.kickUserId;
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
