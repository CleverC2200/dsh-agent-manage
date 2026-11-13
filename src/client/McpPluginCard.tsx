import { createElement as h, useCallback, useEffect, useState, type ReactNode } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpBackendInfo } from './api.js'
import { ToggleSwitch } from './ui/ToggleSwitch.js'
import css from './plugin-settings.module.css'

type CardTranslate = (key: string, params?: Record<string, unknown>) => string

const chevronIcon = (primitives as unknown as Record<string, unknown>)['IconChevronDownOutline14'] as
  | ((props: { size?: number }) => ReactNode)
  | undefined

export interface McpEnhanceScopeFace {

  enhanced(): boolean

  writable(): boolean
  subscribe(listener: () => void): () => void
  setEnhanced(next: boolean): Promise<void>

  region(): 'auto' | 'global' | 'china'
  setRegion(next: 'global' | 'china'): Promise<void>

  feedbackEnabled?(): boolean
  scanProjectLayouts?(): boolean
  setScanProjectLayouts?(next: boolean): Promise<void>

  setFeedbackEnabled?(next: boolean): Promise<void>
}

export interface McpPluginCardProps {
  t: CardTranslate
  scope: McpEnhanceScopeFace

  probe: () => Promise<McpBackendInfo>
}

export function McpPluginCard({ t, scope, probe }: McpPluginCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const [probeInfo, setProbeInfo] = useState<McpBackendInfo | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => scope.subscribe(() => setTick(tick => tick + 1)), [scope])

  const refreshProbe = useCallback(async () => {
    try {
      setProbeInfo(await probe())
    } catch {

    }
  }, [probe])

  useEffect(() => { void refreshProbe() }, [refreshProbe])

  const enhanced = scope.enhanced()
  const writable = scope.writable()
  const regionSetting = scope.region()

  const effectiveRegion = regionSetting === 'auto' ? (probeInfo?.downloadRegion.effective ?? 'global') : regionSetting

  const hostUsable = probeInfo?.hostClient.available === true

  const onToggle = (): void => {
    if (busy || !writable) return
    const next = !enhanced
    if (!next && !hostUsable) {
      setError(t('mcpBackendHostMissing'))
      return
    }
    setBusy(true)
    setError(undefined)
    void scope.setEnhanced(next).then(() => {
      setBusy(false)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    })
  }

  return h(
    'div',
    {
      className: open ? `${css.pluginCard} ${css.pluginCardOpen}` : css.pluginCard,
      'data-busy': busy ? 'true' : undefined
    },
    h(
      'button',
      {
        type: 'button',
        className: css.pluginCardHeader,
        'aria-expanded': open,
        onClick: () => { setOpen(current => !current) },
      },      h(
        'div',
        { className: css.pluginCardText },
        h('div', { className: css.pluginCardTitle }, t('nav')),
        h('div', { className: css.pluginCardDesc }, t('marketCardDesc'))
      ),
      h(
        'span',
        { className: open ? `${css.pluginChevron} ${css.pluginChevronOpen}` : css.pluginChevron },
        chevronIcon !== undefined ? h(chevronIcon, { size: 14 }) : '▾'
      )
    ),
    open
      ? h(
          'div',
          { className: css.pluginCardBody },
          h(
            'div',
            { className: css.pluginCardRow },
            h(
              'div',
              { className: css.pluginCardText },
              h('div', { className: css.pluginCardRowLabel }, t('mcpCardTitle')),
              h('div', { className: css.pluginCardDesc }, enhanced ? t('mcpCardDescOn') : t('mcpCardDescOff'))
            ),
            h(ToggleSwitch, {
              on: enhanced,
              disabled: busy || !writable,
              title: writable ? undefined : t('mcpCardReadonly'),
              onChange: onToggle
            })
          ),
          error !== undefined
            ? h('div', { className: css.pluginCardError }, error)
            : null,
          h(
            'div',
            { className: css.pluginCardRow },
            h(
              'div',
              { className: css.pluginCardText },
              h('div', { className: css.pluginCardRowLabel }, t('regionLabel')),
              h('div', { className: css.pluginCardDesc }, t('regionHint'))
            ),
            h(
              'div',
              { className: css.regionSeg },
              (['global', 'china'] as const).map(region =>
                h(
                  'button',
                  {
                    key: region,
                    type: 'button',
                    disabled: busy || !writable,
                    className: effectiveRegion === region ? css.regionSegOn : css.regionSegBtn,
                    'aria-pressed': effectiveRegion === region,
                    onClick: () => {
                      if (regionSetting === region) return
                      setBusy(true)
                      setError(undefined)
                      void scope.setRegion(region).then(() => {
                        setBusy(false)
                      }).catch((cause: unknown) => {
                        setError(cause instanceof Error ? cause.message : String(cause))
                        setBusy(false)
                      })
                    }
                  },
                  region === 'global' ? t('regionGlobal') : t('regionChina')
                )
              )
            )
          ),
          scope.scanProjectLayouts !== undefined && scope.setScanProjectLayouts !== undefined
            ? h('div', { className: css.pluginCardRow },
                h('div', { className: css.pluginCardText }, h('div', { className: css.pluginCardRowLabel }, t('projectLayoutsLabel'))),
                h(ToggleSwitch, {
                  on: scope.scanProjectLayouts(),
                  title: t('projectLayoutsLabel'),
                  disabled: busy || !writable,
                  onChange: () => {
                    if (busy || !writable) return
                    setBusy(true)
                    setError(undefined)
                    void scope.setScanProjectLayouts!(!scope.scanProjectLayouts!()).catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : String(cause))
                    }).finally(() => setBusy(false))
                  }
                }))
            : null,
          scope.feedbackEnabled !== undefined && scope.setFeedbackEnabled !== undefined
            ? h(
                'div',
                { className: css.pluginCardRow },
                h(
                  'div',
                  { className: css.pluginCardText },
                  h('div', { className: css.pluginCardRowLabel }, t('feedbackToggleLabel')),
                  h('div', { className: css.pluginCardDesc }, scope.feedbackEnabled() ? t('feedbackToggleDescOn') : t('feedbackToggleDescOff'))
                ),
                h(ToggleSwitch, {
                  on: scope.feedbackEnabled(),
                  disabled: busy || !writable,
                  onChange: () => {
                    if (busy || !writable) return
                    setBusy(true)
                    setError(undefined)
                    void scope.setFeedbackEnabled!(!scope.feedbackEnabled!()).then(() => {
                      setBusy(false)
                    }).catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : String(cause))
                      setBusy(false)
                    })
                  }
                })
              )
            : null
        )
      : null
  )
}
