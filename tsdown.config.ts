import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: ['cjs'],
  outDir: 'client',
  platform: 'browser',

  inputOptions: { platform: 'browser' },
  hash: false,
  external: [/^react(\/|$)/, /^react-dom(\/|$)/, /^@deepseek-ai\/dsh-client-/, /^@deepseek-ai\/dsh-llm(\/|$)/],

  deps: { alwaysBundle: ['yaml'] },
  css: { inject: true },
  outExtensions: ({ format }) => (format === 'cjs' ? { js: '.js' } : {}),
  dts: false,
  sourcemap: true
})
