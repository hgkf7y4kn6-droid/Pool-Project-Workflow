export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development mailer: logs messages and keeps them for tests. */
export class ConsoleMailer implements Mailer {
  outbox: MailMessage[] = [];
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async send(message: MailMessage) {
    this.outbox.push(message);
    this.log(`[mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(message: MailMessage) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend failed with ${res.status}: ${await res.text()}`);
  }
}
