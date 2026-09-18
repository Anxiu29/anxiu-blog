import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex, u16le } from './types'

/**
 * TLW / RK 网页 AP 通讯协议（2026-09-10 PDF + Anxiu/CB75 抓包）。
 * PDF：64 字节 Output Report（含 Report ID）；本工具 Report ID 单独发送，body=63。
 *
 *   [0]=Cs_L [1]=Cs_H [2]=CMD [3]=LEN [4]=ADDR_L [5]=ADDR_H [6]=ACK [7..62]=DATA
 *
 * 命令族：
 * - current：线命令 = 逻辑号 + 0xA0（A1…BA），Cs=00。9/16 有线抓包。
 * - legacy：线命令 = 逻辑号（01…1A），Cs=00。早期有线/部分无线抓包。
 * - 文档 PDF：A1…C2 且填写 Cs。
 *
 * 有线分包 56B；无线分包 24B，且 payload[31]=2（接收器鼠标路由）。
 */
export const TLW_BODY_LEN = 63
export const TLW_DATA_MAX = 56
export const TLW_WIRED_DATA = 56
export const TLW_WIRELESS_DATA = 24
export const TLW_WIRELESS_ROUTE_INDEX = 31
export const TLW_WIRELESS_ROUTE = 2
export const TLW_CMD_FAMILY = 0xa0
export const TLW_REPORT_ID = 4
export const TLW_USAGE_PAGE = 0xff1c
export const TLW_USAGE = 0x0092
export const TLW_FUNC_BYTES = 128
export const TLW_KEYS_BYTES = 128
export const TLW_VID = 0x320f
export const TLW_PID_WIRED = 0x22f2
export const TLW_PID_WIRELESS = 0x22f3

export type TlwCommandFamily = 'current' | 'legacy'
export type TlwLinkMode = 'wired' | 'wireless'

export const TLW_CMD = {
  START: 0xa1,
  END: 0xa2,
  BASIC: 0xa3,
  GET_FUNC: 0xa5,
  SET_FUNC: 0xa6,
  GET_DEFKEY: 0xa7,
  GET_KEY: 0xa8,
  SET_KEY: 0xa9,
  FACTORY: 0xad,
  GET_MACRO: 0xb4,
  SET_MACRO: 0xb5,
  BATTERY: 0xba,
  WIRELESS: 0xc2,
} as const

/** CB75 抓包命令（文档 CMD 的低 8 位，校验为 0）。 */
export const TLW_FW_CMD = {
  START: 0x01,
  END: 0x02,
  BASIC: 0x03,
  GET_FUNC: 0x05,
  SET_FUNC: 0x06,
  GET_DEFKEY: 0x07,
  GET_KEY: 0x08,
  SET_KEY: 0x09,
  FACTORY: 0x0d,
  SET_MACRO: 0x15,
  BATTERY: 0x1a,
} as const

export interface TlwBuildOptions {
  cmd: number
  addr?: number
  len?: number
  ack?: number
  data?: ArrayLike<number>
  /** 默认 true。实机读写应设 false（Cs=00 00）。 */
  checksum?: boolean
}

export interface TlwPacket {
  cmd: number
  len: number
  addr: number
  ack: number
  checksum: number
  checksumOk: boolean
  data: Uint8Array
}

function u8(data: ArrayLike<number>, i: number): number {
  return (data[i] ?? 0) & 0xff
}

