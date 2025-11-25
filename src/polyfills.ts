import { Buffer } from 'buffer'

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

if (typeof (globalThis as any).global === 'undefined') {
  ;(globalThis as any).global = globalThis
}

(globalThis as any).process = {
  ...(globalThis as any).process,
  env: {
    ...((globalThis as any).process?.env ?? {}),
    ANCHOR_BROWSER: true,
  },
}

