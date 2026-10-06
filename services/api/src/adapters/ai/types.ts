export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Minimal LLM abstraction. Context passed in is always assembled by the API
 * from data the requesting user is already authorized to see, so a provider
 * can never widen access.
 */
export interface AiProvider {
  readonly id: string;
  complete(input: { system: string; messages: AiMessage[]; maxTokens?: number }): Promise<{ text: string; model: string }>;
}
