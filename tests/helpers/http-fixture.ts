import { once } from 'node:events'
import type { Server } from 'node:http'

/** Start the archive fixture and propagate asynchronous listen errors. */
export async function listenLoopback(server: Server): Promise<void> {
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening
}
