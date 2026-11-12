import { once } from 'node:events'
import type { Server } from 'node:http'

export async function listenLoopback(server: Server): Promise<void> {
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening
}
