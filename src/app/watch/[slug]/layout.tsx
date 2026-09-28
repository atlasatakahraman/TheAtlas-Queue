import "server-only";
import { notFound } from "next/navigation";
import { watchSnapshot } from "@/lib/server/watch";

// A channel that does not exist is a real 404 (DESIGN.md § Indexing). Checked here, above the
// page's loading boundary: once the skeleton streams, the status is already 200.
export default async function WatchLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  if (!(await watchSnapshot((await params).slug))) notFound();
  return children;
}
