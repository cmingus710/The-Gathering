/* eslint-disable @next/next/no-img-element -- the publisher's own artwork, loaded without a referrer */
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AudioCard } from "@/components/media/audio-card";
import { ExternalShowNote } from "@/components/media/podcast";
import { BackLink } from "@/components/ui/back-link";
import { parseProviderRefString, providerEmbed, safeHttpsUrl } from "@/lib/media/embeds";
import { formatInstant, isUuid } from "@/lib/media/format";
import type { ExternalEpisode } from "@/lib/media/types";
import { teachingViewer } from "@/lib/media/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Podcast episode" };

const LINK = "inline-flex min-h-11 items-center gap-2 rounded-full border border-border-strong/60 px-4 font-semibold hover:bg-surface-muted";

/**
 * An episode from another publisher's feed. Audio plays straight from the
 * publisher's own address (never downloaded or rehosted) and only when an
 * administrator confirmed in-app playback is allowed; otherwise the page
 * links to the publisher or their podcast app.
 */
export default async function ExternalEpisodePage({ params }: PageProps<"/podcasts/external/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [viewer, supabase, { settings }] = await Promise.all([teachingViewer(), requireClient(), getChurchSettings()]);
  const { data, error } = await supabase.rpc("media_external_episode", { p_id: id });
  if (error || !data) notFound();
  const e = data as ExternalEpisode;
  const audio = safeHttpsUrl(e.audio_url);
  const art = safeHttpsUrl(e.artwork_url);
  const link = safeHttpsUrl(e.link);
  const providerRef = parseProviderRefString(e.provider_ref);
  const provider = providerRef ? providerEmbed(providerRef) : null;

  return (
    <>
      <BackLink route="/podcasts/external/[id]" params={{ show: e.show_id }} label={e.show_title} />
      <article className="space-y-6">
        <header className="flex flex-wrap gap-5">
          {art ? <img src={art} alt="" referrerPolicy="no-referrer" className="size-32 shrink-0 rounded-tile object-cover sm:size-40" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-meta font-semibold text-text-secondary">
              {[e.show_title, e.published_at ? formatInstant(e.published_at, settings.timezone) : null].filter(Boolean).join(" · ")}
            </p>
            <h1 className="font-display text-display font-semibold text-text">{e.title}</h1>
          </div>
        </header>

        {audio ? (
          <AudioCard
            label="Listen to this episode"
            resumeAt={e.progress?.position}
            track={{
              key: `e:${e.id}`,
              itemId: null,
              src: audio,
              title: e.title,
              subtitle: e.show_title,
              artwork: art,
              href: `/podcasts/external/${e.id}`,
              duration: e.duration_seconds,
              saveProgress: viewer.member,
            }}
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className={LINK}>
              Open on the publisher&apos;s site <ExternalLink className="size-4" aria-hidden="true" />
              <span className="sr-only">(opens a new tab)</span>
            </a>
          ) : null}
          {provider ? (
            <a href={provider.openUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
              {provider.openLabel} <ExternalLink className="size-4" aria-hidden="true" />
              <span className="sr-only">(opens a new tab)</span>
            </a>
          ) : null}
        </div>

        {e.description ? <p className="max-w-[65ch] whitespace-pre-line text-text-secondary">{e.description}</p> : null}
        <ExternalShowNote />
      </article>
    </>
  );
}
