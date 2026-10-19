import Link from "next/link";
import { IconBadge } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";

export function PublicHeader({ churchName, iconUrl, signedIn }: { churchName: string; iconUrl: string; signedIn: boolean }) {
  return (
    <header className="bg-background">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <IconBadge src={iconUrl} />
          <span className="text-lg font-bold">{churchName}</span>
        </Link>
        {signedIn ? (
          <Link href="/home" className={buttonClasses("secondary", "sm")}>
            Open app
          </Link>
        ) : (
          <Link href="/sign-in" className={buttonClasses("secondary", "sm")}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
