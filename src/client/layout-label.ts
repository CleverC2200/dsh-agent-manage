/**
 * 文件作用：把后端套件布局标识转换为当前语言的显示文案。
 * 业务职责：集中维护稳定布局值与翻译键的映射，未知值原样返回，避免详情页丢失诊断信息。
 */
import type { SuiteLayoutKind } from '../model/types.js'
import type { Translate } from './index.js'

const KEYS = {
  'agent-plugin-v1': 'layoutV1',
  'claude-code': 'layoutCC',
  codex: 'layoutCodex',
  universal: 'layoutUniversal',
  cursor: 'layoutCursor',
  kimi: 'layoutKimi',
  zcode: 'layoutZcode',
  qoder: 'layoutQoder',
  'github-copilot': 'layoutCopilot',
  remote: 'layoutRemote',
  'project-native': 'layoutProjectNative',
  'skill-collection': 'layoutSkills'
} as const satisfies Record<SuiteLayoutKind, Parameters<Translate>[0]>

/** 将布局标识翻译成详情页文案，未知布局保持原始值。 */
export function suiteLayoutLabel(layout: string, t: Translate): string {
  return Object.hasOwn(KEYS, layout) ? t(KEYS[layout as SuiteLayoutKind]) : layout
}
