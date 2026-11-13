export const MAX_JSON_BODY_BYTES = 64 * 1024

export class RequestBodyTooLarge extends Error {
  constructor() {
    super('REQUEST_BODY_TOO_LARGE')
  }
}

export async function readJsonRequest(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  request.signal.throwIfAborted()
  const reader = request.body?.getReader()
  if (!reader) throw new Error('INVALID_JSON_BODY')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      request.signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new RequestBodyTooLarge()
      }
      chunks.push(value)
    }
    request.signal.throwIfAborted()
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    reader.releaseLock()
  }
}
