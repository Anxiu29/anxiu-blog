import type { DeviceBackend, DeviceDetail, DeviceSummary, ExchangeOptions } from './types'
import { normalizeExchangeOptions } from './types'
import { slkAssembleTargetBytes } from '../protocol/sparklink'

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, '0')
}

function deviceId(device: HIDDevice): string {
  const collections = (device.collections ?? [])
    .map((c) => `${c.usagePage ?? 0}:${c.usage ?? 0}`)
    .join(',')
  return `webhid:${hex4(device.vendorId)}:${hex4(device.productId)}:${device.productName}:${collections}`
}

function toSummary(device: HIDDevice): DeviceSummary {
  const vid = hex4(device.vendorId)
  const pid = hex4(device.productId)
  const name = device.productName?.trim()
  return {
    id: deviceId(device),
    label: name || `HID ${vid}:${pid}`,
    vid,
    pid,
  }
}

function toDetail(device: HIDDevice): DeviceDetail {
  const summary = toSummary(device)
  return {
    id: summary.id,
    vid: summary.vid,
    pid: summary.pid,
    version: '',
    manufacturer: '',
    product: device.productName?.trim() || '',
    pollingRateHz: null,
    usbVersion: null,
    speed: null,
  }
}

/** RongYuan / RY keyboards (e.g. RK A72 HE) use usagePage 0xFFFF, usage 0x0002. */
const RONGYUAN_USAGE_PAGE = 0xffff
const RONGYUAN_USAGE = 0x0002
/** BeiYing vendor page from protocol docs. */
const BEIYING_USAGE_PAGE = 0xff02

function isVendorCollection(c: HIDCollectionInfo): boolean {
  return (c.usagePage ?? 0) >= 0xff00
}

function maxFeatureBodyLen(device: HIDDevice): number {
  let max = 0
  for (const c of device.collections ?? []) {
    for (const r of c.featureReports ?? []) {
      const items = (r.items ?? []) as Array<{ reportSize?: number; reportCount?: number }>
      let bits = 0
      for (const it of items) {
        bits += (it.reportSize ?? 0) * (it.reportCount ?? 0)
      }
      max = Math.max(max, Math.ceil(bits / 8))
    }
  }
  return max
}

function vendorScore(device: HIDDevice, opts?: { usagePageHint?: number; bodyLen?: number }): number {
  let score = 0
  const hint = opts?.usagePageHint
  const bodyLen = opts?.bodyLen ?? 0
  for (const c of device.collections ?? []) {
    const page = c.usagePage ?? 0
    if (hint != null && page === hint) {
      score += 220
    } else if (page === RONGYUAN_USAGE_PAGE && (c.usage ?? 0) === RONGYUAN_USAGE) {
      score += 200
    } else if (page === BEIYING_USAGE_PAGE) {
      score += 180
    } else if (!isVendorCollection(c)) {
      continue
    } else {
      score += 10
    }
    score += (c.featureReports?.length ?? 0) * 3
    score += (c.outputReports?.length ?? 0) * 2
    score += (c.inputReports?.length ?? 0)
  }
  if (bodyLen > 0) {
    const fl = maxFeatureBodyLen(device)
    if (fl === bodyLen || fl + 1 === bodyLen || fl === bodyLen + 1) {
      score += 80
    } else if (fl >= bodyLen) {
      score += 30
    }
    for (const c of device.collections ?? []) {
      for (const r of c.outputReports ?? []) {
        const items = (r.items ?? []) as Array<{ reportSize?: number; reportCount?: number }>
        let bits = 0
        for (const it of items) bits += (it.reportSize ?? 0) * (it.reportCount ?? 0)
        const ol = Math.ceil(bits / 8)
        if (ol === bodyLen || ol === bodyLen + 1) score += 60
      }
    }
  }
  return score
}

function pickExchangeDevice(
  devices: HIDDevice[],
  id: string,
  opts?: { usagePageHint?: number; bodyLen?: number },
): HIDDevice | undefined {
  const byId = findById(devices, id)
  if (!byId) return undefined

  const vid = byId.vendorId
  const pid = byId.productId
  const same = devices.filter((d) => d.vendorId === vid && d.productId === pid)
  if (same.length === 0) return byId

  let best = same[0]
  let bestScore = vendorScore(best, opts)
  for (const d of same.slice(1)) {
    const s = vendorScore(d, opts)
    if (s > bestScore) {
      best = d
      bestScore = s
    }
  }
  return bestScore > 0 ? best : byId
}

function firstReportId(reports: HIDReportItem[] | undefined): number {
  if (!reports?.length) return 0
  return reports[0].reportId ?? 0
}

function collectFeatureReportIds(device: HIDDevice): number[] {
  const ids: number[] = []
  for (const c of device.collections ?? []) {
    for (const r of c.featureReports ?? []) {
      ids.push(r.reportId ?? 0)
    }
  }
  return [...new Set(ids)]
}

function hasFeature(device: HIDDevice): boolean {
  return (device.collections ?? []).some((c) => (c.featureReports?.length ?? 0) > 0)
}

