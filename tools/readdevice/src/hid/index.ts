import type { DeviceBackend } from './types'
import { detectMode } from './runtime'
import { tauriBackend } from './tauri'
import { webhidBackend } from './webhid'

const unsupportedBackend: DeviceBackend = {
  mode: 'unsupported',
  async listDevices() {
    throw new Error('当前浏览器不支持 WebHID，请使用 Chrome / Edge，或运行桌面版')
  },
  async getDeviceDetail() {
    throw new Error('当前浏览器不支持 WebHID')
  },
  async exchangeReport() {
    throw new Error('当前浏览器不支持 WebHID')
  },
}

export function getBackend(): DeviceBackend {
  const mode = detectMode()
  if (mode === 'tauri') return tauriBackend
  if (mode === 'webhid') return webhidBackend
  return unsupportedBackend
}

export type {
  DeviceBackend,
  DeviceDetail,
  DeviceSummary,
  ExchangeOptions,
  HidChannel,
  RuntimeMode,
} from './types'
export { normalizeExchangeOptions } from './types'
export { detectMode } from './runtime'