function hex2(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

/** 去掉 0xA0 族偏移后的逻辑命令。0xFF 是接收器拒绝，原样返回。 */
export function tlwLogicalCmd(cmd: number): number {
  const c = cmd & 0xff
  if (c === 0xff) return c
  return c >= TLW_CMD_FAMILY ? c - TLW_CMD_FAMILY : c
}

export function tlwWireCmd(logical: number, family: TlwCommandFamily = 'current'): number {
  const base = tlwLogicalCmd(logical)
  return family === 'current' ? (base + TLW_CMD_FAMILY) & 0xff : base
}

export function tlwCmdsMatch(got: number, expect: number): boolean {
  return (got & 0xff) === (expect & 0xff) || tlwLogicalCmd(got) === tlwLogicalCmd(expect)
}

export function applyTlwWirelessRoute(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(frame)
  out[TLW_WIRELESS_ROUTE_INDEX] = TLW_WIRELESS_ROUTE
  return out
}

function defaultDataLen(cmd: number): number {
  switch (tlwLogicalCmd(cmd)) {
    case TLW_FW_CMD.START:
    case TLW_FW_CMD.END:
    case TLW_FW_CMD.FACTORY:
      return 24
    case TLW_FW_CMD.BASIC:
      return 0x22
    case TLW_FW_CMD.BATTERY:
      return 6
    case tlwLogicalCmd(TLW_CMD.WIRELESS):
      return 1
    default:
      return TLW_DATA_MAX
  }
}

/** 63 字节 body：从 CMD（下标 2）累加到末尾。 */
export function computeTlwChecksum(frame: ArrayLike<number>, cmdOffset = 2): number {
  let sum = 0
  for (let i = cmdOffset; i < frame.length; i++) sum += u8(frame, i)
  return sum & 0xffff
}

export function applyTlwChecksum(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(frame)
  const { cmdOffset, csOffset } = locateTlwHeader(out)
  const sum = computeTlwChecksum(out, cmdOffset)
  out[csOffset] = sum & 0xff
  out[csOffset + 1] = (sum >> 8) & 0xff
  return out
}

function locateTlwHeader(data: ArrayLike<number>): { off: number; cmdOffset: number; csOffset: number } {
  if (
    data.length >= TLW_BODY_LEN + 1 &&
    u8(data, 0) === TLW_REPORT_ID &&
    u8(data, 3) !== 0
  ) {
    return { off: 1, cmdOffset: 3, csOffset: 1 }
  }
  return { off: 0, cmdOffset: 2, csOffset: 0 }
}

export function buildTlwFrame(opts: TlwBuildOptions): Uint8Array {
  const frame = new Uint8Array(TLW_BODY_LEN)
  const data = opts.data
  const dataBytes = data ? Math.min(data.length, TLW_DATA_MAX) : 0
  const len = Math.min(TLW_DATA_MAX, opts.len != null ? opts.len & 0xff : dataBytes || defaultDataLen(opts.cmd))
  const addr = (opts.addr ?? 0) & 0xffff
  frame[2] = opts.cmd & 0xff
  frame[3] = len
  frame[4] = addr & 0xff
  frame[5] = (addr >> 8) & 0xff
  frame[6] = (opts.ack ?? 0) & 0xff
  if (data && dataBytes > 0) {
    for (let i = 0; i < dataBytes; i++) frame[7 + i] = data[i] & 0xff
  }
  if (opts.checksum !== false) {
    const sum = computeTlwChecksum(frame)
    frame[0] = sum & 0xff
    frame[1] = (sum >> 8) & 0xff
  }
  return frame
}

export function parseTlwPacket(data: ArrayLike<number>): TlwPacket {
  if (data.length < 7) {
    throw new Error(`TLW 回包过短: ${data.length} 字节`)
  }
  const { off, cmdOffset, csOffset } = locateTlwHeader(data)
  const cmd = u8(data, off + 2)
  const len = u8(data, off + 3)
  const addr = u16le(data, off + 4)
  const ack = u8(data, off + 6)
  const checksum = u8(data, csOffset) | (u8(data, csOffset + 1) << 8)
  const expect = computeTlwChecksum(data, cmdOffset)
  const take = Math.min(TLW_DATA_MAX, len, Math.max(0, data.length - (off + 7)))
  const payload = new Uint8Array(take)
  for (let i = 0; i < take; i++) payload[i] = u8(data, off + 7 + i)
  return {
    cmd,
    len,
    addr,
    ack,
    checksum,
    checksumOk: checksum === 0 || checksum === expect,
    data: payload,
  }
}

export function extractTlwData(report: ArrayLike<number>, expectCmd?: number): Uint8Array {
  const pkt = parseTlwPacket(report)
  if (pkt.cmd === 0xff) {
    throw new Error('接收器拒绝请求（CMD=FF）；检查鼠标连接或无线距离')
  }
  if (expectCmd != null && !tlwCmdsMatch(pkt.cmd, expectCmd)) {
    throw new Error(`TLW 回包 CMD=0x${hex2(pkt.cmd)}，期望 0x${hex2(expectCmd)}`)
  }
  if (pkt.ack !== 0) {
    throw new Error(`设备拒绝 CMD=0x${hex2(pkt.cmd)}（ACK=0x${hex2(pkt.ack)}）`)
  }
  return pkt.data
}

export function tlwExpectPrefix(frame: ArrayLike<number>): number[] | undefined {
  return tlwExpectPrefixes(frame)?.[0]
}

/** 当前固件 A3、旧固件 03、接收器拒绝 FF 都算合法回包，避免误丢后超时。 */
export function tlwExpectPrefixes(frame: ArrayLike<number>): number[][] | undefined {
  const cmd = u8(frame, 2)
  if (u8(frame, 0) !== 0 || u8(frame, 1) !== 0 || cmd === 0) return undefined
  const logical = tlwLogicalCmd(cmd)
  const current = tlwWireCmd(logical, 'current')
  const seen = new Set<string>()
  const out: number[][] = []
  for (const c of [cmd, logical, current, 0xff]) {
    const key = `00-00-${c & 0xff}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push([0, 0, c & 0xff])
  }
  return out
}

export interface TlwBasicInfo {
  keyCount: number
  keyBytes: number
  macroBytes: number
  dpiStep: number
  dpiRank: number
  dpiStart: number
  independentXY: boolean
  dpiStageCount: number
  vendorId: number
  productId: number
  valid: boolean
}

export function parseTlwBasicInfo(data: ArrayLike<number>): TlwBasicInfo {
  const valid = u8(data, 0) === 0xaa && u8(data, 1) === 0x55
  const keyCount = u8(data, 5)
  return {
    valid,
    keyCount,
    keyBytes: keyCount * 3,
    macroBytes: u8(data, 6) * 128,
    dpiStep: u8(data, 11),
    dpiRank: u16le(data, 12),
    dpiStart: u16le(data, 14),
    independentXY: u8(data, 16) !== 0,
    dpiStageCount: u8(data, 17),
    vendorId: u16le(data, 21),
    productId: u16le(data, 23),
  }
}

function chargeLabel(status: number): string {
  if (status === 1) return '充电中'
  if (status === 2) return '充电完成'
  if (status === 0) return '未充电'
  return `未知(${status})`
}

export function parseTlwBattery(data: ArrayLike<number>): { percent: number; charging: number } {
  return { percent: u8(data, 0), charging: u8(data, 1) }
}

export function parseTlwWireless(data: ArrayLike<number>): boolean {
  return u8(data, 0) === 0xff
}

function reportRateLabel(code: number): string {
  if (code === 0) return '125 Hz'
  if (code === 3) return '1000 Hz'
  return `${code}`
}

function formatKeycode(t: number, c1: number, c2: number): string {
  if (t === 0 && c1 === 0 && c2 === 0) return '空'
  if (t === 0x10) {
    const names: Record<number, string> = { 1: '左键', 2: '右键', 4: '中键', 8: '后退', 16: '前进' }
    return `MS ${names[c1] ?? `按键0x${hex2(c1)}`}`
  }
  if (t === 0x13) {
    const names: Record<number, string> = { 1: 'DPI+', 2: 'DPI-', 3: 'DPI Loop' }
    return names[c1] ?? `DPI 0x${hex2(c1)}`
  }
  if (t === 0x14) return `连发 间隔${c1}ms ×${c2}`
  if (t === 0x20) return `KB hot=0x${hex2(c1)} code=0x${hex2(c2)}`
  if (t === 0x21) return `KB击打 delay=${c1} code=0x${hex2(c2)}`
  if (t === 0x30) return `消费类 0x${hex2(c1)}${hex2(c2)}`
  if (t === 0x40) return `系统类 0x${hex2(c1)}${hex2(c2)}`
  if (t === 0x70) return `宏#${c1} 停止=${c2 === 0 ? '播一次' : c2}`
  return `0x${hex2(t)} ${hex2(c1)} ${hex2(c2)}`
}

export function formatTlwKeys(data: ArrayLike<number>, keyCount?: number): string {
  const n = keyCount != null && keyCount > 0 ? keyCount : Math.floor(data.length / 3)
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    const t = u8(data, i * 3)
    const c1 = u8(data, i * 3 + 1)
    const c2 = u8(data, i * 3 + 2)
    lines.push(`  键${String(i).padStart(2, ' ')}  ${hex2(t)} ${hex2(c1)} ${hex2(c2)}  ${formatKeycode(t, c1, c2)}`)
  }
  return lines.join('\n')
}

export function formatTlwFunctions(data: ArrayLike<number>, stageCount?: number): string {
  const stages =
    stageCount != null && stageCount > 0
      ? stageCount
      : Math.max(0, Math.floor(Math.max(0, data.length - 14) / 9))
  const lines = [
    `Profile=${u8(data, 0)}`,
    `灯效 模式=${u8(data, 1)} 亮度=${u8(data, 2)} 速度=${u8(data, 3)} 方向=${u8(data, 4)}`,
    `彩色=${u8(data, 5)} RGB=${u8(data, 6)},${u8(data, 7)},${u8(data, 8)}`,
    `报告率=${reportRateLabel(u8(data, 11))} 当前DPI档=${u8(data, 12)} LOD=${u8(data, 13)}`,
  ]
  for (let i = 0; i < stages; i++) {
    const o = 14 + i * 9
    if (o + 8 >= data.length) break
    const r0 = u8(data, o + 2)
    const r1 = u8(data, o + 3)
    const r2 = u8(data, o + 4)
    const r3 = u8(data, o + 5)
    const rankStyle = r0 === r1 && r1 === r2 && r2 === r3
    const dpiField = rankStyle
      ? `rank=${r0}`
      : `X=${u16le(data, o + 2)} Y=${u16le(data, o + 4)}`
    lines.push(
      `  DPI${i} en=${u8(data, o)} xy=${u8(data, o + 1)} ${dpiField} RGB=${u8(data, o + 6)},${u8(data, o + 7)},${u8(data, o + 8)}`,
    )
  }
  return lines.join('\n')
}

function formatBasic(info: TlwBasicInfo): string {
  const vid = info.vendorId.toString(16).toUpperCase().padStart(4, '0')
  const pid = info.productId.toString(16).toUpperCase().padStart(4, '0')
  return [
    `标志=${info.valid ? 'AA55 有效' : '无效'}`,
    `按键=${info.keyCount}（${info.keyBytes}B） 宏空间=${info.macroBytes}B`,
    `DPI step=${info.dpiStep} rank=${info.dpiRank} 起始=${info.dpiStart} 档位数=${info.dpiStageCount}`,
    `XY分开=${info.independentXY ? '是' : '否'}`,
    `USB VID:PID=${vid}:${pid}`,
  ].join('\n')
}

export function parseTlwResponse(_cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'
  let pkt: TlwPacket
  try {
    pkt = parseTlwPacket(data)
  } catch (e) {
    return `原始 ${data.length} 字节\n${toHex(Array.from({ length: Math.min(24, data.length) }, (_, i) => u8(data, i)))}\n${String(e)}`
  }
  const lines = [
    `CMD=0x${hex2(pkt.cmd)} LEN=${pkt.len} ADDR=${pkt.addr} ACK=0x${hex2(pkt.ack)}`,
    `Cs=0x${pkt.checksum.toString(16).toUpperCase().padStart(4, '0')}${pkt.checksum === 0 ? '（实机/未校验）' : pkt.checksumOk ? ' OK' : ' 不匹配'}`,
  ]
  if (pkt.ack !== 0) lines.push('设备拒绝（ACK≠0）。')
  if (pkt.cmd === 0xff) lines.push('接收器拒绝（CMD=FF）；检查鼠标是否在无线范围内。')

  const cmd = pkt.cmd
  const logical = tlwLogicalCmd(cmd)
  if (logical === TLW_FW_CMD.BASIC) {
    lines.push(formatBasic(parseTlwBasicInfo(pkt.data)))
  } else if (logical === TLW_FW_CMD.GET_FUNC || logical === TLW_FW_CMD.SET_FUNC) {
    lines.push(`功能区 ADDR=${pkt.addr}`)
    lines.push(formatTlwFunctions(pkt.data))
  } else if (
    logical === TLW_FW_CMD.GET_DEFKEY ||
    logical === TLW_FW_CMD.GET_KEY ||
    logical === TLW_FW_CMD.SET_KEY
  ) {
    lines.push(`按键 ADDR=${pkt.addr}`)
    lines.push(formatTlwKeys(pkt.data))
  } else if (logical === TLW_FW_CMD.BATTERY) {
    const bat = parseTlwBattery(pkt.data)
    lines.push(`电量=${bat.percent}% ${chargeLabel(bat.charging)}`)
  } else if (cmd === TLW_CMD.WIRELESS || logical === tlwLogicalCmd(TLW_CMD.WIRELESS)) {
    lines.push(`2.4G=${parseTlwWireless(pkt.data) ? '已连接' : '断连'}`)
  } else if (logical === TLW_FW_CMD.START) {
    lines.push('快速通讯开始')
  } else if (logical === TLW_FW_CMD.END) {
    lines.push('快速通讯结束')
  } else if (logical === TLW_FW_CMD.FACTORY) {
    lines.push('恢复出厂（处理约 2s，期间勿再发）')
  } else if (logical === tlwLogicalCmd(TLW_CMD.GET_MACRO) || logical === TLW_FW_CMD.SET_MACRO) {
    lines.push(`宏 ADDR=${pkt.addr} 预览: ${toHex(pkt.data.slice(0, Math.min(16, pkt.data.length)))}`)
  }
  if (pkt.data.length > 0) {
    lines.push(`DATA: ${toHex(pkt.data.slice(0, Math.min(24, pkt.data.length)))}`)
  }
  return lines.join('\n')
}

export function parseTlwHex(text: string, bodyLen = TLW_BODY_LEN): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bodyLen > 0 && bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  if (bodyLen > 0) return padToLength(bytes, bodyLen)
  return Uint8Array.from(bytes)
}