function hasOutput(device: HIDDevice): boolean {
  return (device.collections ?? []).some((c) => (c.outputReports?.length ?? 0) > 0)
}

function pickFeatureReportId(device: HIDDevice, requested?: number): number {
  if (requested != null) return requested & 0xff
  const ids = collectFeatureReportIds(device)
  for (const prefer of [0x06, 0x09, 0x0a]) {
    if (ids.includes(prefer)) return prefer
  }
  const nonzero = ids.find((id) => id !== 0)
  return nonzero ?? firstReportId(
    device.collections?.flatMap((c) => c.featureReports ?? []) ?? [],
  )
}

function outputReportId(device: HIDDevice, requested?: number): number {
  if (requested != null) return requested & 0xff
  for (const c of device.collections ?? []) {
    if ((c.outputReports?.length ?? 0) > 0) {
      return firstReportId(c.outputReports)
    }
  }
  return 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureOpen(device: HIDDevice): Promise<void> {
  if (!device.opened) {
    await device.open()
  }
}

function normalizeRx(view: DataView, bodyLen: number, reportId?: number): Uint8Array {
  const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  if (bodyLen <= 0) return raw
  const rid = (reportId ?? 0) & 0xff
  // Feature 回包有时带 Report ID 前缀（含 0），正文从下一字节才是 0x83 等命令
  if (raw.length >= bodyLen + 1 && (raw[0] ?? 0) === rid) {
    return raw.slice(1, 1 + bodyLen)
  }
  if (raw.length >= bodyLen) return raw.slice(0, bodyLen)
  const out = new Uint8Array(bodyLen)
  out.set(raw)
  return out
}

async function exchangeFeature(
  device: HIDDevice,
  report: Uint8Array,
  timeoutMs: number,
  reportId: number,
): Promise<Uint8Array> {
  await device.sendFeatureReport(reportId, report)
  await sleep(timeoutMs)
  const view = await device.receiveFeatureReport(reportId)
  return normalizeRx(view, report.length, reportId)
}

async function exchangeOutputInput(
  device: HIDDevice,
  report: Uint8Array,
  timeoutMs: number,
  reportId: number,
  expectPrefix?: number[],
  assembleSparkLink?: boolean,
  expectPrefixAlts?: number[][],
): Promise<Uint8Array> {
  const prefixLists: number[][] = []
  if (expectPrefix && expectPrefix.length) prefixLists.push(expectPrefix.map((b) => b & 0xff))
  for (const alt of expectPrefixAlts ?? []) {
    if (alt.length) prefixLists.push(alt.map((b) => b & 0xff))
  }
  const prefixes = prefixLists.filter((p, i, arr) => {
    const key = p.join(',')
    return arr.findIndex((x) => x.join(',') === key) === i
  })
  const deadline = Date.now() + Math.max(timeoutMs, 50)
  let activeHandler: ((ev: HIDInputReportEvent) => void) | null = null
  let activeTimer: number | null = null

  const clearWait = () => {
    if (activeTimer != null) {
      window.clearTimeout(activeTimer)
      activeTimer = null
    }
    if (activeHandler) {
      device.removeEventListener('inputreport', activeHandler)
      activeHandler = null
    }
  }

  const waitInput = (opts: {
    matchPrefix: boolean
    errorMessage: string
  }): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      clearWait()
      const remain = Math.max(1, deadline - Date.now())
      activeTimer = window.setTimeout(() => {
        clearWait()
        reject(new Error(opts.errorMessage))
      }, remain)

      activeHandler = (ev: HIDInputReportEvent) => {
        if (reportId !== 0 && ev.reportId !== reportId) return
        const data = normalizeRx(ev.data, report.length, reportId)
        if (opts.matchPrefix && prefixes.length > 0) {
          const ok = prefixes.some((prefix) => prefix.every((b, i) => (data[i] ?? 0) === b))
          if (!ok) return
        }
        clearWait()
        resolve(data)
      }
      device.addEventListener('inputreport', activeHandler)
    })

  const firstWait = waitInput({
    matchPrefix: true,
    errorMessage: prefixes.length
      ? `等待匹配回包超时（期望 ${prefixes.map((p) => p.map((b) => b.toString(16).padStart(2, '0')).join(' ')).join(' / ')}，${timeoutMs}ms）`
      : `等待 Input Report 超时（${timeoutMs}ms）`,
  })

  try {
    await device.sendReport(reportId, report)
  } catch (err) {
    clearWait()
    throw err
  }

  let acc = await firstWait

  if (assembleSparkLink) {
    const need = slkAssembleTargetBytes(acc)
    if (need != null && acc.length < need) {
      const chunks: Uint8Array[] = [acc]
      let total = acc.length
      while (total < need) {
        const more = await waitInput({
          matchPrefix: false,
          errorMessage: `星闪多包收齐超时（已收 ${total}/${need}，${timeoutMs}ms）`,
        })
        chunks.push(more)
        total += more.length
      }
      const merged = new Uint8Array(total)
      let off = 0
      for (const c of chunks) {
        merged.set(c, off)
        off += c.length
      }
      acc = merged.slice(0, need)
    }
  }

  return acc
}

