// Client-safe config. Server-side tuning lives in lib/settings.ts; the
// heartbeat interval must match the server's merge window, hence the
// NEXT_PUBLIC override.
export function logbookIntervalMs(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_DOCKMASTER_LOGBOOK_INTERVAL_MS);
  return Number.isInteger(parsed) && parsed >= 3000 ? parsed : 10000;
}
