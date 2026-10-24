"use client";

import { CircleCheck, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveActivityProgress } from "@/app/(app)/(member)/youth/play/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The finished / not finished control for one child on one activity
 * version. The parent page keys this component by child and version, so
 * switching children on a shared device starts from that child's saved
 * state, never the previous child's.
 */
export function ActivityProgressControl({
  activity,
  child,
  childName,
  version,
  initial,
}: {
  activity: string;
  /** Null when a youth plays as themselves. */
  child: string | null;
  childName: string;
  version: string;
  initial: { status: "started" | "completed"; revision: number; data: Record<string, unknown> } | null;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string; reload?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const done = state?.status === "completed";

  const save = (completed: boolean) =>
    start(async () => {
      const r = await saveActivityProgress({ activity, child, version, revision: state?.revision ?? 0, completed, data: state?.data ?? {} });
      if (r.ok) {
        setState({ status: r.status, revision: r.revision, data: state?.data ?? {} });
        setMessage({ tone: "success", text: completed ? `Marked finished for ${childName}.` : `Marked not finished for ${childName}.` });
      } else {
        setMessage({ tone: "error", text: r.message, reload: Boolean(r.conflict) });
      }
    });

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 font-semibold">
        {done ? <CircleCheck className="size-5 text-success" aria-hidden="true" /> : null}
        {done ? `${childName} finished this` : state ? `${childName} has started this` : `${childName} hasn't started this yet`}
      </p>
      <div className="flex flex-wrap gap-2">
        {done ? (
          <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />} loading={pending} loadingText="Saving…" onClick={() => save(false)}>
            Mark not finished
          </Button>
        ) : (
          <Button size="sm" icon={<CircleCheck className="size-4" aria-hidden="true" />} loading={pending} loadingText="Saving…" onClick={() => save(true)}>
            Mark finished
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {message ? (
          <Alert tone={message.tone} title={message.text}>
            {message.reload ? (
              <Button variant="ghost" size="sm" className="mt-1" onClick={() => router.refresh()}>
                Reload
              </Button>
            ) : null}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
