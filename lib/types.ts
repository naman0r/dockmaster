// Snapshot envelope shared by every module API. data is null when the module
// is disabled or has never been scanned.
export type Snapshot<T> = {
  enabled: boolean;
  cachedAt: string | null;
  data: T | null;
  scanMs?: number;
};

export function disabledSnapshot<T>(): Snapshot<T> {
  return { enabled: false, cachedAt: null, data: null };
}

export function snapshot<T>(
  enabled: boolean,
  value: { data: T; cachedAt: string; scanMs?: number } | null,
): Snapshot<T> {
  if (!value) return { enabled, cachedAt: null, data: null };
  return {
    enabled,
    cachedAt: value.cachedAt,
    data: value.data,
    scanMs: value.scanMs,
  };
}
