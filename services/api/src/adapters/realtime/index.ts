import { Redis } from "ioredis";

/**
 * Real-time change events. Every service write publishes one; WebSocket
 * connections forward them to users who can see the project. Clients treat an
 * event as a hint to refresh/sync — the offline sync protocol stays the source
 * of truth, so a missed event never loses data.
 */
export interface RealtimeEvent {
  type: string;
  organizationId: string;
  projectId: string | null;
  entityType: string;
  entityId: string | null;
  /** Only these users (e.g. notification recipients); otherwise all with project access. */
  userIds?: string[];
  /** Internal-only events are never sent to client/subcontractor sessions. */
  internal?: boolean;
  payload?: Record<string, unknown>;
  at: string;
}

export interface EventBus {
  publish(event: Omit<RealtimeEvent, "at">): void;
  subscribe(handler: (event: RealtimeEvent) => void): () => void;
  close(): Promise<void>;
}

export class InMemoryEventBus implements EventBus {
  private handlers = new Set<(event: RealtimeEvent) => void>();
  publish(event: Omit<RealtimeEvent, "at">): void {
    const full = { ...event, at: new Date().toISOString() };
    for (const h of this.handlers) {
      try {
        h(full);
      } catch {
        /* a broken subscriber must not break writers */
      }
    }
  }
  subscribe(handler: (event: RealtimeEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  async close() {
    this.handlers.clear();
  }
}

/** Redis pub/sub so events reach sockets on every API instance. */
export class RedisEventBus implements EventBus {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private local = new InMemoryEventBus();
  private static CHANNEL = "pool-pm:events";

  constructor(url: string) {
    this.pub = new Redis(url, { maxRetriesPerRequest: 2 });
    this.sub = new Redis(url);
    void this.sub.subscribe(RedisEventBus.CHANNEL);
    this.sub.on("message", (_channel, message) => {
      try {
        const event = JSON.parse(message) as RealtimeEvent;
        this.local.publish(event);
      } catch {
        /* ignore malformed */
      }
    });
  }
  publish(event: Omit<RealtimeEvent, "at">): void {
    void this.pub.publish(RedisEventBus.CHANNEL, JSON.stringify({ ...event, at: new Date().toISOString() }));
  }
  subscribe(handler: (event: RealtimeEvent) => void) {
    return this.local.subscribe(handler);
  }
  async close() {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