function fwRead(cmd: number, addr = 0, len?: number): Uint8Array {
  return buildTlwFrame({ cmd, addr, len: len ?? defaultDataLen(cmd), checksum: false })
}

function docRead(cmd: number, addr = 0, len?: number): Uint8Array {
  return buildTlwFrame({ cmd, addr, len: len ?? defaultDataLen(cmd), checksum: true })
}

export interface TlwDumpProgress {
  step: string
  index: number
  total: number
}

export interface TlwDumpOptions {
  gapMs?: number
  onProgress?: (p: TlwDumpProgress) => void
  family?: TlwCommandFamily
  mode?: TlwLinkMode
}

function packetCount(totalBytes: number, dataSize: number): number {
  return Math.max(1, Math.ceil(totalBytes / dataSize))
}

/**
 * 按 Anxiu/CB75 抓包分包读取：基本信息 + 功能区 128B + 默认/当前按键 + 电量。
 * 默认 current 族（A3/A5/A7/A8/BA，Cs=00）+ 有线 56B。
 * 无线：24B 分包、payload[31]=2，整段读写包在 START/END 之间。
 */
export async function dumpTlwSnapshot(
  exchange: (frame: Uint8Array, expectPrefix?: number[]) => Promise<Uint8Array>,
  options?: TlwDumpOptions,
): Promise<{ text: string }> {
  if (options?.family == null) {
    try {
      return await dumpTlwSnapshot(exchange, { ...options, family: 'current' })
    } catch (error) {
      if (!/超时|timeout/i.test(String(error))) throw error
      return dumpTlwSnapshot(exchange, { ...options, family: 'legacy' })
    }
  }
  const gapMs = options?.gapMs ?? 20
  const family: TlwCommandFamily = options.family
  const mode: TlwLinkMode = options?.mode ?? 'wired'
  const dataSize = mode === 'wireless' ? TLW_WIRELESS_DATA : TLW_WIRED_DATA
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const send = async (frame: Uint8Array, step: string, index: number, total: number) => {
    const tx = mode === 'wireless' ? applyTlwWirelessRoute(frame) : frame
    options?.onProgress?.({ step, index, total })
    const rx = await exchange(tx, tlwExpectPrefix(tx))
    if (gapMs > 0) await sleep(gapMs)
    return rx
  }

  const cmd = (logical: number) => tlwWireCmd(logical, family)
  let step = 0
  const keyGuess = 24
  const totalSteps =
    (mode === 'wireless' ? 2 : 0) +
    packetCount(34, dataSize) +
    packetCount(TLW_FUNC_BYTES, dataSize) +
    packetCount(keyGuess, dataSize) * 2 +
    1

  const session = async <T>(work: () => Promise<T>): Promise<T> => {
    if (mode !== 'wireless') return work()
    await send(fwRead(cmd(TLW_FW_CMD.START), 0, 24), '无线通讯开始', step++, totalSteps)
    try {
      return await work()
    } finally {
      await send(fwRead(cmd(TLW_FW_CMD.END), 0, 24), '无线通讯结束', step++, totalSteps)
    }
  }

  return session(async () => {
    const readRange = async (logical: number, totalBytes: number, label: string) => {
      const wire = cmd(logical)
      const out = new Uint8Array(totalBytes)
      for (let addr = 0; addr < totalBytes; addr += dataSize) {
        const len = Math.min(dataSize, totalBytes - addr)
        const rx = await send(fwRead(wire, addr, len), `${label} ADDR=${addr}`, step++, totalSteps)
        const part = extractTlwData(rx, wire)
        out.set(part.subarray(0, len), addr)
      }
      return out
    }

    const basicRaw = await readRange(TLW_FW_CMD.BASIC, 34, '基本信息')
    const basic = parseTlwBasicInfo(basicRaw)
    const functions = await readRange(TLW_FW_CMD.GET_FUNC, TLW_FUNC_BYTES, '功能区')
    const keyBytes = basic.valid && basic.keyBytes > 0 ? basic.keyBytes : TLW_KEYS_BYTES
    const defKeys = await readRange(TLW_FW_CMD.GET_DEFKEY, keyBytes, '默认按键')
    const keys = await readRange(TLW_FW_CMD.GET_KEY, keyBytes, '当前按键')
    const batCmd = cmd(TLW_FW_CMD.BATTERY)
    const batRx = await send(fwRead(batCmd), '电量', step++, totalSteps)
    const battery = parseTlwBattery(extractTlwData(batRx, batCmd))

    const keyCount = basic.valid && basic.keyCount > 0 ? basic.keyCount : Math.floor(keyBytes / 3)
    const familyNote = family === 'current' ? '当前固件 A3/A5/A7/A8/BA' : '旧固件 03/05/07/08/1A'
    const text = [
      `TLW 设备快照（${familyNote}，${mode === 'wireless' ? '无线 24B' : '有线 56B'}）`,
      '',
      '—— 基本信息 ——',
      formatBasic(basic),
      '',
      '—— 功能区 ——',
      formatTlwFunctions(functions, basic.valid ? basic.dpiStageCount : undefined),
      '',
      '—— 默认按键 ——',
      formatTlwKeys(defKeys, keyCount),
      '',
      '—— 当前按键 ——',
      formatTlwKeys(keys, keyCount),
      '',
      `—— 电量 ——\n${battery.percent}% ${chargeLabel(battery.charging)}`,
    ].join('\n')
    return { text }
  })
}

