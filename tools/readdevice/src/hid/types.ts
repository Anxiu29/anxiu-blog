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
