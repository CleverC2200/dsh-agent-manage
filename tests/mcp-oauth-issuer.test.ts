import { describe, expect, it, vi } from 'vitest'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { LoopbackOAuthClientProvider } from '../src/runtime/mcp-client/oauth.js'

const ISSUER = 'https://trusted.example/'
const SERVER = 'https://mcp.example/mcp'
const tokens = { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer', issuer: ISSUER }
const client = { client_id: 'old-client', client_secret: 'old-secret', issuer: ISSUER }

function fixture(payload: Record<string, unknown>) {
  let record: unknown = { kind: 'grant', payload: structuredClone(payload) }
  const store = {
    describeRecord: async () => ({ configured: true, writable: true }),
    readRecord: async () => record,
    modifyRecord: vi.fn(async (_key: string, mutate: (current: unknown) => Promise<unknown>) => {
      record = await mutate(record)
      return record
    })
  }
  const provider = () =>
    new LoopbackOAuthClientProvider(
      'srv',
      {},
      undefined,
      () => {},
      store,
      async () => {}
    )
  return { store, provider, read: () => record }
}

function discovery(issuer: string) {
  const requests: Array<{ url: string; body: string }> = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, body: String(init?.body ?? '') })
    if (url === 'https://mcp.example/resource') return Response.json({ resource: SERVER, authorization_servers: [issuer] })
    if (url.includes('/.well-known/')) {
      return Response.json({
        issuer,
        authorization_endpoint: new URL('authorize', issuer).href,
        token_endpoint: new URL('token', issuer).href,
        registration_endpoint: new URL('register', issuer).href,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none']
      })
    }
    if (url === new URL('register', issuer).href) {
      return Response.json({ client_id: 'new-client', redirect_uris: ['http://127.0.0.1:0/callback'] })
    }
    if (url === new URL('token', issuer).href) return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer' })
    throw new Error(`Unexpected OAuth request: ${url}`)
  }
  return { requests, options: { serverUrl: SERVER, resourceMetadataUrl: new URL('https://mcp.example/resource'), fetchFn } }
}

describe('MCP OAuth issuer binding through the real SDK', () => {
  it('preserves issuer and complete credentials across provider recreation and same-issuer refresh', async () => {
    const f = fixture({ clientInformation: client, tokens })
    const p = f.provider()
    const d = discovery(ISSUER)
    await expect(auth(p, d.options)).resolves.toBe('AUTHORIZED')
    const post = d.requests.find(request => request.url === new URL('token', ISSUER).href)
    expect(post?.body).toContain('old-refresh')
    expect(post?.body).toContain('old-secret')
    await expect(f.provider().tokens()).resolves.toEqual({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', issuer: ISSUER })
    await expect(f.provider().clientInformation()).resolves.toEqual(client)
  })

  it('does not send bound credentials to an issuer advertised by a changed MCP server', async () => {
    const f = fixture({ clientInformation: client, tokens })
    const p = f.provider()
    const redirect = vi.spyOn(p, 'redirectToAuthorization').mockResolvedValue()
    const d = discovery('https://attacker.example/')
    await expect(auth(p, d.options)).resolves.toBe('REDIRECT')
    expect(redirect).toHaveBeenCalledOnce()
    expect(d.requests.some(request => request.url.endsWith('/token'))).toBe(false)
    expect(JSON.stringify(d.requests)).not.toMatch(/old-secret|old-refresh|old-access/)
    await expect(f.provider().clientInformation()).resolves.toMatchObject({ client_id: 'new-client', issuer: 'https://attacker.example/' })
  })

  it('keeps legacy records intact while requiring fresh registration and authorization', async () => {
    const legacy = {
      clientInformation: { client_id: 'old-client', client_secret: 'old-secret' },
      tokens: { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer' }
    }
    const f = fixture(legacy)
    const p = f.provider()
    await expect(p.clientInformation()).resolves.toBeUndefined()
    await expect(p.tokens()).resolves.toBeUndefined()
    expect(f.read()).toEqual({ kind: 'grant', payload: legacy })
    expect(f.store.modifyRecord).not.toHaveBeenCalled()
    vi.spyOn(p, 'redirectToAuthorization').mockResolvedValue()
    const d = discovery(ISSUER)
    await expect(auth(p, d.options)).resolves.toBe('REDIRECT')
    expect(d.requests.some(request => request.url.endsWith('/token'))).toBe(false)
    expect(JSON.stringify(d.requests)).not.toMatch(/old-secret|old-refresh|old-access/)
    await expect(auth(p, { ...d.options, authorizationCode: 'new-code' })).resolves.toBe('AUTHORIZED')
    await expect(f.provider().tokens()).resolves.toMatchObject({ access_token: 'new-access', issuer: ISSUER })
    expect(JSON.stringify(d.requests)).not.toMatch(/old-secret|old-refresh|old-access/)
  })

  it('preserves legacy token data through fresh registration and a failed authorization exchange', async () => {
    const legacyTokens = { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer' }
    const f = fixture({ clientInformation: { client_id: 'old-client', client_secret: 'old-secret' }, tokens: legacyTokens })
    const p = f.provider()
    vi.spyOn(p, 'redirectToAuthorization').mockResolvedValue()
    const d = discovery(ISSUER)
    await expect(auth(p, d.options)).resolves.toBe('REDIRECT')
    expect(f.read()).toMatchObject({ kind: 'grant', payload: { tokens: legacyTokens } })
    await expect(f.provider().clientInformation()).resolves.toMatchObject({ client_id: 'new-client', issuer: ISSUER })
    await expect(f.provider().tokens()).resolves.toBeUndefined()

    const unavailable = new Error('authorization server unavailable')
    const fetchFn = d.options.fetchFn
    let exchangeBody = ''
    await expect(
      auth(p, {
        ...d.options,
        authorizationCode: 'new-code',
        fetchFn: async (input, init) => {
          if (String(input) === new URL('token', ISSUER).href) {
            exchangeBody = String(init?.body ?? '')
            throw unavailable
          }
          return fetchFn(input, init)
        }
      })
    ).rejects.toBe(unavailable)
    expect(exchangeBody).toContain('new-code')
    expect(exchangeBody).not.toMatch(/old-secret|old-refresh|old-access/)
    expect(f.read()).toMatchObject({ kind: 'grant', payload: { tokens: legacyTokens } })
    await expect(f.provider().tokens()).resolves.toBeUndefined()
    expect(JSON.stringify(d.requests)).not.toMatch(/old-secret|old-refresh|old-access/)
  })

  it.each([undefined, '', 42, null])('does not expose credentials with invalid issuer %s', async issuer => {
    const f = fixture({ clientInformation: { ...client, issuer }, tokens: { ...tokens, issuer } })
    await expect(f.provider().clientInformation()).resolves.toBeUndefined()
    await expect(f.provider().tokens()).resolves.toBeUndefined()
    expect(f.store.modifyRecord).not.toHaveBeenCalled()
  })
})
