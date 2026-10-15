import React, { useState } from 'react'
import type { Translate } from './index.js'
import { userAgentApi, type UserAgentView } from './user-agent-api.js'
import css from './user-agents.module.css'

/** Personal configuration actions only; Core remains the Session/default/draft owner. */
export function AgentRecovery({ agent, t, onChanged, onChooseAnother }: {
  agent: UserAgentView
  t: Translate
  onChanged: (agent: UserAgentView) => void
  onChooseAnother: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => Promise<UserAgentView>) => {
    setBusy(true)
    setError('')
    try { onChanged(await action()); setConfirmDelete(false) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <aside aria-label={t('agentRecovery')}>
    {agent.defaultUnavailable && <p role="alert">{t('agentDefaultUnavailable')}</p>}
    {agent.publication !== 'ready' && <>
      <p>{t(agent.publication === 'deleted' ? 'agentDeletedRecovery' : agent.publication === 'disabled' ? 'agentDisabledRecovery' : 'agentDependencyRecovery')}</p>
      <p className={css.muted}>{t('agentColdRecoveryLimit')}</p>
      {agent.publication === 'deleted'
        ? <button type="button" disabled={busy} onClick={() => void run(() => userAgentApi.restore(agent.id))}>{t('agentRestore')}</button>
        : <button type="button" disabled={busy} onClick={() => void run(() => userAgentApi.setEnabled(agent.id, true))}>{t('agentEnableRecovery')}</button>}
      <button type="button" disabled={busy} onClick={onChooseAnother}>{t('agentChooseAnother')}</button>
    </>}
    {agent.publication !== 'deleted' && (confirmDelete ? <div>
      <p>{t('agentDeleteConfirmation')}</p>
      <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>{t('cancel')}</button>
      <button type="button" disabled={busy} onClick={() => void run(() => userAgentApi.remove(agent.id))}>{t('agentDeleteConfirm')}</button>
    </div> : <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('agentDelete')}</button>)}
    {error && <p role="alert" className={css.error}>{error}</p>}
  </aside>
}
