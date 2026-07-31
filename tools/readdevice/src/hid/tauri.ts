import { invoke } from '@tauri-apps/api/core'
import type { DeviceBackend, DeviceDetail, DeviceSummary } from './types'
import { normalizeExchangeOptions } from './types'

export const tauriBackend: DeviceBackend = {
  mode: 'tauri',

  listDevices() {
    return invoke<DeviceSummary[]>('list_devices')
  },

  getDeviceDetail(id: string) {
    return invoke<DeviceDetail>('get_device_detail', { id })
  },

  async exchangeReport(id, report, options) {
    const opts = normalizeExchangeOptions(options)
    const response = await invoke<number[]>('exchange_hid_report', {
      id,
      report: Array.from(report),
      timeoutMs: opts.timeoutMs ?? 200,
      reportId: opts.reportId,
      channel: opts.channel ?? 'auto',
      usagePageHint: opts.usagePageHint,
      expectPrefix: opts.expectPrefix,
      assembleSparklink: opts.assembleSparkLink ?? false,
    })
    return new Uint8Array(response)
  },
}
