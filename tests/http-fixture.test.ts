import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import { listenLoopback } from './helpers/http-fixture.js'

it('propagates the original asynchronous listener error without waiting for the test timeout', async () => {
  const server = createServer()
  const error = Object.assign(new Error('loopback forbidden'), { code: 'EPERM' })
  server.on('error', () => {})
  const listen = vi.spyOn(server, 'listen').mockImplementation(() => {
    queueMicrotask(() => server.emit('error', error))
    return server
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('listener error was not propagated')), 1000)
    })
    await expect(Promise.race([listenLoopback(server), deadline])).rejects.toBe(error)
  } finally {
    clearTimeout(timer)
    listen.mockRestore()
  }
})

it('starts a real loopback fixture and removes temporary event listeners', async () => {
  const server = createServer()
  const listeningListeners = server.listenerCount('listening')
  try {
    await listenLoopback(server)
    expect(server.listening).toBe(true)
    expect(server.listenerCount('error')).toBe(0)
    expect(server.listenerCount('listening')).toBe(listeningListeners)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
