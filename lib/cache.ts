// Demand-driven, coalesced cache. Mirrors the original Port Authority
// Scanner: nothing is collected unless someone asks, concurrent askers share
// one in-flight collection, and a very short TTL keeps duplicate tabs cheap.

export class TtlCache<T> {
  private value: T | null = null;
  private at = 0;
  private scanMs = 0;
  private inflight: Promise<{ data: T; cachedAt: string; scanMs: number }> | null = null;

  constructor(private ttlMs: number) {}

  async get(
    force: boolean,
    collect: () => Promise<T>,
  ): Promise<{ data: T; cachedAt: string; scanMs: number }> {
    const now = Date.now();
    if (
      !force &&
      this.value !== null &&
      now - this.at < this.ttlMs
    ) {
      return { data: this.value, cachedAt: new Date(this.at).toISOString(), scanMs: this.scanMs };
    }
    if (!this.inflight) {
      const started = Date.now();
      this.inflight = collect()
        .then((data) => {
          this.value = data;
          this.at = Date.now();
          this.scanMs = Date.now() - started;
          return { data, cachedAt: new Date(this.at).toISOString(), scanMs: this.scanMs };
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  // Read whatever is cached without triggering a collection.
  peek(): { data: T; cachedAt: string } | null {
    if (this.value === null) return null;
    return { data: this.value, cachedAt: new Date(this.at).toISOString() };
  }

  invalidate(): void {
    this.value = null;
    this.at = 0;
  }
}
