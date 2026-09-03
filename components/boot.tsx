"use client";

import { setApiToken } from "@/lib/client/api";

// Runs during render so the token is set before any child effect fetches.
export function Boot({ token }: { token: string }) {
  setApiToken(token);
  return null;
}
