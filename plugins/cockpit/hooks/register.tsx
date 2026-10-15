import type { Register } from 'claude-code'

import { agentsProgressSessionStart, agentsProgressCommandRunAgentsInfo, agentsProgressAgentSpawn, agentsProgressToolCall, agentsProgressUiRenderAbovePrompt, agentsProgressUiRenderPaneAgents } from './agents-progress'
import { cacheKeeperSessionStart, cacheKeeperUiRenderAbovePrompt, cacheKeeperCommandRunKeepwarm, cacheKeeperCommandRunCacheTax, cacheKeeperPromptSubmit, cacheKeeperTurnComplete } from './cache-keeper'
import { contextHealthSessionStart, contextHealthUiRenderAbovePrompt, contextHealthTurnComplete, contextHealthToolCall, contextHealthPromptSubmit, contextHealthCommandRunHandoff, contextHealthCommandRunAutohandoff } from './context-health'
import { filetreeSessionStart, filetreeToolCall, filetreeUiRenderAbovePrompt, filetreePromptSubmit, filetreeCommandRunFiletree, filetreeUiRenderPaneFiletree } from './filetree'
import { nextStepsUiRenderAbovePrompt, nextStepsPromptSubmit, nextStepsTurnComplete } from './next-steps'

// Each mod is on unless its userConfig flag is false (toggle in the config menu; the module reloads).
export const register: Register = (on, options) => {
  on('session.start', ($, e, next) => {
    const n4 = (x: any) => next(x)
    const n3 = (x: any) => (options.filetree === false ? n4(x) : filetreeSessionStart($, x, n4))
    const n2 = (x: any) => (options.contextHealth === false ? n3(x) : contextHealthSessionStart($, x, n3))
    const n1 = (x: any) => (options.cacheKeeper === false ? n2(x) : cacheKeeperSessionStart($, x, n2))
    return options.agentsProgress === false ? n1(e) : agentsProgressSessionStart($, e, n1)
  })
  if (options.agentsProgress !== false) on('command.run', { command: 'agents-info' }, agentsProgressCommandRunAgentsInfo)
  if (options.agentsProgress !== false) on('agent.spawn', agentsProgressAgentSpawn)
  on('tool.call', ($, e, next) => {
    const n3 = (x: any) => next(x)
    const n2 = (x: any) => (options.contextHealth === false ? n3(x) : contextHealthToolCall($, x, n3))
    const n1 = (x: any) => (options.filetree === false ? n2(x) : filetreeToolCall($, x, n2))
    return options.agentsProgress === false ? n1(e) : agentsProgressToolCall($, e, n1)
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const n5 = (x: any) => next(x)
    const n4 = (x: any) => (options.nextSteps === false ? n5(x) : nextStepsUiRenderAbovePrompt($, x, n5))
    const n3 = (x: any) => (options.filetree === false ? n4(x) : filetreeUiRenderAbovePrompt($, x, n4))
    const n2 = (x: any) => (options.contextHealth === false ? n3(x) : contextHealthUiRenderAbovePrompt($, x, n3))
    const n1 = (x: any) => (options.cacheKeeper === false ? n2(x) : cacheKeeperUiRenderAbovePrompt($, x, n2))
    return options.agentsProgress === false ? n1(e) : agentsProgressUiRenderAbovePrompt($, e, n1)
  })
  if (options.agentsProgress !== false) on('ui.render', { component: 'Pane', requestId: 'agents' }, agentsProgressUiRenderPaneAgents)
  if (options.cacheKeeper !== false) on('command.run', { command: 'keepwarm' }, cacheKeeperCommandRunKeepwarm)
  if (options.cacheKeeper !== false) on('command.run', { command: 'cache-tax' }, cacheKeeperCommandRunCacheTax)
  on('prompt.submit', ($, e, next) => {
    const n4 = (x: any) => next(x)
    const n3 = (x: any) => (options.contextHealth === false ? n4(x) : contextHealthPromptSubmit($, x, n4))
    const n2 = (x: any) => (options.nextSteps === false ? n3(x) : nextStepsPromptSubmit($, x, n3))
    const n1 = (x: any) => (options.filetree === false ? n2(x) : filetreePromptSubmit($, x, n2))
    return options.cacheKeeper === false ? n1(e) : cacheKeeperPromptSubmit($, e, n1)
  })
  on('turn.complete', ($, e, next) => {
    const n3 = (x: any) => next(x)
    const n2 = (x: any) => (options.nextSteps === false ? n3(x) : nextStepsTurnComplete($, x, n3))
    const n1 = (x: any) => (options.contextHealth === false ? n2(x) : contextHealthTurnComplete($, x, n2))
    return options.cacheKeeper === false ? n1(e) : cacheKeeperTurnComplete($, e, n1)
  })
  if (options.contextHealth !== false) on('command.run', { command: 'handoff' }, contextHealthCommandRunHandoff)
  if (options.contextHealth !== false) on('command.run', { command: 'autohandoff' }, contextHealthCommandRunAutohandoff)
  if (options.filetree !== false) on('command.run', { command: 'filetree' }, filetreeCommandRunFiletree)
  if (options.filetree !== false) on('ui.render', { component: 'Pane', requestId: 'filetree' }, filetreeUiRenderPaneFiletree)
}
