import { PageSkeleton } from "@/components/ui/page-skeleton";

/** Opening an event from the list shows this at once, inside the shell. */
export default function EventLoading() {
  return <PageSkeleton label="Loading the event…" cards={2} />;
}
