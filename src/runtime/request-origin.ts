/** Core admits the browser before dispatch; its Fetch bridge replaces the URL's origin. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const source = URL.canParse(origin) ? new URL(origin) : undefined
  const authority = request.headers.get('host') ?? new URL(request.url).host
  return source !== undefined && ['http:', 'https:'].includes(source.protocol) && source.host === authority
}
