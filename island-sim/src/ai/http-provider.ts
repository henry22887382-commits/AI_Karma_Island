import type { ModelProvider, ProviderCompletion } from './router.ts';

export type HttpProviderConfig = {
  readonly id: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs?: number;
};

export class HttpChatCompletionsProvider implements ModelProvider {
  readonly id: string;
  readonly ready: boolean;
  private readonly config: HttpProviderConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: HttpProviderConfig, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
    this.id = config.id;
    this.ready = Boolean(config.id && config.baseUrl && config.model && config.apiKey && Number.isSafeInteger(config.maxOutputTokens) && config.maxOutputTokens > 0);
  }

  async complete(input: string, maxOutputTokens: number): Promise<ProviderCompletion> {
    if (!this.ready) throw new Error('Provider is not configured.');
    const endpoint = new URL('chat/completions', `${this.config.baseUrl.replace(/\/+$/, '')}/`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);
    try {
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: input }],
          max_completion_tokens: Math.min(maxOutputTokens, this.config.maxOutputTokens),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}.`);
      const payload: unknown = await response.json();
      return parseCompletion(payload);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Provider request failed with HTTP ')) throw error;
      throw new Error(error instanceof Error && error.name === 'AbortError' ? 'Provider request timed out.' : 'Provider request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseCompletion(value: unknown): ProviderCompletion {
  if (!isRecord(value)) throw new Error('Provider response was not a JSON object.');
  const choices = value.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) throw new Error('Provider response had no completion choice.');
  const message = choices[0].message;
  if (!isRecord(message) || typeof message.content !== 'string') throw new Error('Provider response content was not text.');
  const usage = isRecord(value.usage) ? value.usage : undefined;
  const promptTokens = usage?.prompt_tokens;
  const completionTokens = usage?.completion_tokens;
  return {
    raw: message.content,
    ...(typeof promptTokens === 'number' && Number.isSafeInteger(promptTokens) && promptTokens >= 0
      && typeof completionTokens === 'number' && Number.isSafeInteger(completionTokens) && completionTokens >= 0
      ? { usage: { inputTokens: promptTokens, outputTokens: completionTokens } }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
