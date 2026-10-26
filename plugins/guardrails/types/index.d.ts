export type GuardrailsCoached = boolean

declare module 'claude-code' {
  interface PluginState {
    // merge-sweep: PR URLs this session opened (one list per session id)
    // prompt-coach: has this session's first prompt been coached (one value per session id)
    guardrails: { coached: StateFamily<GuardrailsCoached>; prs: StateFamily<string[]> }
  }
}
