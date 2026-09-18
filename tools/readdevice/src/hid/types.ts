export interface DeviceSummary {
  id: string
  label: string
  vid: string
  pid: string
}

export interface DeviceDetail {
  id: string
  vid: string
  pid: string
  version: string
  manufacturer: string
  product: string
  pollingRateHz: number | null
  usbVersion: string | null
  speed: string | null
}

export type RuntimeMode = 'tauri' | 'webhid' | 'unsupported'

export type HidChannel = 'auto' | 'feature' | 'output'

export interface ExchangeOptions {
  timeoutMs?: number
  /** Explicit Report ID; omitted → backend picks from device caps. */
  reportId?: number
  channel?: HidChannel
  /** Prefer matching Usage Page when selecting vendor interface. */
  usagePageHint?: number
  /**
   * Output/Input：忽略不匹配的 Input 报告，直到前缀一致或超时。
   * 例：航晟 get_buffer 期望 [0x82, 0x01]。
   */
  expectPrefix?: number[]
  /** 任一前缀匹配即可（TLW 当前/旧固件命令族）。 */
  expectPrefixAlts?: number[][]
  /**
   * 星闪多包应答：首包 0x5C 后按 len 继续读 Input，拼满 4+len 再返回。
   */
  assembleSparkLink?: boolean
}

export interface DeviceBackend {
  mode: RuntimeMode
  listDevices: () => Promise<DeviceSummary[]>
  getDeviceDetail: (id: string) => Promise<DeviceDetail>
  /** WebHID needs a user gesture to grant access; returns newly granted devices. */
  requestAccess?: () => Promise<DeviceSummary[]>
  /**
   * Send a vendor report body (no leading Report ID) and read the response.
   * Returns the full response body.
   */
  exchangeReport: (
    id: string,
    report: Uint8Array,
    options?: ExchangeOptions | number,
  ) => Promise<Uint8Array>
}

export function normalizeExchangeOptions(
  options?: ExchangeOptions | number,
): ExchangeOptions {
  if (typeof options === 'number') {
    return { timeoutMs: options }
  }
  return options ?? {}
}
