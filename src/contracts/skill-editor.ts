export const SKILL_EDITOR_ROUTE = '/api/agent-manage/agents/skills/directory/editor'
export const SKILL_EDITOR_PRESET = 'skill-directory-editor'
export interface SkillEditorSession {
  sessionId: string
  preset: string
  cwd: string
  draft: string
}
