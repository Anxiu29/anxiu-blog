import type { DeviceBackend, DeviceDetail } from '../hid/types'
import {
  buildRyGetReportRateFrame,
  parseRyReportRateHz,
  type RyReportRateVariant,
} from './ryCommon'

/** 已知非容圆 VID：勿发 0x83（贝盈等同号命令语义不同）。 */
const NON_RY_VIDS = new Set(['258A', '342D', '0603', '1CA2', '320F'])

function normVid(vid: string): string {
  return vid.trim().toUpperCase().replace(/^0X/, '')
}

export function shouldProbeRyReportRate(vid: string | null | undefined): boolean {
  if (!vid) return true
  return !NON_RY_VIDS.has(normVid(vid))
}

/**
 * 通过容圆协议 0x83 读取当前固件回报率，覆盖 USB bInterval 推算值。
 * 失败时原样返回 detail（保留描述符回退值）。
 */
export async function enrichDetailWithRyReportRate(
  backend: DeviceBackend,
  detail: DeviceDetail,
  variant: RyReportRateVariant = 'auto',
): Promise<DeviceDetail> {
  if (!shouldProbeRyReportRate(detail.vid)) return detail

  try {
    const frame = buildRyGetReportRateFrame()
    const resp = await backend.exchangeReport(detail.id, frame, {
      timeoutMs: 200,
      reportId: 0,
      channel: 'auto',
      usagePageHint: 0xffff,
    })
    const hz = parseRyReportRateHz(resp, variant)
    if (hz == null) return detail
    return { ...detail, pollingRateHz: hz }
  } catch {
    return detail
  }
}
