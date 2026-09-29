// One chat message into a channel's own Kick chat, as the app's bot, with the token its owner
// stored by turning chat replies on. Only with the owner's yes (Stage 16).
//   bun --bun --conditions=react-server --env-file=.env.local scripts/chat-test.ts <slug> "<text>"
import { adminDb } from "@/lib/server/admin-db";
import { sendChat } from "@/lib/server/kick-tokens";

const [slug, text] = process.argv.slice(2);
if (!slug || !text) throw new Error("usage: chat-test.ts <slug> <text>");
const { data: channel } = await adminDb().from("channels").select("id").eq("slug", slug).single();
if (!channel) throw new Error(`no channel ${slug}`);
console.log(await sendChat(channel.id, text));
