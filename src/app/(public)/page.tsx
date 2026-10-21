import { Alert } from "@/components/ui/alert";
import { WelcomeHero } from "@/components/welcome/welcome-hero";
import { GatheringInfo, PublicAnnouncements } from "@/components/welcome/welcome-info";
import { WelcomeStrip } from "@/components/welcome/welcome-strip";
import { listLiveAnnouncements, type AnnouncementWithImage } from "@/lib/announcements/queries";
import { getViewer } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { createClient } from "@/lib/supabase/server";

export default async function WelcomePage() {
  const [{ settings, available }, viewer] = await Promise.all([getChurchSettings(), getViewer()]);

  let announcements: AnnouncementWithImage[] = [];
  let announcementsFailed = false;
  const supabase = await createClient();
  if (supabase) {
    try {
      announcements = await listLiveAnnouncements(supabase, { limit: 3, audience: "public" });
    } catch {
      announcementsFailed = true;
    }
  }
  const signedIn = viewer.state === "signed-in";

  return (
    <>
      <WelcomeHero churchName={settings.churchName} description={settings.description} signedIn={signedIn} />
      {!available ? (
        <div className="mx-auto max-w-6xl px-5 pt-8 sm:px-8">
          <div className="mx-auto max-w-xl">
            <Alert tone="warning" title="Some information is temporarily unavailable">
              Church details couldn&apos;t be loaded right now. Please try again later.
            </Alert>
          </div>
        </div>
      ) : null}
      <WelcomeStrip />
      <GatheringInfo settings={settings} />
      <PublicAnnouncements announcements={announcements} failed={announcementsFailed} signedIn={signedIn} timeZone={settings.timezone} />
    </>
  );
}
