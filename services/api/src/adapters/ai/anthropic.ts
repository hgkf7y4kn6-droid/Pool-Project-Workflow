import Anthropic from "@anthropic-ai/sdk";
import type { AiMessage, AiProvider } from "./types";

/**
 * Claude via the official Anthropic SDK. Server-side refusal fallback is
 * enabled ("default" routing) so a safety decline is retried on a fallback
 * model inside the same call instead of failing the request.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = "claude-opus-5-5",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async complete(input: { system: string; messages: AiMessage[]; maxTokens?: number }): Promise<{ text: string; model: string }> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: input.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Project Q&A and summaries are routine; medium keeps latency and cost reasonable.
      output_config: { effort: "medium" },
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    if (response.stop_reason === "refusal") {
      return { text: "I can't help with that request.", model: response.model };
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { text, model: response.model };
  }
}
