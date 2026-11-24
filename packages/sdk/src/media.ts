import type { MediaInfo, MediaState } from '@toets/protocol';

/** Player state without the id. */
export type MediaSnapshot = Omit<MediaInfo, 'id'>;

/** A pull source: the SDK reads the player's state when the host asks. */
export interface MediaSource {
  /** Current state, or `null` when the player is gone. */
  getSnapshot(): MediaSnapshot | null;
}

/** A push source for players that report state through events (e.g. react-native-video). */
export interface MediaReporter {
  /** Merges a partial update; emits `media.changed` when state, rate, duration or error change. */
  update(patch: Partial<MediaSnapshot>): void;
  readonly snapshot: MediaSnapshot;
  /** Unregisters the player. */
  dispose(): void;
}

/** Lists players discovered dynamically (e.g. `<video>` elements). */
export type MediaProvider = () => readonly MediaInfo[];

const ACTIVE: readonly MediaState[] = ['playing', 'buffering', 'loading'];

const INITIAL: MediaSnapshot = { state: 'idle', position: 0, duration: null, rate: 1 };

/**
 * Registry of the app's media players, backing the `media` domain. Players are registered by
 * apps or adapters; `media.get` without an id answers with the primary player: the most
 * recently active one.
 */
export class MediaRegistry {
  private readonly sources = new Map<string, MediaSource>();
  private readonly providers: MediaProvider[] = [];
  private readonly recency = new Map<string, number>();
  private readonly lastSent = new Map<string, string>();
  private clock = 0;
  /** Set by the runtime: receives `media.changed` payloads. */
  onChanged: ((info: MediaInfo) => void) | null = null;

  register(id: string, source: MediaSource): () => void {
    this.sources.set(id, source);
    this.touch(id);
    this.changed(id);
    return () => {
      if (this.sources.get(id) === source) {
        this.sources.delete(id);
        this.recency.delete(id);
        this.lastSent.delete(id);
      }
    };
  }

  addProvider(provider: MediaProvider): () => void {
    this.providers.push(provider);
    return () => {
      const i = this.providers.indexOf(provider);
      if (i >= 0) this.providers.splice(i, 1);
    };
  }

  reporter(id: string, initial: Partial<MediaSnapshot> = {}): MediaReporter {
    let snapshot: MediaSnapshot = { ...INITIAL, ...initial };
    const unregister = this.register(id, { getSnapshot: () => snapshot });
    return {
      update: (patch) => {
        snapshot = { ...snapshot, ...patch };
        this.changed(id);
      },
      get snapshot() {
        return snapshot;
      },
      dispose: unregister,
    };
  }

  /**
   * Signals that player `id` may have changed. Emits `media.changed` when its state, rate,
   * duration or error differ from the last emitted values, or always with `force` (seeks).
   */
  changed(id: string, force = false): void {
    const info = this.find(id);
    if (!info) return;
    if (ACTIVE.indexOf(info.state) >= 0) this.touch(id);
    const signature = `${info.state}|${info.rate}|${info.duration}|${info.error ?? ''}`;
    if (!force && this.lastSent.get(id) === signature) return;
    this.lastSent.set(id, signature);
    this.touch(id);
    this.onChanged?.(info);
  }

  list(): MediaInfo[] {
    const out: MediaInfo[] = [];
    const seen: Record<string, true> = {};
    this.sources.forEach((source, id) => {
      const snap = safeSnapshot(source);
      if (snap) {
        out.push({ ...snap, id });
        seen[id] = true;
      }
    });
    for (const provider of this.providers) {
      for (const info of safeList(provider)) {
        if (!seen[info.id]) {
          out.push(info);
          seen[info.id] = true;
        }
      }
    }
    return out;
  }

  /** The player `id`, or the primary player when `id` is omitted. `null` when none. */
  get(id?: string): MediaInfo | null {
    if (id !== undefined) return this.find(id);
    let best: MediaInfo | null = null;
    let bestScore = -1;
    for (const info of this.list()) {
      const score = (ACTIVE.indexOf(info.state) >= 0 ? 1e9 : 0) + (this.recency.get(info.id) ?? 0);
      if (score > bestScore) {
        best = info;
        bestScore = score;
      }
    }
    return best;
  }

  private find(id: string): MediaInfo | null {
    const source = this.sources.get(id);
    if (source) {
      const snap = safeSnapshot(source);
      return snap ? { ...snap, id } : null;
    }
    for (const provider of this.providers) {
      for (const info of safeList(provider)) if (info.id === id) return info;
    }
    return null;
  }

  private touch(id: string): void {
    this.recency.set(id, ++this.clock);
  }
}

function safeSnapshot(source: MediaSource): MediaSnapshot | null {
  try {
    return source.getSnapshot();
  } catch {
    return null;
  }
}

function safeList(provider: MediaProvider): readonly MediaInfo[] {
  try {
    return provider();
  } catch {
    return [];
  }
}
