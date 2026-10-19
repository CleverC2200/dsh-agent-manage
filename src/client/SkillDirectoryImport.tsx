import React, { useEffect, useRef, useState } from 'react'
import type { Translate } from './index.js'
import type { UserAgentView } from '../contracts/user-agents.js'
import type { SkillDirectoryAcquisition } from '../contracts/skill-directories.js'
import { fileBase64, skillDirectoryApi } from './skill-directory-api.js'
import css from './user-agents.module.css'

export function SkillDirectoryImport({ agent, kind, t, onSaved, onClose }: { agent: UserAgentView; kind: 'local' | 'zip' | 'git'; t: Translate; onSaved: (agent: UserAgentView) => void; onClose: () => void }) {
  const [address, setAddress] = useState('')
  const [branch, setBranch] = useState('')
  const [archive, setArchive] = useState<File>()
  const [acquisition, setAcquisition] = useState<SkillDirectoryAcquisition>()
  const [selected, setSelected] = useState('')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const archiveInput = useRef<HTMLInputElement>(null)
  const directoryPicker = (globalThis as typeof globalThis & { __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> } }).__DSH_DIRECTORY_PICKER__
  const token = useRef<string>()
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    return () => { controller.abort(); if (token.current) void skillDirectoryApi.cancel(token.current).catch(() => {}) }
  }, [])
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const signal = lifetime.current!.signal
    setBusy(true); setError('')
    try { await action(signal) } catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const candidate = acquisition?.candidates.find(row => row.path === selected)
  const duplicate = !!candidate && agent.skills.some(row => row.name === candidate.name)
  const clearCandidates = () => { setAcquisition(undefined); setSelected(''); setReplace(false) }
  return <section className={css.inline} aria-label={t('agentSkillImport')}>
    <form onSubmit={event => { event.preventDefault(); void run(async signal => {
      if (token.current) { await skillDirectoryApi.cancel(token.current); token.current = undefined }
      const value = kind === 'local' ? { kind, path: address } : kind === 'git' ? { kind, url: address, ...(branch ? { branch } : {}) } : { kind, data: await fileBase64(archive!) }
      signal.throwIfAborted()
      const result = await skillDirectoryApi.acquire(value, signal)
      if (signal.aborted) { void skillDirectoryApi.cancel(result.token); return }
      token.current = result.token; setAcquisition(result); setSelected(result.candidates[0]?.path ?? ''); setReplace(false)
    }) }}>
      {kind === 'zip' ? <div className={css.skillImportPicker}>
        <span>{t('agentSkillZipFile')}</span>
        <input ref={archiveInput} type="file" accept=".zip,application/zip" hidden disabled={busy} aria-label={t('agentSkillZipFile')} onChange={event => { const file = event.target.files?.[0]; if (file) { setArchive(file); clearCandidates() } }} />
        <button type="button" disabled={busy} onClick={() => archiveInput.current?.click()}>{t('agentSkillPickZip')}</button>
        <span className={css.skillImportPath}>{archive?.name ?? t('agentSkillNothingSelected')}</span>
      </div> : kind === 'local' && directoryPicker ? <div className={css.skillImportPicker}>
        <span>{t('agentSkillFolder')}</span>
        <button type="button" disabled={busy} onClick={() => void run(async signal => { const path = await directoryPicker.pick(); if (!signal.aborted && path !== null) { setAddress(path); clearCandidates() } })}>{t('agentSkillPickFolder')}</button>
        <span className={css.skillImportPath}>{address || t('agentSkillNothingSelected')}</span>
      </div> : <label>{t(kind === 'local' ? 'agentSkillFolderPath' : 'agentSkillGitUrl')}<input name={kind === 'local' ? 'folderPath' : 'gitUrl'} required disabled={busy} value={address} onChange={event => setAddress(event.target.value)} /></label>}
      {kind === 'git' && <label>{t('agentSkillGitBranch')}<input disabled={busy} value={branch} onChange={event => setBranch(event.target.value)} /></label>}
      <footer className={css.actions}><button type="submit" disabled={busy || (kind === 'zip' ? !archive : !address)}>{t('agentSkillAcquire')}</button></footer>
    </form>
    {acquisition && <div>
      <label>{t('agentSkillChoose')}<select disabled={busy} value={selected} onChange={event => { setSelected(event.target.value); setReplace(false) }}>{acquisition.candidates.map(row => <option key={row.path} value={row.path}>{row.name} · {row.description} · {row.path}</option>)}</select></label>
      {acquisition.errors.map((error, index) => <p key={index} className={css.error}>{error}</p>)}
      {!acquisition.candidates.length && <p className={css.muted}>{t('agentSkillNoCandidates')}</p>}
      {duplicate && <label className={css.skillCheckbox}><input type="checkbox" checked={replace} disabled={busy} onChange={event => setReplace(event.target.checked)} />{t('agentSkillReplaceDuplicate')}</label>}
      <footer className={css.actions}><button type="button" className={css.primary} disabled={busy || !candidate || (duplicate && !replace)} onClick={() => void run(async signal => {
        const result = await skillDirectoryApi.import({ id: agent.id, token: acquisition.token, path: selected, ...(duplicate ? { replace } : {}) }, signal)
        if (signal.aborted) return
        token.current = undefined; onSaved(result); onClose()
      })}>{t('agentSkillImportSelected')}</button></footer>
    </div>}
    <footer className={css.actions}><button type="button" disabled={busy} onClick={() => void run(async () => { if (token.current) await skillDirectoryApi.cancel(token.current); token.current = undefined; onClose() })}>{t('cancel')}</button></footer>
    {error && <p role="alert" className={css.error}>{error}</p>}
  </section>
}
