export type GuardrailsCoached = boolean

declare module 'claude-code' {
  interface PluginState {
    // prompt-coach: has this session's first prompt been coached (one value per session id)
    guardrails: { coached: StateFamily<GuardrailsCoached> }
  }
}
