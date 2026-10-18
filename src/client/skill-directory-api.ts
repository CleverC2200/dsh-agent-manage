import { SKILL_DIRECTORY_ROUTES, type SkillDirectoryView, type SkillDirectoryAcquisition, type SkillDirectorySourcePreview } from '../contracts/skill-directories.js'
import type { CommitAgentSource } from '../contracts/agent-sources.js'
import { SKILL_EDITOR_ROUTE, type SkillEditorSession } from '../contracts/skill-editor.js'
import type { UserAgentView } from '../contracts/user-agents.js'
import { request } from './user-agent-api.js'

type Target = { id: string; name: string }
type Version = Target & Pick<SkillDirectoryView, 'revision'>
export interface SkillDirectoryFile { path: string; data: string; encoding: 'utf8' | 'base64'; fileVersion: string }
export const skillDirectoryApi = {
  acquire: (value: { kind: 'local'; path: string } | { kind: 'zip'; data: string } | { kind: 'git'; url: string; branch?: string }, signal?: AbortSignal) => request<SkillDirectoryAcquisition>(SKILL_DIRECTORY_ROUTES.acquire, value, signal),
  import: (value: { id: string; token: string; path: string; replace?: boolean }, signal?: AbortSignal) => request<UserAgentView>(SKILL_DIRECTORY_ROUTES.import, value, signal),
  cancel: (token: string) => request<null>(SKILL_DIRECTORY_ROUTES.cancel, { token }),
  open: (value: Target, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.open, value, signal),
  read: (value: Target & { path: string }, signal?: AbortSignal) => request<SkillDirectoryFile>(SKILL_DIRECTORY_ROUTES.read, value, signal),
  write: (value: Version & { path: string; data: string; encoding: SkillDirectoryFile['encoding']; fileVersion: string | null }, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.write, value, signal),
  rename: (value: Version & { path: string; to: string; fileVersion: string }, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.rename, value, signal),
  delete: (value: Version & { path: string; fileVersion: string }, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.delete, value, signal),
  apply: (value: Version, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.apply, value, signal),
  reset: (value: Version, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.reset, value, signal),
  restore: (value: Version, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.restore, value, signal),
  sourcePreview: (value: Target, signal?: AbortSignal) => request<SkillDirectorySourcePreview>(SKILL_DIRECTORY_ROUTES.sourcePreview, value, signal),
  sourceCommit: (value: CommitAgentSource, signal?: AbortSignal) => request<SkillDirectoryView>(SKILL_DIRECTORY_ROUTES.sourceCommit, value, signal),
  sourceCancel: (token: string) => request<null>(SKILL_DIRECTORY_ROUTES.sourceCancel, { token }),
  editor: (value: Version, signal?: AbortSignal) => request<SkillEditorSession>(SKILL_EDITOR_ROUTE, value, signal)
}

export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(Error('FILE_READ_FAILED'))
    reader.onerror = () => reject(reader.error ?? Error('FILE_READ_FAILED'))
    reader.readAsDataURL(file)
  })
}
