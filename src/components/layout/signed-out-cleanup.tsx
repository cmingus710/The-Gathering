"use client";

import { useEffect } from "react";
import { purgeColoringDrafts } from "@/lib/youth/coloring-local";

/** After an explicit sign-out: removes any on-device copies of unsaved coloring that remain. */
export function SignedOutCleanup() {
  useEffect(() => {
    purgeColoringDrafts();
  }, []);
  return null;
}
