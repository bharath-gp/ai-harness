export type GuardrailsCoached = boolean

// decision-models: the session's local decision stats (cockpit reads them).
export type GuardrailsDecisions = {
  tokens: number // local input tokens: usage.input_tokens of every /v1/systemone call, the benchmark excluded
  calls: number // /v1/systemone requests
  llmTokens: number // est: per decision, the final reply's input_tokens + 60 (a short Claude answer)
  avoided?: number // est: per auto-answered AskUserQuestion, the session's context tokens then (what a round trip through the user re-sends)
  gate: { auto: number; asked: number }
  answers: { auto: number; asked: number }
  models: { picked: number; kept: number }
  offline: boolean
  fast: string
  strong: string
  recent: { id?: string; kind: 'gate' | 'blast' | 'answer' | 'model'; text: string; verdict: string; model: string; confidence: number; at: number }[] // last 30
}

declare module 'claude-code' {
  interface PluginState {
    // merge-sweep: PR URLs this session opened (one list per session id)
    // prompt-coach: has this session's first prompt been coached (one value per session id)
    // decision-models: local decision stats for this session
    guardrails: { coached: StateFamily<GuardrailsCoached>; prs: StateFamily<string[]>; decisions: GuardrailsDecisions }
  }
}
