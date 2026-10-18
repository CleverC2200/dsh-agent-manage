import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Translate } from './index.js'
import { userAgentApi, type UserAgentSkill, type UserAgentSkillOption, type UserAgentView } from './user-agent-api.js'
import css from './user-agents.module.css'
import { SkillDirectoryEditor } from './SkillDirectoryEditor.js'
import { SkillDirectoryImport } from './SkillDirectoryImport.js'
import type { SkillEditorSession } from '../contracts/skill-editor.js'

/** Agent-local forms own unsaved content; unmounting cancels reads and ignores late writes. */
export function AgentSkills({ agent, t, onSaved, openEditor }: { agent: UserAgentView; t: Translate; onSaved: (agent: UserAgentView) => void; openEditor?: (session: SkillEditorSession) => Promise<void> }) {
  const [catalog, setCatalog] = useState<UserAgentSkillOption[]>([])
  const [mode, setMode] = useState<'existing' | 'personal'>()
  const [choice, setChoice] = useState('')
  const [editing, setEditing] = useState<UserAgentSkill>()
  const [importKind, setImportKind] = useState<'local' | 'zip' | 'git'>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const lifetime = useRef<AbortController>()
  const skills = agent.skills ?? []
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void userAgentApi.skillCatalog(controller.signal).then(rows => { if (!controller.signal.aborted) setCatalog(rows) })
      .catch(failure => { if (!controller.signal.aborted) setError(String(failure)) })
    return () => controller.abort()
  }, [agent.id])
  const cancel = () => { setMode(undefined); setEditing(undefined); setImportKind(undefined); setError(''); setBusy(false) }
  const save = async (next: UserAgentSkill[]) => {
    const controller = lifetime.current
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await (agent.origin === 'plugin' ? userAgentApi.savePluginSkills(agent.id, next, controller?.signal) : userAgentApi.saveSkills(agent.id, next, controller?.signal))
      if (controller?.signal.aborted) return
      onSaved(result)
      if (result.publication === 'failed') { setError(result.error ?? t('agentSavedUnavailable')); return }
      setMode(undefined); setEditing(undefined); setMessage(t('agentSaved'))
    } catch (failure) { if (!controller?.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (!controller?.signal.aborted) setBusy(false) }
  }
  const edit = (skill: UserAgentSkill) => { cancel(); setEditing(skill); setMessage('') }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    let skill: UserAgentSkill
    if (mode === 'existing') {
      const source = catalog.find(row => row.name === choice)
      if (!source) { setError(t('agentSkillChoose')); return }
      skill = { kind: 'reference', name: source.name, provider: source.provider, ...(source.path ? { path: source.path } : {}), enabled: true }
    } else skill = { kind: 'personal', name, description, content, enabled: true }
    if (skills.some(row => row.name === skill.name)) { setError(t('agentSkillDuplicate')); return }
    void save([...skills, skill])
  }
  return <section>
    <header className={css.panelHeading}><h3 className={css.title}>{t('agentSkill')}</h3><button type="button" disabled={busy || !!editing || !!importKind} onClick={() => { cancel(); setMode('existing'); setChoice(''); setName(''); setDescription(''); setContent('') }}>{t('agentSkillAdd')}</button></header>
    {skills.map(skill => <article className={css.mcpRow} key={skill.name}>
      <div className={css.title}><strong>{skill.name}</strong><span className={css.description}>{skill.kind === 'personal' ? t('agentPersonal') : skill.provider}</span></div>
      <button type="button" className={css.textButton} disabled={busy || !!editing || !!importKind} onClick={() => void edit(skill)}>{t('agentSkillEdit')}</button>
      <button type="button" role="switch" aria-label={t('agentEnabled', { name: skill.name })} aria-checked={skill.enabled} className={skill.enabled ? css.switchOn : css.switchOff} disabled={busy || !!editing || !!importKind} onClick={() => void save(skills.map(row => row.name === skill.name ? { ...row, enabled: !row.enabled } : row))}><span /></button>
    </article>)}
    {!skills.length && !mode && <p className={css.muted}>{t('agentSkillEmpty')}</p>}
    {mode && <div className={css.skillToolbar}>{(['local', 'zip', 'git'] as const).map(kind => <button type="button" key={kind} disabled={busy} onClick={() => { cancel(); setImportKind(kind) }}>{t(kind === 'local' ? 'agentSkillImportFolder' : kind === 'zip' ? 'agentSkillImportZip' : 'agentSkillImportGit')}</button>)}</div>}
    {importKind && <SkillDirectoryImport key={importKind} agent={agent} kind={importKind} t={t} onSaved={onSaved} onClose={() => setImportKind(undefined)} />}
    {editing && <SkillDirectoryEditor key={editing.name} agent={agent} name={editing.name} t={t} onSaved={onSaved} onClose={() => setEditing(undefined)} openEditor={openEditor} />}
    {mode && <form className={css.inline} onSubmit={submit}>
      <div className={css.heading}><button type="button" disabled={busy} aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>{t('agentSkillExisting')}</button><button type="button" disabled={busy} aria-pressed={mode === 'personal'} onClick={() => setMode('personal')}>{t('agentSkillPersonal')}</button></div>
      {mode === 'existing' ? <label>{t('agentSkillExisting')}<select required disabled={busy} value={choice} onChange={event => setChoice(event.target.value)}><option value="">{t('agentSkillChoose')}</option>{catalog.map(row => <option key={row.name} value={row.name} disabled={skills.some(skill => skill.name === row.name)}>{row.name} · {row.description}</option>)}</select></label> : <>
        <label>{t('agentSkillName')}<input required disabled={busy} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={name} onChange={event => setName(event.target.value)} /></label>
        <label>{t('agentDescription')}<input required disabled={busy} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <label>{t('agentSkillContent')}<textarea required disabled={busy} rows={12} maxLength={96000} value={content} onChange={event => setContent(event.target.value)} /></label>
      </>}
      <footer className={css.actions}><button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button><button type="submit" className={css.primary} disabled={busy}>{t('save')}</button></footer>
    </form>}
    {error && <p role="alert" className={css.error}>{error}</p>}{message && <p role="status" className={css.muted}>{message}</p>}
  </section>
}
