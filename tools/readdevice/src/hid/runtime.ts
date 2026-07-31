import type { DeviceBackend } from './types'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

export function detectMode(): DeviceBackend['mode'] {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    return 'tauri'
  }
  if (typeof navigator !== 'undefined' && 'hid' in navigator) {
    return 'webhid'
  }
  return 'unsupported'
}