function dedupeByVidPid(devices: HIDDevice[]): HIDDevice[] {
  const display = new Map<string, HIDDevice>()
  for (const d of devices) {
    const key = `${hex4(d.vendorId)}:${hex4(d.productId)}`
    if (!display.has(key)) display.set(key, d)
  }
  return [...display.values()]
}

async function getAuthorized(): Promise<HIDDevice[]> {
  const list = await navigator.hid.getDevices()
  return dedupeByVidPid(list)
}

async function getAllAuthorized(): Promise<HIDDevice[]> {
  return navigator.hid.getDevices()
}

function findById(devices: HIDDevice[], id: string): HIDDevice | undefined {
  return (
    devices.find((d) => deviceId(d) === id) ??
    devices.find((d) => {
      const vid = hex4(d.vendorId)
      const pid = hex4(d.productId)
      return id.includes(`${vid}:${pid}`)
    })
  )
}

export const webhidBackend: DeviceBackend = {
  mode: 'webhid',

  async listDevices() {
    const devices = await getAuthorized()
    return devices
      .map(toSummary)
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  },

  async getDeviceDetail(id: string) {
    const devices = await getAuthorized()
    const device = findById(devices, id)
    if (!device) {
      throw new Error('设备未授权或已断开，请重新授权')
    }
    return toDetail(device)
  },

  async requestAccess() {
    const picked = await navigator.hid.requestDevice({
      filters: [
        { vendorId: 0x258a },
        { vendorId: 0x342d },
        { vendorId: 0x0603 },
        { vendorId: 0x1ca2 },
        { vendorId: 0x320f },
        { usagePage: 0xff1c, usage: 0x0092 },
        { usagePage: 0xff1c },
        { usagePage: RONGYUAN_USAGE_PAGE, usage: RONGYUAN_USAGE },
        { usagePage: RONGYUAN_USAGE_PAGE },
        { usagePage: BEIYING_USAGE_PAGE },
        { usagePage: 0xff00 },
        { usagePage: 0xff01 },
        { usagePage: 0xffb0, usage: 0x01 },
        { usagePage: 0xffb0 },
        { usagePage: 0x01, usage: 0x06 },
        { usagePage: 0x01, usage: 0x07 },
        { usagePage: 0x01, usage: 0x02 },
        { usagePage: 0x0c },
      ],
      optionalFilters: [
        { vendorId: 0x258a },
        { vendorId: 0x342d },
        { vendorId: 0x0603 },
        { vendorId: 0x1ca2 },
        { vendorId: 0x320f },
        { usagePage: 0xff1c, usage: 0x0092 },
        { usagePage: 0xff1c },
        { usagePage: RONGYUAN_USAGE_PAGE, usage: RONGYUAN_USAGE },
        { usagePage: RONGYUAN_USAGE_PAGE },
        { usagePage: BEIYING_USAGE_PAGE },
        { usagePage: 0xff00 },
        { usagePage: 0xff01 },
        { usagePage: 0xffb0, usage: 0x01 },
        { usagePage: 0xffb0 },
      ],
    })
    return dedupeByVidPid(picked)
      .map(toSummary)
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  },

  async exchangeReport(id, report, options) {
    const opts: ExchangeOptions = normalizeExchangeOptions(options)
    const timeoutMs = opts.timeoutMs ?? 200
    const channel = opts.channel ?? 'auto'
    const devices = await getAllAuthorized()
    const device = pickExchangeDevice(devices, id, {
      usagePageHint: opts.usagePageHint,
      bodyLen: report.length,
    })
    if (!device) {
      throw new Error('设备未授权或已断开，请重新授权（需包含厂商 HID 接口）')
    }
    await ensureOpen(device)
    try {
      const wantFeature = channel === 'feature' || (channel === 'auto' && hasFeature(device))
      if (wantFeature && hasFeature(device)) {
        const reportId = pickFeatureReportId(device, opts.reportId)
        try {
          return await exchangeFeature(device, report, timeoutMs, reportId)
        } catch (featureErr) {
          if (channel === 'feature' || !hasOutput(device)) throw featureErr
          const outId = outputReportId(device, opts.reportId)
          return await exchangeOutputInput(
            device,
            report,
            Math.max(timeoutMs, 300),
            outId,
            opts.expectPrefix,
            opts.assembleSparkLink,
            opts.expectPrefixAlts,
          )
        }
      }
      if (hasOutput(device)) {
        const outId = outputReportId(device, opts.reportId)
        return await exchangeOutputInput(
          device,
          report,
          Math.max(timeoutMs, 300),
          outId,
          opts.expectPrefix,
          opts.assembleSparkLink,
          opts.expectPrefixAlts,
        )
      }
      throw new Error('设备无可用的 Feature/Output 报告')
    } catch (e) {
      const msg = String(e)
      if (/notallowed|security|fail|invalid/i.test(msg)) {
        throw new Error(
          `WebHID 收发失败：${msg}。请重新「授权设备」并选择带厂商接口的 HID 集合。`,
        )
      }
      throw e instanceof Error ? e : new Error(msg)
    }
  },
}
