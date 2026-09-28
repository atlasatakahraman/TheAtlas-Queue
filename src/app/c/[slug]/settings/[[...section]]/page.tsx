import "server-only";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ChannelPage, { generateMetadata as channelMetadata } from "../../page";

// The Settings page (Stage 12, D20) is the dashboard's page with settings set: the same loader,
// top bar and store. One section at most: /c/<slug>/settings/<section>; an overlay's builder is
// /c/<slug>/settings/overlays/<id> (Stage 13), read by the page on the client.
type Props = { params: Promise<{ slug: string; section?: string[] }> };

async function forward({ params }: Props) {
  const { slug, section = [] } = await params;
  const overlay = section[0] === "overlays" && /^[0-9a-f-]{36}$/.test(section[1] ?? "");
  if (section.length > (overlay ? 2 : 1)) notFound();
  return { params: Promise.resolve({ slug, settings: section[0] ?? "" }), searchParams: Promise.resolve({}) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return channelMetadata(await forward(props));
}

export default async function SettingsPage(props: Props) {
  return ChannelPage(await forward(props));
}
