export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushProvider {
  readonly id: string;
  /** Returns tokens the provider reported as invalid so they can be disabled. */
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
}

/** Expo Push Service (delivers to APNs and FCM). */
export class ExpoPushProvider implements PushProvider {
  readonly id = "expo";
  constructor(
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await this.fetchImpl("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(chunk.map((m) => ({ ...m, sound: "default" }))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Expo push failed with ${res.status}`);
      const body = (await res.json()) as { data: { status: string; details?: { error?: string } }[] };
      body.data.forEach((ticket, idx) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") invalidTokens.push(chunk[idx]!.to);
      });
    }
    return { invalidTokens };
  }
}

export class LogPushProvider implements PushProvider {
  readonly id = "log";
  sent: PushMessage[] = [];
  constructor(private readonly log: (msg: string) => void = () => undefined) {}
  async send(messages: PushMessage[]) {
    this.sent.push(...messages);
    for (const m of messages) this.log(`[push] ${m.to}: ${m.title} — ${m.body}`);
    return { invalidTokens: [] };
  }
}
