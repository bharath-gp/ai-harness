import type { Register } from 'claude-code'

import { register as blastRadius } from './blast-radius'
import { register as secretSentry } from './secret-sentry'
import { reflectSessionStart, reflectCommandRunReflectQueue, reflectCommandRunReflectPause, reflectPromptSubmit, reflectUiRenderAbovePrompt } from './reflect'
import { assumptionTrackerSessionStart, assumptionTrackerPromptSubmit, assumptionTrackerUiRenderAbovePrompt, assumptionTrackerCommandRunAssumptions, assumptionTrackerTurnComplete, assumptionTrackerUiRenderPaneAssumptions } from './assumption-tracker'
import { selfCritiqueSessionStart, selfCritiqueTurnComplete, selfCritiqueCommandRunCritique, selfCritiqueUiRenderPaneCritique } from './self-critique'

// Each mod is on unless its userConfig flag is false (toggle in the config menu; the module reloads).
export const register: Register = (on, options) => {
  if (options.blastRadius !== false) blastRadius(on)
  if (options.secretSentry !== false) secretSentry(on)
  on('session.start', ($, e, next) => {
    const n3 = (x: any) => next(x)
    const n2 = (x: any) => (options.selfCritique === false ? n3(x) : selfCritiqueSessionStart($, x, n3))
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerSessionStart($, x, n2))
    return options.reflect === false ? n1(e) : reflectSessionStart($, e, n1)
  })
  if (options.reflect !== false) on('command.run', { command: 'reflect-queue' }, reflectCommandRunReflectQueue)
  if (options.reflect !== false) on('command.run', { command: 'reflect-pause' }, reflectCommandRunReflectPause)
  on('prompt.submit', ($, e, next) => {
    const n2 = (x: any) => next(x)
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerPromptSubmit($, x, n2))
    return options.reflect === false ? n1(e) : reflectPromptSubmit($, e, n1)
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const n2 = (x: any) => next(x)
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerUiRenderAbovePrompt($, x, n2))
    return options.reflect === false ? n1(e) : reflectUiRenderAbovePrompt($, e, n1)
  })
  if (options.assumptionTracker !== false) on('command.run', { command: 'assumptions' }, assumptionTrackerCommandRunAssumptions)
  on('turn.complete', ($, e, next) => {
    const n2 = (x: any) => next(x)
    const n1 = (x: any) => (options.selfCritique === false ? n2(x) : selfCritiqueTurnComplete($, x, n2))
    return options.assumptionTracker === false ? n1(e) : assumptionTrackerTurnComplete($, e, n1)
  })
  if (options.assumptionTracker !== false) on('ui.render', { component: 'Pane', requestId: 'assumptions' }, assumptionTrackerUiRenderPaneAssumptions)
  if (options.selfCritique !== false) on('command.run', { command: 'critique' }, selfCritiqueCommandRunCritique)
  if (options.selfCritique !== false) on('ui.render', { component: 'Pane', requestId: 'critique' }, selfCritiqueUiRenderPaneCritique)
}
