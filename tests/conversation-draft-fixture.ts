/** Mount the selected official Conversation's store/input lifecycle, including saved drafts. */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { onTestFinished } from 'vitest'
import { createConversationStore } from '../../../official-latest-standard/packages/client/ui-conversation/src/client/stores.ts'
import { EMPTY_CONVERSATION_SNAPSHOT } from '../../../official-latest-standard/packages/client/ui-conversation/src/client/contract/snapshot.ts'
import { DefaultConversationViews } from '../../../official-latest-standard/packages/client/ui-conversation/src/client/skeleton/DefaultConversationViews.tsx'
import type { InputHub } from '../../../official-latest-standard/packages/client/ui-conversation/src/client/input/hub.ts'
import type { SessionBinding } from '@deepseek-ai/dsh-client-sessions/client'

/** A string is a declared draft input on both registered official releases. */
export function saveConversationDraft(sessionId: string, text: string): void {
  createConversationStore().create(sessionId).actions.setDraft(text)
}

/** Read through the selected official store, preserving its declared persisted shape. */
export function storedConversationDraftText(sessionId: string): string {
  const draft = createConversationStore().create(sessionId).getSnapshot().draft
  return typeof draft === 'string' ? draft : draft.text
}

/** The real view's mount effect owns rc.2 hydration and both releases' persistence. */
export async function mountConversationDraft(hub: InputHub, binding: SessionBinding): Promise<void> {
  const store = createConversationStore().create(binding.sessionId)
  const input = hub.for(binding.ctx)
  const shell = hub.shell(binding.sessionId)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  onTestFinished(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  const props = {
    useConversationViews: (select: (value: never[]) => unknown) => select([]),
    useInspectCall: (select: (value: undefined) => unknown) => select(undefined),
    useStore: (select: (value: ReturnType<typeof store.getSnapshot>) => unknown) => select(store.getSnapshot()),
    useInput: (select: (value: ReturnType<typeof input.state.getSnapshot>) => unknown) => select(input.state.getSnapshot()),
    useSession: (select: (value: { blank: boolean }) => unknown) => select({ blank: true }),
    useConversation: (select: (value: typeof EMPTY_CONVERSATION_SNAPSHOT) => unknown) => select(EMPTY_CONVERSATION_SNAPSHOT),
    inputActions: shell.actions,
    actions: store.actions,
    bindDraftMirror: (write: (text: string) => void) => {
      if (!('bindMirror' in shell) || typeof shell.bindMirror !== 'function') throw Error('Selected Conversation has no declared draft mirror')
      return shell.bindMirror(write)
    },
    bindDraftPersistence: (write: Parameters<typeof shell.bindDraftPersistence>[0]) => shell.bindDraftPersistence(write),
    renderSlot: () => null,
    openView: () => {}
  }
  await act(async () => root.render(createElement(DefaultConversationViews, props as never)))
}
