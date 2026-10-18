import type { AgentSourceConflict } from './agent-sources.js'

export interface SkillDirectoryCandidate {
  name: string
  description: string
  path: string
}
export interface SkillDirectoryAcquisition {
  token: string
  candidates: SkillDirectoryCandidate[]
  errors: string[]
}
export interface SkillDirectoryView {
  id: string
  name: string
  cwd: string
  entry: string
  revision: number
  files: Array<{ path: string; size: number; binary: boolean; executable: boolean }>
  source?: { kind: 'git'; url: string; branch?: string; commit: string }
  changes: Array<{ path: string; kind: 'added' | 'modified' | 'deleted' }>
}

export const SKILL_DIRECTORY_ROUTES = {
  acquire: '/api/agent-manage/agents/skills/directory/acquire',
  import: '/api/agent-manage/agents/skills/directory/import',
  cancel: '/api/agent-manage/agents/skills/directory/cancel',
  open: '/api/agent-manage/agents/skills/directory/open',
  read: '/api/agent-manage/agents/skills/directory/read',
  write: '/api/agent-manage/agents/skills/directory/write',
  rename: '/api/agent-manage/agents/skills/directory/rename',
  delete: '/api/agent-manage/agents/skills/directory/delete',
  apply: '/api/agent-manage/agents/skills/directory/apply',
  reset: '/api/agent-manage/agents/skills/directory/reset',
  restore: '/api/agent-manage/agents/skills/directory/restore',
  sourcePreview: '/api/agent-manage/agents/skills/directory/source-preview',
  sourceCommit: '/api/agent-manage/agents/skills/directory/source-commit',
  sourceCancel: '/api/agent-manage/agents/skills/directory/source-cancel'
} as const

export interface SkillDirectorySourcePreview {
  token: string
  id: string
  name: string
  changed: boolean
  commit: string
  conflicts: AgentSourceConflict[]
}
