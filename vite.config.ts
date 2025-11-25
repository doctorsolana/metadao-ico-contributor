import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const resolvePkg = (specifier: string) => require.resolve(specifier)

export default defineConfig(() => ({
  server: { port: 4444, host: true },
  define: {
    global: 'globalThis',
    'process.env.ANCHOR_BROWSER': true,
  },
  resolve: {
    alias: {
      buffer: resolvePkg('buffer/'),
      'buffer/': resolvePkg('buffer/'),
      stream: resolvePkg('stream-browserify'),
      util: resolvePkg('util/'),
      'util/': resolvePkg('util/'),
      process: resolvePkg('process/browser'),
      events: resolvePkg('events/'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
  },
  plugins: [react()],
  build: {
    commonjsOptions: { transformMixedEsModules: true },
  },
}))
