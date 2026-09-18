import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex, u16le } from './types'

/**
 * TLW / RK 网页 AP 通讯协议（2026-09-10）。
 * PDF：64 字节 Output Report（含 Report ID）；本工具 Report ID 单独发送，body=63。
 *
 *   [0]=Cs_L [1]=Cs_H [2]=CMD [3]=LEN [4]=ADDR_L [5]=ADDR_H [6]=ACK [7..62]=DATA
 *
 * Cs：从 CMD 加到帧末，16 位小端。文档命令为 0xA1…；CB75 实机为低 8 位且 Cs=00 00。
 */
export const TLW_BODY_LEN = 63
export const TLW_DATA_MAX = 56
export const TLW_REPORT_ID = 4
export const TLW_USAGE_PAGE = 0xff1c
export const TLW_FUNC_BYTES = 128
export const TLW_KEYS_BYTES = 128

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

function defaultDataLen(cmd: number): number {
  switch (cmd & 0xff) {
    case TLW_CMD.START:
    case TLW_CMD.END:
    case TLW_FW_CMD.START:
    case TLW_FW_CMD.END:
      return 24
    case TLW_CMD.BASIC:
    case TLW_FW_CMD.BASIC:
      return 0x22
    case TLW_CMD.BATTERY:
    case TLW_FW_CMD.BATTERY:
      return 6
    case TLW_CMD.WIRELESS:
      return 1
    case TLW_CMD.FACTORY:
      return 0
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
  if (expectCmd != null && pkt.cmd !== (expectCmd & 0xff)) {
    throw new Error(`TLW 回包 CMD=0x${hex2(pkt.cmd)}，期望 0x${hex2(expectCmd)}`)
  }
  if (pkt.ack !== 0) {
    throw new Error(`设备拒绝 CMD=0x${hex2(pkt.cmd)}（ACK=0x${hex2(pkt.ack)}）`)
  }
  return pkt.data
}

export function tlwExpectPrefix(frame: ArrayLike<number>): number[] | undefined {
  const cmd = u8(frame, 2)
  if (u8(frame, 0) === 0 && u8(frame, 1) === 0 && cmd !== 0) {
    return [0, 0, cmd]
  }
  return undefined
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
    const x = u16le(data, o + 2)
    const y = u16le(data, o + 4)
    lines.push(
      `  DPI${i} en=${u8(data, o)} xy=${u8(data, o + 1)} X=${x} Y=${y} RGB=${u8(data, o + 6)},${u8(data, o + 7)},${u8(data, o + 8)}`,
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
  if (pkt.ack !== 0) lines.push('设备拒绝（ACK≠0）。文档 0xA* 命令在 CB75 上常回 ACK=FF。')

  const cmd = pkt.cmd
  if (cmd === TLW_CMD.BASIC || cmd === TLW_FW_CMD.BASIC) {
    lines.push(formatBasic(parseTlwBasicInfo(pkt.data)))
  } else if (cmd === TLW_CMD.GET_FUNC || cmd === TLW_CMD.SET_FUNC || cmd === TLW_FW_CMD.GET_FUNC || cmd === TLW_FW_CMD.SET_FUNC) {
    lines.push(`功能区 ADDR=${pkt.addr}`)
    lines.push(formatTlwFunctions(pkt.data))
  } else if (
    cmd === TLW_CMD.GET_DEFKEY ||
    cmd === TLW_CMD.GET_KEY ||
    cmd === TLW_CMD.SET_KEY ||
    cmd === TLW_FW_CMD.GET_DEFKEY ||
    cmd === TLW_FW_CMD.GET_KEY ||
    cmd === TLW_FW_CMD.SET_KEY
  ) {
    lines.push(`按键 ADDR=${pkt.addr}`)
    lines.push(formatTlwKeys(pkt.data))
  } else if (cmd === TLW_CMD.BATTERY || cmd === TLW_FW_CMD.BATTERY) {
    const bat = parseTlwBattery(pkt.data)
    lines.push(`电量=${bat.percent}% ${chargeLabel(bat.charging)}`)
  } else if (cmd === TLW_CMD.WIRELESS) {
    lines.push(`2.4G=${parseTlwWireless(pkt.data) ? '已连接' : '断连'}`)
  } else if (cmd === TLW_CMD.START || cmd === TLW_FW_CMD.START) {
    lines.push('快速通讯开始')
  } else if (cmd === TLW_CMD.END || cmd === TLW_FW_CMD.END) {
    lines.push('快速通讯结束')
  } else if (cmd === TLW_CMD.FACTORY) {
    lines.push('恢复出厂（处理约 2s，期间勿再发）')
  } else if (cmd === TLW_CMD.GET_MACRO || cmd === TLW_CMD.SET_MACRO || cmd === TLW_FW_CMD.SET_MACRO) {
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

/**
 * 按 CB75 实机命令分包读取：基本信息 + 功能区 128B + 默认/当前按键 + 电量。
 */
export async function dumpTlwSnapshot(
  exchange: (frame: Uint8Array, expectPrefix?: number[]) => Promise<Uint8Array>,
  options?: { gapMs?: number; onProgress?: (p: TlwDumpProgress) => void },
): Promise<{ text: string }> {
  const gapMs = options?.gapMs ?? 20
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const send = async (frame: Uint8Array, step: string, index: number, total: number) => {
    options?.onProgress?.({ step, index, total })
    const rx = await exchange(frame, tlwExpectPrefix(frame))
    if (gapMs > 0) await sleep(gapMs)
    return rx
  }

  let step = 0
  const totalSteps = 1 + 3 + 3 + 3 + 1

  const basicRx = await send(fwRead(TLW_FW_CMD.BASIC), '基本信息', step++, totalSteps)
  const basicData = extractTlwData(basicRx, TLW_FW_CMD.BASIC)
  const basic = parseTlwBasicInfo(basicData)

  const readRange = async (cmd: number, totalBytes: number, label: string) => {
    const out = new Uint8Array(totalBytes)
    for (let addr = 0; addr < totalBytes; addr += TLW_DATA_MAX) {
      const len = Math.min(TLW_DATA_MAX, totalBytes - addr)
      const rx = await send(fwRead(cmd, addr, len), `${label} ADDR=${addr}`, step++, totalSteps)
      const part = extractTlwData(rx, cmd)
      out.set(part.subarray(0, len), addr)
    }
    return out
  }

  const functions = await readRange(TLW_FW_CMD.GET_FUNC, TLW_FUNC_BYTES, '功能区')
  const keyBytes = basic.valid && basic.keyBytes > 0 ? basic.keyBytes : TLW_KEYS_BYTES
  const defKeys = await readRange(TLW_FW_CMD.GET_DEFKEY, keyBytes, '默认按键')
  const keys = await readRange(TLW_FW_CMD.GET_KEY, keyBytes, '当前按键')
  const batRx = await send(fwRead(TLW_FW_CMD.BATTERY), '电量', step++, totalSteps)
  const battery = parseTlwBattery(extractTlwData(batRx, TLW_FW_CMD.BATTERY))

  const keyCount = basic.valid && basic.keyCount > 0 ? basic.keyCount : Math.floor(keyBytes / 3)
  const text = [
    'TLW 设备快照（实机命令 03/05/07/08/1A）',
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
}

const PRESETS: PresetCommand[] = [
  // —— 实机 CB75（Cs=00，命令为文档低 8 位）——
  {
    id: 'fw_basic',
    label: '实机 读基本信息 (0x03)',
    cmd: TLW_FW_CMD.BASIC,
    build: () => fwRead(TLW_FW_CMD.BASIC),
  },
  {
    id: 'fw_func_p0',
    label: '实机 读功能区 ADDR=0 (0x05)',
    cmd: TLW_FW_CMD.GET_FUNC,
    build: () => fwRead(TLW_FW_CMD.GET_FUNC, 0, 56),
  },
  {
    id: 'fw_func_p1',
    label: '实机 读功能区 ADDR=56 (0x05)',
    cmd: TLW_FW_CMD.GET_FUNC,
    build: () => fwRead(TLW_FW_CMD.GET_FUNC, 56, 56),
  },
  {
    id: 'fw_func_p2',
    label: '实机 读功能区 ADDR=112 (0x05)',
    cmd: TLW_FW_CMD.GET_FUNC,
    build: () => fwRead(TLW_FW_CMD.GET_FUNC, 112, 16),
  },
  {
    id: 'fw_defkey_p0',
    label: '实机 读默认按键 ADDR=0 (0x07)',
    cmd: TLW_FW_CMD.GET_DEFKEY,
    build: () => fwRead(TLW_FW_CMD.GET_DEFKEY, 0, 56),
  },
  {
    id: 'fw_key_p0',
    label: '实机 读当前按键 ADDR=0 (0x08)',
    cmd: TLW_FW_CMD.GET_KEY,
    build: () => fwRead(TLW_FW_CMD.GET_KEY, 0, 56),
  },
  {
    id: 'fw_battery',
    label: '实机 读电量 (0x1A)',
    cmd: TLW_FW_CMD.BATTERY,
    build: () => fwRead(TLW_FW_CMD.BATTERY),
  },
  {
    id: 'tlw_dump_all',
    label: '实机 读取设备快照（多包）',
    cmd: TLW_FW_CMD.BASIC,
    build: () => fwRead(TLW_FW_CMD.BASIC),
  },
  {
    id: 'fw_start',
    label: '实机 快速通讯开始 (0x01)',
    cmd: TLW_FW_CMD.START,
    build: () => fwRead(TLW_FW_CMD.START, 0, 24),
  },
  {
    id: 'fw_end',
    label: '实机 快速通讯结束 (0x02)',
    cmd: TLW_FW_CMD.END,
    build: () => fwRead(TLW_FW_CMD.END, 0, 24),
  },
  // —— 文档 PDF ——
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