const PRESETS: PresetCommand[] = [
  // —— 当前固件（Cs=00，CMD = 逻辑号 + 0xA0；Anxiu 9/16 有线抓包）——
  {
    id: 'cur_basic',
    label: '当前固件 读基本信息 (0xA3)',
    cmd: TLW_CMD.BASIC,
    build: () => fwRead(TLW_CMD.BASIC),
  },
  {
    id: 'cur_func_p0',
    label: '当前固件 读功能区 ADDR=0 (0xA5)',
    cmd: TLW_CMD.GET_FUNC,
    build: () => fwRead(TLW_CMD.GET_FUNC, 0, 56),
  },
  {
    id: 'cur_func_p1',
    label: '当前固件 读功能区 ADDR=56 (0xA5)',
    cmd: TLW_CMD.GET_FUNC,
    build: () => fwRead(TLW_CMD.GET_FUNC, 56, 56),
  },
  {
    id: 'cur_func_p2',
    label: '当前固件 读功能区 ADDR=112 (0xA5)',
    cmd: TLW_CMD.GET_FUNC,
    build: () => fwRead(TLW_CMD.GET_FUNC, 112, 16),
  },
  {
    id: 'cur_defkey_p0',
    label: '当前固件 读默认按键 ADDR=0 (0xA7)',
    cmd: TLW_CMD.GET_DEFKEY,
    build: () => fwRead(TLW_CMD.GET_DEFKEY, 0, 56),
  },
  {
    id: 'cur_key_p0',
    label: '当前固件 读当前按键 ADDR=0 (0xA8)',
    cmd: TLW_CMD.GET_KEY,
    build: () => fwRead(TLW_CMD.GET_KEY, 0, 56),
  },
  {
    id: 'cur_battery',
    label: '当前固件 读电量 (0xBA)',
    cmd: TLW_CMD.BATTERY,
    build: () => fwRead(TLW_CMD.BATTERY),
  },
  {
    id: 'tlw_dump_all',
    label: '当前固件 读取有线快照（多包）',
    cmd: TLW_CMD.BASIC,
    build: () => fwRead(TLW_CMD.BASIC),
  },
  {
    id: 'tlw_dump_wireless',
    label: '当前固件 读取无线快照（24B+路由）',
    cmd: TLW_CMD.BASIC,
    build: () => applyTlwWirelessRoute(fwRead(TLW_CMD.BASIC, 0, 24)),
  },
  {
    id: 'cur_start',
    label: '当前固件 快速通讯开始 (0xA1)',
    cmd: TLW_CMD.START,
    build: () => fwRead(TLW_CMD.START, 0, 24),
  },
  {
    id: 'cur_end',
    label: '当前固件 快速通讯结束 (0xA2)',
    cmd: TLW_CMD.END,
    build: () => fwRead(TLW_CMD.END, 0, 24),
  },
  {
    id: 'cur_factory',
    label: '当前固件 恢复出厂 (0xAD，约 2s)',
    cmd: TLW_CMD.FACTORY,
    build: () => fwRead(TLW_CMD.FACTORY, 0, 24),
  },
  // —— 旧固件低命令族（Cs=00）——
  {
    id: 'fw_basic',
    label: '旧固件 读基本信息 (0x03)',
    cmd: TLW_FW_CMD.BASIC,
    build: () => fwRead(TLW_FW_CMD.BASIC),
  },
  {
    id: 'fw_func_p0',
    label: '旧固件 读功能区 ADDR=0 (0x05)',
    cmd: TLW_FW_CMD.GET_FUNC,
    build: () => fwRead(TLW_FW_CMD.GET_FUNC, 0, 56),
  },
  {
    id: 'fw_func_p1',
    label: '旧固件 读功能区 ADDR=56 (0x05)',
    cmd: TLW_FW_CMD.GET_FUNC,
    build: () => fwRead(TLW_FW_CMD.GET_FUNC, 56, 56),
  },
  {
    id: 'fw_func_p2',
    label: '旧固件 读功能区 ADDR=112 (0x05)',
    cmd: TLW_FW_CMD.GET_FUNC,
    build: () => fwRead(TLW_FW_CMD.GET_FUNC, 112, 16),
  },
  {
    id: 'fw_defkey_p0',
    label: '旧固件 读默认按键 ADDR=0 (0x07)',
    cmd: TLW_FW_CMD.GET_DEFKEY,
    build: () => fwRead(TLW_FW_CMD.GET_DEFKEY, 0, 56),
  },
  {
    id: 'fw_key_p0',
    label: '旧固件 读当前按键 ADDR=0 (0x08)',
    cmd: TLW_FW_CMD.GET_KEY,
    build: () => fwRead(TLW_FW_CMD.GET_KEY, 0, 56),
  },
  {
    id: 'fw_battery',
    label: '旧固件 读电量 (0x1A)',
    cmd: TLW_FW_CMD.BATTERY,
    build: () => fwRead(TLW_FW_CMD.BATTERY),
  },
  {
    id: 'fw_start',
    label: '旧固件 快速通讯开始 (0x01)',
    cmd: TLW_FW_CMD.START,
    build: () => fwRead(TLW_FW_CMD.START, 0, 24),
  },
  {
    id: 'fw_end',
    label: '旧固件 快速通讯结束 (0x02)',
    cmd: TLW_FW_CMD.END,
    build: () => fwRead(TLW_FW_CMD.END, 0, 24),
  },
  // —— 文档 PDF（带 Cs）——
  {
    id: 'doc_start',
    label: '文档 快速通讯开始 (0xA1)',
    cmd: TLW_CMD.START,
    build: () => docRead(TLW_CMD.START),
  },
  {
    id: 'doc_end',
    label: '文档 快速通讯结束 (0xA2)',
    cmd: TLW_CMD.END,
    build: () => docRead(TLW_CMD.END),
  },
  {
    id: 'doc_basic',
    label: '文档 读基本信息 (0xA3)',
    cmd: TLW_CMD.BASIC,
    build: () => docRead(TLW_CMD.BASIC),
  },
  {
    id: 'doc_func_p0',
    label: '文档 读功能区 ADDR=0 (0xA5)',
    cmd: TLW_CMD.GET_FUNC,
    build: () => docRead(TLW_CMD.GET_FUNC, 0, 56),
  },
  {
    id: 'doc_defkey_p0',
    label: '文档 读默认按键 ADDR=0 (0xA7)',
    cmd: TLW_CMD.GET_DEFKEY,
    build: () => docRead(TLW_CMD.GET_DEFKEY, 0, 56),
  },
  {
    id: 'doc_key_p0',
    label: '文档 读当前按键 ADDR=0 (0xA8)',
    cmd: TLW_CMD.GET_KEY,
    build: () => docRead(TLW_CMD.GET_KEY, 0, 56),
  },
  {
    id: 'doc_battery',
    label: '文档 读电量 (0xBA)',
    cmd: TLW_CMD.BATTERY,
    build: () => docRead(TLW_CMD.BATTERY, 0, 2),
  },
  {
    id: 'doc_wireless',
    label: '文档 读 2.4G 连接 (0xC2)',
    cmd: TLW_CMD.WIRELESS,
    build: () => docRead(TLW_CMD.WIRELESS),
  },
  {
    id: 'doc_macro_p0',
    label: '文档 读宏 ADDR=0 (0xB4)',
    cmd: TLW_CMD.GET_MACRO,
    build: () => docRead(TLW_CMD.GET_MACRO, 0, 56),
  },
  {
    id: 'doc_factory',
    label: '文档 恢复出厂 (0xAD，约 2s)',
    cmd: TLW_CMD.FACTORY,
    build: () => docRead(TLW_CMD.FACTORY),
  },
]

export const tlwProfile: ProtocolProfile = {
  id: 'tlw',
  label: 'TLW 网页AP',
  vids: ['320F'],
  bodyLen: TLW_BODY_LEN,
  reportId: TLW_REPORT_ID,
  channel: 'output',
  checksum: 'none',
  usagePageHint: TLW_USAGE_PAGE,
  timeoutMs: 800,
  presets: PRESETS,
  buildFrame: (cmd, params, data) =>
    buildTlwFrame({
      cmd,
      addr: params ? (params[0] ?? 0) | ((params[1] ?? 0) << 8) : 0,
      len: params?.[2],
      data,
      checksum: (params?.[3] ?? 1) !== 0,
    }),
  applyChecksum: applyTlwChecksum,
  parseHex: parseTlwHex,
  parseResponse: parseTlwResponse,
}
