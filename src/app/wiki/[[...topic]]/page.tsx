import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { HelpSearch, TopicSelect } from "@/components/help/help-nav";
import { GOLD, Numerals } from "@/components/numerals";
import { SETTINGS_ITEM, SETTINGS_LIST } from "@/components/queue/geometry";
import { SlimBar } from "@/components/status-page";
import { ThemeButton } from "@/components/theme-button";
import { Kbd } from "@/components/ui/kbd";
import { type Block, HELP, isTopic, type Topic, TOPICS, topicPath } from "@/lib/help";
import { type Lang, parseLang } from "@/lib/i18n";
import { alternates, ogLocale, requestLang } from "@/lib/server/site";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ topic?: string[] }>; searchParams: Promise<{ lang?: string }> };

// ?lang from the page's own search params: a link prefetch skips the proxy (src/proxy.ts), so
// its x-lang is missing, and the prefetched <head> would fall back to the cookie's language.
async function langOf(searchParams: Props["searchParams"]): Promise<Lang> {
  return parseLang((await searchParams).lang) ?? (await requestLang());
}

// /wiki is Getting started; /wiki/<topic> the others; /wiki/getting-started is /wiki.
async function topicOf(params: Props["params"]): Promise<Topic> {
  const { topic } = await params;
  if (!topic) return "getting-started";
  if (topic.length !== 1) notFound();
  if (topic[0] === "getting-started") permanentRedirect("/wiki");
  if (!isTopic(topic[0])) notFound();
  return topic[0];
}

// A help link keeps the page's language; an anchor stays after it.
const withLang = (href: string, lang: Lang) => {
  if (!href.startsWith("/wiki")) return href;
  const [path, hash] = href.split("#");
  return `${path}?lang=${lang}${hash ? `#${hash}` : ""}`;
};

// DESIGN.md § Metadata and SEO: indexed, one title and description per topic and language.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const topic = await topicOf(params);
  const lang = await langOf(searchParams);
  const h = HELP[lang];
  const title = `${h.ui.title}: ${h[topic].title}`;
  const path = topicPath(topic);
  return {
    title,
    description: h[topic].description,
    alternates: await alternates(path),
    openGraph: { title, description: h[topic].description, url: path, ...ogLocale(lang) },
  };
}

// The help pages (D33, DESIGN.md § Help): server-rendered, no data calls; only the search box and
// the phone topic select are client code.
export default async function HelpPage({ params, searchParams }: Props) {
  const topic = await topicOf(params);
  const lang = await langOf(searchParams);
  const h = HELP[lang];
  const a = h[topic];
  const path = topicPath(topic);
  const topics = TOPICS.map((t) => ({ value: t, title: h[t].title, href: withLang(topicPath(t), lang) }));
  const index = TOPICS.flatMap((t) =>
    h[t].sections.map((s) => ({ href: withLang(`${topicPath(t)}#${s.id}`, lang), title: s.title, topic: h[t].title })),
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SlimBar crumb={h.ui.title} tools={<><LangLinks path={path} lang={lang} /><ThemeButton /></>} />
      <main className="mx-auto grid w-full max-w-[1440px] flex-1 items-start gap-8 px-8 pt-8 pb-16 max-md:px-4 max-md:pt-6 lg:grid-cols-[14rem_minmax(0,42rem)] lg:gap-12">
        <nav aria-label={h.ui.topics} className={cn(SETTINGS_LIST, "gap-4")}>
          <HelpSearch index={index} label={h.ui.search} none={h.ui.none} />
          <div className="lg:hidden">
            <TopicSelect topics={topics} current={topic} label={h.ui.topics} />
          </div>
          <ol className="flex flex-col gap-1 max-lg:hidden">
            {topics.map((t) => (
              <li key={t.value}>
                <Link
                  href={t.href}
                  aria-current={t.value === topic ? "page" : undefined}
                  className={cn(
                    SETTINGS_ITEM,
                    "text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                    t.value === topic && "text-foreground",
                  )}
                >
                  {/* The tabs' gold line under the active label. */}
                  <span className={cn("relative after:absolute after:inset-x-0 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-brand", t.value === topic ? "after:scale-x-100" : "after:scale-x-0")}>
                    {t.title}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <article className="flex min-w-0 flex-col gap-8">
          <header className="flex flex-col gap-3">
            <h1 className="font-serif text-headline max-md:text-title">{a.title}</h1>
            <p className="text-body text-muted-foreground">{a.lead}</p>
          </header>
          {a.sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id} className="flex flex-col gap-3">
              <h2 id={s.id} className="group flex scroll-mt-8 items-baseline gap-2 font-serif text-title">
                {s.title}
                <a href={`#${s.id}`} aria-label={s.title} className="text-body text-muted-foreground opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100">
                  #
                </a>
              </h2>
              {s.body.map((b, i) => (
                <Body key={i} block={b} lang={lang} />
              ))}
            </section>
          ))}
        </article>
      </main>
    </div>
  );
}

function Body({ block, lang }: { block: Block; lang: Lang }) {
  if (typeof block === "string") return <p className="text-body leading-relaxed">{rich(block, lang)}</p>;
  if ("list" in block)
    return (
      <ul className="flex list-disc flex-col gap-2 pl-5 text-body leading-relaxed marker:text-muted-foreground">
        {block.list.map((l, i) => (
          <li key={i}>{rich(l, lang)}</li>
        ))}
      </ul>
    );
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-2.5 rounded-xl bg-card p-4">
      {block.keys.map(([key, does]) => (
        <div key={key} className="contents">
          <dt>
            <Kbd className="h-6 px-1.5 text-control text-foreground">{key}</Kbd>
          </dt>
          <dd className="text-body">{does}</dd>
        </div>
      ))}
    </dl>
  );
}

// Light markup in the wiki text: `a key or command`, **strong**, *emphasis*, [a link](/path);
// numbers in the rest are gold too.
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;
function rich(text: string, lang: Lang) {
  return text.split(TOKEN).map((p, i) => {
    // Commands and bold words read as the numbers do (owner, 2026-09-29); a command selects whole.
    if (p.startsWith("`")) return <span key={i} className={cn(GOLD, "select-all")}>{p.slice(1, -1)}</span>;
    if (p.startsWith("**")) return <strong key={i} className={GOLD}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (m)
      return (
        <Link key={i} href={withLang(m[2], lang)} className="text-foreground underline decoration-brand/60 underline-offset-4 hover:decoration-brand">
          {m[1]}
        </Link>
      );
    return <Numerals key={i} text={p} />;
  });
}

// EN | TR as real links (DESIGN.md § Help), so a crawler reaches both and the page renders in the
// language it asked for; a full load, so <html lang> follows.
function LangLinks({ path, lang }: { path: string; lang: Lang }) {
  return (
    <span className="flex items-center text-control select-none">
      {(["en", "tr"] as const).map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span className="px-0.5 text-muted-foreground" aria-hidden>|</span>}
          <a
            href={`${path}?lang=${l}`}
            hrefLang={l}
            lang={l}
            aria-current={l === lang ? "true" : undefined}
            className={cn(
              "flex h-9 items-center rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-md:h-11",
              l === lang ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l.toUpperCase()}
          </a>
        </span>
      ))}
    </span>
  );
}
