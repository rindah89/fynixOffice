import type { AiProviderConfig, AiProviderId } from '@fynixoffice/ai-provider'

/**
 * Server-held LLM credentials. The desktop never sees these keys — only an
 * opaque suite session. No per-user credits or billing tags.
 */
export interface OfficeLlmConfig {
  provider: AiProviderId
  config: AiProviderConfig
  /** When false, /ai/* returns 503 (auth still works). */
  enabled: boolean
}

const PROVIDERS: AiProviderId[] = [
  'genspark',
  'anthropic',
  'gemini',
  'deepseek',
  'openai',
  'custom',
]

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): OfficeLlmConfig {
  const rawProvider = (env.OFFICE_LLM_PROVIDER || 'anthropic').toLowerCase()
  const provider = (PROVIDERS.includes(rawProvider as AiProviderId)
    ? rawProvider
    : 'anthropic') as AiProviderId
  const apiKey = env.OFFICE_LLM_API_KEY || ''
  const model =
    env.OFFICE_LLM_MODEL ||
    (provider === 'anthropic'
      ? 'claude-sonnet-4-6'
      : provider === 'openai'
        ? 'gpt-4.1-mini'
        : provider === 'gemini'
          ? 'gemini-2.5-flash'
          : 'claude-sonnet-4-6')
  const baseUrl = env.OFFICE_LLM_BASE_URL || undefined
  return {
    provider,
    enabled: Boolean(apiKey),
    config: {
      apiKey,
      model,
      ...(baseUrl ? { baseUrl } : {}),
    },
  }
}
