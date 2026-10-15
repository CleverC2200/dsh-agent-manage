import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Translate } from './index.js'
import { userAgentApi, type UserAgentSkill, type UserAgentSkillOption, type UserAgentView } from './user-agent-api.js'
import css from './user-agents.module.css'

/** Agent-local forms own unsaved content; unmounting cancels reads and ignores late writes. */
export function AgentSkills({ agent, t, onSaved }: { agent: UserAgentView; t: Translate; onSaved: (agent: UserAgentView) => void }) {
  const [catalog, setCatalog] = useState<UserAgentSkillOption[]>([])
  const [mode, setMode] = useState<'existing' | 'personal' | 'edit'>()
  const [choice, setChoice] = useState('')
  const [editing, setEditing] = useState<UserAgentSkill>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const lifetime = useRef<AbortController>()
  const loading = useRef<AbortController>()
  const skills = agent.skills ?? []
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void userAgentApi.skillCatalog(controller.signal).then(rows => { if (!controller.signal.aborted) setCatalog(rows) })
      .catch(failure => { if (!controller.signal.aborted) setError(String(failure)) })
    return () => { controller.abort(); loading.current?.abort() }
  }, [agent.id])
  const cancel = () => { loading.current?.abort(); setMode(undefined); setEditing(undefined); setError(''); setBusy(false) }
  const save = async (next: UserAgentSkill[]) => {
    const controller = lifetime.current
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await userAgentApi.saveSkills(agent.id, next, controller?.signal)
      if (controller?.signal.aborted) return
      onSaved(result)
      if (result.publication === 'failed') { setError(result.error ?? t('agentSavedUnavailable')); return }
      setMode(undefined); setEditing(undefined); setMessage(t('agentSaved'))
    } catch (failure) { if (!controller?.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (!controller?.signal.aborted) setBusy(false) }
  }
  const edit = async (skill: UserAgentSkill) => {
    loading.current?.abort()
    const controller = new AbortController()
    loading.current = controller
    setMode('edit'); setEditing(skill); setName(skill.name); setDescription(skill.kind === 'personal' ? skill.description : '')
    setContent(skill.content ?? ''); setError(''); setMessage('')
    if (skill.kind !== 'reference' || skill.content !== undefined) return
    setBusy(true)
    try {
      const result = await userAgentApi.readSkill({ ...skill, description: '' }, controller.signal)
      if (!controller.signal.aborted) setContent(result.content)
    } catch (failure) { if (!controller.signal.aborted) setError(String(failure)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    let skill: UserAgentSkill
    if (mode === 'existing') {
      const source = catalog.find(row => row.name === choice)
      if (!source) { setError(t('agentSkillChoose')); return }
      skill = { kind: 'reference', name: source.name, provider: source.provider, ...(source.path ? { path: source.path } : {}), enabled: true }
    } else if (editing?.kind === 'reference') skill = { ...editing, content }
    else skill = { kind: 'personal', name, description, content, enabled: editing?.enabled ?? true }
    if (skills.some(row => row.name === skill.name && row.name !== editing?.name)) { setError(t('agentSkillDuplicate')); return }
    void save(editing ? skills.map(row => row.name === editing.name ? skill : row) : [...skills, skill])
  }
  return <section>
    <header className={css.heading}><h3 className={css.title}>{t('agentSkill')}</h3><button type="button" disabled={busy} onClick={() => { cancel(); setMode('existing'); setChoice(''); setName(''); setDescription(''); setContent('') }}>{t('agentSkillAdd')}</button></header>
    {skills.map(skill => <article className={css.row} key={skill.name}>
      <div className={css.title}><strong>{skill.name}</strong><span className={css.description}>{skill.kind === 'personal' ? t('agentPersonal') : skill.provider}</span></div>
      <button type="button" disabled={busy} onClick={() => void edit(skill)}>{t('agentSkillEdit')}</button>
      <button type="button" role="switch" aria-label={t('agentEnabled', { name: skill.name })} aria-checked={skill.enabled} className={skill.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => void save(skills.map(row => row.name === skill.name ? { ...row, enabled: !row.enabled } : row))}><span /></button>
    </article>)}
    {!skills.length && !mode && <p className={css.muted}>{t('agentSkillEmpty')}</p>}
    {mode && <form className={css.inline} onSubmit={submit}>
      {mode !== 'edit' && <div className={css.heading}><button type="button" disabled={busy} aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>{t('agentSkillExisting')}</button><button type="button" disabled={busy} aria-pressed={mode === 'personal'} onClick={() => setMode('personal')}>{t('agentSkillPersonal')}</button></div>}
      {mode === 'existing' ? <label>{t('agentSkillExisting')}<select required disabled={busy} value={choice} onChange={event => setChoice(event.target.value)}><option value="">{t('agentSkillChoose')}</option>{catalog.map(row => <option key={row.name} value={row.name} disabled={skills.some(skill => skill.name === row.name)}>{row.name} · {row.description}</option>)}</select></label> : <>
        <label>{t('agentSkillName')}<input required disabled={busy || mode === 'edit'} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={name} onChange={event => setName(event.target.value)} /></label>
        {editing?.kind !== 'reference' && <label>{t('agentDescription')}<input required disabled={busy} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>}
        <label>{t('agentSkillContent')}<textarea required disabled={busy} rows={12} maxLength={96000} value={content} onChange={event => setContent(event.target.value)} /></label>
        {editing?.kind === 'reference' && <p className={css.muted}>{t('agentSkillOverride')}</p>}
      </>}
      <footer className={css.actions}><button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button><button type="submit" className={css.primary} disabled={busy}>{t('save')}</button></footer>
    </form>}
    {error && <p role="alert" className={css.error}>{error}</p>}{message && <p role="status" className={css.muted}>{message}</p>}
  </section>
}
