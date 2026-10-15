import { isSameOriginRequest } from './request-origin.js'
import type { Context } from '@deepseek-ai/cordis'
import { AGENT_SOURCE_ROUTES } from '../contracts/agent-sources.js'
import type { AgentSources } from './agent-sources.js'
import { readJsonRequest, RequestBodyTooLarge } from './request-body.js'

/** Authenticated Host transport; imported declarations cannot choose owner or Consumer. */
export function mountAgentSourceRoutes(host: Pick<Context, 'connection' | 'effect'>, sources: AgentSources): void {
  for (const [action, path] of Object.entries(AGENT_SOURCE_ROUTES)) {
    const mutation = action !== 'list'
    host.effect(() =>
      host.connection.fetch.register({
        path,
        methods: [mutation ? 'POST' : 'GET'],
        requestBody: mutation ? 'streaming' : 'buffered',
        fetch: async request => {
          try {
            if (mutation && !isSameOriginRequest(request)) return Response.json({ error: 'CROSS_ORIGIN_REQUEST' }, { status: 403 })
            const result =
              action === 'list'
                ? await sources.list()
                : action === 'acquire'
                  ? await sources.acquire(await readJsonRequest(request), request.signal)
                  : action === 'preview'
                    ? await sources.preview(await readJsonRequest(request), request.signal)
                    : action === 'commit'
                      ? await sources.commit(await readJsonRequest(request), request.signal)
                      : action === 'cancel'
                        ? await sources.cancel(await readJsonRequest(request))
                        : await sources.import(await readJsonRequest(request), request.signal)
            return Response.json(result, { headers: { 'cache-control': 'no-store' } })
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 })
          }
        }
      })
    )
  }
}
