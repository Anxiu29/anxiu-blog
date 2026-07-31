import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex } from './types'

/**
 * 星闪悦动 SparkLink KB2 通信协议 V1.0.7
 * 帧：head=0x5C | len(1) | cmd(1) | crc(1) | data(n)，应答 cmd|0x80
 * CRC（官方 SDK）：0x35 + head + len + cmd + data 末字节
 * HID：UsagePage=0xFFB0 Usage=0x01，包长 64；VID=1CA2，走 Output/Input
 */
export const FRAME_LEN = 64
export const SLK_HEAD = 0x5c

export const SLK_CMD = {
  CMD: 0x00,
  SYNC: 0x01,
  RM6X21: 0x12,
  PRGB: 0x18,
  LOGORGB: 0x19,
  MACRO: 0x20,
  MACRO_MODE: 0x21,
  KEY: 0x23,
  MT: 0x24,
  TGL: 0x25,
  DKS: 0x26,
  MPT: 0x27,
  END: 0x28,
  DB: 0x29,
  KRGB: 0x2a,
  DEFKEY: 0x2b,
  SOCD: 0x2c,
  RS: 0x2d,
  BL_SIGN: 0x08,
  BL_ERASE: 0x09,
  BL_REBOOT: 0x0a,
  BL_TOAPP: 0x0b,
  BL_WRITE: 0x0c,
  BL_READ: 0x0d,
  BL_RCRC: 0x0e,
  FAIL: 0xff,
} as const

/** CMD(0x00) 子命令 order（协议附表） */
export const SLK_ORDER = {
  PROTOCOL_VERSION: 0x01,
  SAVING_PARAMETER: 0x02,
  RELOAD_PARAMETERS: 0x03,
  CLEAR_CALIBRATION: 0x04,
  OPEN_DKS: 0x05,
  CLOSE_DKS: 0x06,
  REVERSE: 0x07,
  TURN_ON_REMAPPING: 0x08,
  TURN_OFF_REMAPPING: 0x09,
  ENABLE_RELATIVE_TRIGGER: 0x0a,
  TURN_OFF_RELATIVE_TRIGGER: 0x0b,
  START_CALIBRATION: 0x0c,
  CLOSE_CALIBRATION: 0x0d,
  START_DEMONSTRATION: 0x0e,
  CLOSE_DEMONSTRATION: 0x0f,
  ERASE_MACRO_STORAGE: 0x10,
  RESTORE_FACTORY: 0x11,
  LOCK_WIN_KEY: 0x20,
  QUERY_WIN_MODEL: 0x21,
  QUERY_MAC_MODEL: 0x22,
  QUERY_STANDARD_MODEL: 0x23,
  QUERY_ADJUSTABLE_MODEL: 0x24,
  PRECISION_STROKE: 0x25,
  KEYBOARD_NAME: 0x26,
  KEYBOARD_COLOR: 0x27,
  SET_WIN_MODEL: 0x30,
  SET_MAC_MODEL: 0x31,
  SET_STANDARD_MODEL: 0x32,
  SET_ADJUSTABLE_MODEL: 0x33,
  TOP_DEAD_SWITCH: 0x34,
  RGB1: 0x40,
  RGB2: 0x41,
  RGB3: 0x42,
  RGB4: 0x43,
  ROES: 0x50,
  WEB: 0x60,
  SOCD_SWITCH: 0x61,
  CONFIG: 0x70,
  CURRENT_AXIS: 0x75,
  AXIS_LIST: 0x76,
  APPEARANCE_COLOR: 0xa0,
  RT_TRIGGER_MODE: 0xa1,
} as const

const CMD_LABEL: Record<number, string> = {
  [SLK_CMD.CMD]: '操作 CMD',
  [SLK_CMD.SYNC]: 'SYNC 同步',
  [SLK_CMD.RM6X21]: '矩阵 6×21',
  [SLK_CMD.PRGB]: '主灯 PRGB',
  [SLK_CMD.LOGORGB]: 'Logo RGB',
  [SLK_CMD.MACRO]: '宏数据',
  [SLK_CMD.MACRO_MODE]: '宏模式',
  [SLK_CMD.KEY]: '改键 KEY',
  [SLK_CMD.MT]: 'MT',
  [SLK_CMD.TGL]: 'TGL',
  [SLK_CMD.DKS]: 'DKS',
  [SLK_CMD.MPT]: 'MPT',
  [SLK_CMD.END]: 'END',
  [SLK_CMD.DB]: '全局行程 DB',
  [SLK_CMD.KRGB]: '单键 RGB',
  [SLK_CMD.DEFKEY]: '默认键值',
  [SLK_CMD.SOCD]: 'SOCD',
  [SLK_CMD.RS]: 'RS',
  [SLK_CMD.BL_SIGN]: 'BL 签名',
  [SLK_CMD.BL_ERASE]: 'BL 擦除',
  [SLK_CMD.BL_REBOOT]: 'BL 重启',
  [SLK_CMD.BL_TOAPP]: 'BL 跳转 App',
  [SLK_CMD.BL_WRITE]: 'BL 写',
  [SLK_CMD.BL_READ]: 'BL 读',
  [SLK_CMD.BL_RCRC]: 'BL CRC',
  [SLK_CMD.FAIL]: '失败',
}

const ORDER_LABEL: Record<number, string> = {
  [SLK_ORDER.PROTOCOL_VERSION]: '协议版本',
  [SLK_ORDER.SAVING_PARAMETER]: '保存参数',
  [SLK_ORDER.RELOAD_PARAMETERS]: '重载参数',
  [SLK_ORDER.CLEAR_CALIBRATION]: '清除校准',
  [SLK_ORDER.OPEN_DKS]: '开启 DKS',
  [SLK_ORDER.CLOSE_DKS]: '关闭 DKS',
  [SLK_ORDER.REVERSE]: '反向',
  [SLK_ORDER.TURN_ON_REMAPPING]: '开启重映射',
  [SLK_ORDER.TURN_OFF_REMAPPING]: '关闭重映射',
  [SLK_ORDER.ENABLE_RELATIVE_TRIGGER]: '开启相对触发',
  [SLK_ORDER.TURN_OFF_RELATIVE_TRIGGER]: '关闭相对触发',
  [SLK_ORDER.START_CALIBRATION]: '开启校准',
  [SLK_ORDER.CLOSE_CALIBRATION]: '关闭校准',
  [SLK_ORDER.START_DEMONSTRATION]: '演示开',
  [SLK_ORDER.CLOSE_DEMONSTRATION]: '演示关',
  [SLK_ORDER.ERASE_MACRO_STORAGE]: '擦除宏存储',
  [SLK_ORDER.RESTORE_FACTORY]: '恢复出厂',
  [SLK_ORDER.LOCK_WIN_KEY]: '查询锁 Win',
  [SLK_ORDER.QUERY_WIN_MODEL]: '查询 Win 模式',
  [SLK_ORDER.QUERY_MAC_MODEL]: '查询 Mac 模式',
  [SLK_ORDER.QUERY_STANDARD_MODEL]: '查询标准模式',
  [SLK_ORDER.QUERY_ADJUSTABLE_MODEL]: '查询可调行程',
  [SLK_ORDER.PRECISION_STROKE]: '行程精度',
  [SLK_ORDER.KEYBOARD_NAME]: '键盘名字',
  [SLK_ORDER.KEYBOARD_COLOR]: '键盘颜色',
  [SLK_ORDER.SET_WIN_MODEL]: '切 Win',
  [SLK_ORDER.SET_MAC_MODEL]: '切 Mac',
  [SLK_ORDER.SET_STANDARD_MODEL]: '切标准',
  [SLK_ORDER.SET_ADJUSTABLE_MODEL]: '切可调行程',
  [SLK_ORDER.TOP_DEAD_SWITCH]: '顶部死区',
  [SLK_ORDER.RGB1]: 'RGB 灰度1',
  [SLK_ORDER.RGB2]: 'RGB 灰度2',
  [SLK_ORDER.RGB3]: 'RGB 灰度3',
  [SLK_ORDER.RGB4]: 'RGB 灰度4',
  [SLK_ORDER.ROES]: '回报率',
  [SLK_ORDER.WEB]: '网址',
  [SLK_ORDER.SOCD_SWITCH]: 'SOCD 开关',
  [SLK_ORDER.CONFIG]: '配置切换',
  [SLK_ORDER.CURRENT_AXIS]: '当前轴体',
  [SLK_ORDER.AXIS_LIST]: '支持轴体',
  [SLK_ORDER.APPEARANCE_COLOR]: '外观颜色',
  [SLK_ORDER.RT_TRIGGER_MODE]: 'RT 触发模式',
}

/** true=读(0x00)，false=写(0x01) — 与官方 SDK bitReadWrite 一致 */
export function slkRw(read = true): number {
  return read ? 0x00 : 0x01
}

/**
 * CRC：0x35 + Head + Len + Cmd + data[last]
 * （与 @sparklinkplayjoy/protocol-keyboard computeCRC 一致）
 */
export function computeSlkCrc(len: number, cmd: number, data: ArrayLike<number>): number {
  let crc = 0x35
  crc += SLK_HEAD
  crc += len & 0xff
  crc += cmd & 0xff
  // 与官方一致：取完整 data 的最后一字节 data[len-1]（即 pack[len+3]）
  if (len > 0 && len <= 63 * 4 && data.length >= len) {
    crc += data[len - 1]! & 0xff
  }
  return crc & 0xff
}

export function buildSlkFrame(cmd: number, data: ArrayLike<number> = []): Uint8Array {
  const payload = Array.from(data, (b) => b & 0xff)
  const len = payload.length
  const crc = computeSlkCrc(len, cmd, payload)
  const frame = new Uint8Array(FRAME_LEN)
  frame[0] = SLK_HEAD
  frame[1] = len & 0xff
  frame[2] = cmd & 0xff
  frame[3] = crc
  for (let i = 0; i < payload.length && 4 + i < FRAME_LEN; i++) {
    frame[4 + i] = payload[i]!
  }
  return frame
}

/** SYNC：4 字节随机数 + 2×0xFF 占位 */
export function buildSlkSync(random: number[] = [0x01, 0x02, 0x03, 0x04]): Uint8Array {
  return buildSlkFrame(SLK_CMD.SYNC, [...random.slice(0, 4), 0xff, 0xff])
}

/** 操作命令：order + 可选 hArgs + 2×0xFF */
export function buildSlkCmd(order: number, hArgs: ArrayLike<number> = []): Uint8Array {
  const args = Array.from(hArgs, (b) => b & 0xff)
  return buildSlkFrame(SLK_CMD.CMD, [order & 0xff, ...args, 0xff, 0xff])
}

/** 读默认键值：row1/row2，一次传两行 */
export function buildSlkDefKey(row1: number, row2: number): Uint8Array {
  return buildSlkFrame(SLK_CMD.DEFKEY, [slkRw(true), row1 & 0xff, row2 & 0xff])
}

export const SLK_DEFKEY_ROWS = 6
export const SLK_DEFKEY_COLS = 21

export interface SlkDefKeyRow {
  row: number
  keys: number[]
}

/**
 * 解析 DEFKEY 应答 payload（crc 之后）：
 * Err[1] + ROWx[1] + DefKeyx[21] + ROWy[1] + DefKeyy[21]
 */
export function parseSlkDefKeyPayload(data: ArrayLike<number>): {
  err: number
  rows: SlkDefKeyRow[]
} | null {
  if (data.length < 1 + 2 * (1 + SLK_DEFKEY_COLS)) return null
  const err = (data[0] ?? 0) & 0xff
  const rows: SlkDefKeyRow[] = []
  let off = 1
  for (let i = 0; i < 2; i++) {
    const row = (data[off] ?? 0) & 0xff
    off += 1
    const keys: number[] = []
    for (let col = 0; col < SLK_DEFKEY_COLS; col++) {
      keys.push((data[off + col] ?? 0) & 0xff)
    }
    off += SLK_DEFKEY_COLS
    rows.push({ row, keys })
  }
  return { err, rows }
}

/** 从完整 HID 回包提取 DEFKEY 两行 */
export function extractSlkDefKeyRows(raw: ArrayLike<number>): SlkDefKeyRow[] {
  const parsed = parseSlkFrame(raw)
  if (!parsed) throw new Error('DEFKEY 回包无 0x5C 帧头')
  if (parsed.cmdReq !== SLK_CMD.DEFKEY) {
    throw new Error(
      `DEFKEY 回包 cmd 异常: 期望 0x${(SLK_CMD.DEFKEY | 0x80).toString(16)}，实际 0x${parsed.cmd.toString(16)}`,
    )
  }
  const body = parseSlkDefKeyPayload(parsed.data)
  if (!body) throw new Error('DEFKEY 载荷长度不足')
  if (body.err !== 0) throw new Error(`DEFKEY Err=${body.err}`)
  return body.rows
}

/**
 * 格式同航晟单层：6 行 × 每行 21 个数（十六进制）。
 * 三次指令各回 2 行，第 2/3 次接在下面。
 */
export function formatSlkDefKeyAsCopyableArrays(matrix: number[][]): string {
  const lines: string[] = ['[']
  for (let row = 0; row < SLK_DEFKEY_ROWS; row++) {
    const slice = matrix[row] ?? Array(SLK_DEFKEY_COLS).fill(0)
    const padded = [...slice]
    while (padded.length < SLK_DEFKEY_COLS) padded.push(0)
    const line = padded
      .slice(0, SLK_DEFKEY_COLS)
      .map((v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0'))
      .join(',')
    const isLast = row === SLK_DEFKEY_ROWS - 1
    lines.push(`  ${line}${isLast ? '' : ','}`)
  }
  lines.push(']')
  return `默认键值:\n${lines.join('\n')}`
}

export interface SlkDefKeyDumpProgress {
  packageIndex: number
  packageCount: number
  row1: number
  row2: number
}

/** 三次 DEFKEY 读完 6×21 默认键值矩阵 */
export async function dumpSlkDefKeyMatrix(
  exchange: (frame: Uint8Array) => Promise<Uint8Array>,
  options?: {
    gapMs?: number
    onProgress?: (p: SlkDefKeyDumpProgress) => void
  },
): Promise<{ matrix: number[][]; text: string }> {
  const gapMs = options?.gapMs ?? 20
  const pairs: [number, number][] = [
    [0, 1],
    [2, 3],
    [4, 5],
  ]
  const matrix: number[][] = Array.from({ length: SLK_DEFKEY_ROWS }, () =>
    Array(SLK_DEFKEY_COLS).fill(0),
  )

  for (let packageIndex = 0; packageIndex < pairs.length; packageIndex++) {
    const [row1, row2] = pairs[packageIndex]!
    options?.onProgress?.({ packageIndex, packageCount: pairs.length, row1, row2 })
    const tx = buildSlkDefKey(row1, row2)
    const rx = await exchange(tx)
    const rows = extractSlkDefKeyRows(rx)
    for (const { row, keys } of rows) {
      if (row < 0 || row >= SLK_DEFKEY_ROWS) continue
      const line = keys.slice(0, SLK_DEFKEY_COLS)
      while (line.length < SLK_DEFKEY_COLS) line.push(0)
      matrix[row] = line
    }
    if (gapMs > 0 && packageIndex + 1 < pairs.length) {
      await new Promise((r) => setTimeout(r, gapMs))
    }
  }

  return { matrix, text: formatSlkDefKeyAsCopyableArrays(matrix) }
}

/** 读层矩阵：matrix=层(0=FN0…)，datatype=1 为 8bit；16bit 则 datatype=1 再 2 */
export function buildSlkRm6x21(matrix = 0, datatype = 1): Uint8Array {
  return buildSlkFrame(SLK_CMD.RM6X21, [matrix & 0xff, datatype & 0xff, 0xff, 0xff])
}

const SLK_ERR: Record<number, string> = {
  0x00: '无错误',
  0x01: 'Flash 地址溢出',
  0x02: 'Flash 大小溢出',
  0x03: '缓存溢出',
  0x04: '参数错误',
  0x05: '签名失效',
  0x06: '签名错误',
  0x07: '签名数据错误',
  0x08: '签名状态错误',
  0x09: '签名无此操作',
  0x0a: '设备忙',
  0x0b: '写重复',
  0x0c: '状态错误',
  0x0d: 'CRC 错误',
  0xff: '命令无效',
}

/** 协议层编号（RM6X21.matrix6x21 / KEY.Layout） */
export const SLK_LAYER: Record<number, string> = {
  0x00: 'FN0',
  0x01: 'FN1',
  0x02: 'FN2',
  0x03: 'FN3',
  0x04: 'DB0',
  0x05: 'DB1',
  0x06: 'DB2',
  0x07: 'DB3',
  0x08: 'MODE',
  0x09: 'DKS1',
  0x0a: 'DKS2',
  0x0b: 'DKS3',
  0x0c: 'DKS4',
  0x0d: 'TRPS1',
  0x0e: 'TRPS2',
  0x0f: 'TRPS3',
  0x10: 'TRPS4',
  0x11: 'MacroAddr',
  0x12: 'MacroSize',
  0x13: 'MTDelay',
  0x14: 'RTP',
  0x15: 'RTR',
  0x16: 'DP',
  0x17: 'DR',
  0x18: 'KR',
  0x19: 'AXIS',
}

export interface SlkKeyItem {
  /** 默认布局原始键位；0xFF=整盘 */
  key: number
  layout: number
  /** New Key 16bit LE；读全盘时协议写 New Key=0xFF */
  value?: number
}

/** 改键 KEY：一组 Key+Layout+NewKey[2]，最多 14 组 */
export function buildSlkKey(read: boolean, items: SlkKeyItem[]): Uint8Array {
  const payload: number[] = [slkRw(read)]
  for (const item of items.slice(0, 14)) {
    const v = item.value ?? 0
    payload.push(item.key & 0xff, item.layout & 0xff, v & 0xff, (v >> 8) & 0xff)
  }
  return buildSlkFrame(SLK_CMD.KEY, payload)
}

/** 读某 Layout 全盘键值：Key=0xFF，New Key=0xFF */
export function buildSlkKeyReadLayout(layout: number): Uint8Array {
  return buildSlkKey(true, [{ key: 0xff, layout, value: 0xff }])
}

/** 读全局行程 DB：RW + ticks/dBi/死区占位（官方 DBDataPack） */
export function buildSlkDbRead(): Uint8Array {
  return buildSlkFrame(SLK_CMD.DB, [slkRw(true), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

/** 读主灯 PRGB */
export function buildSlkPrgbRead(): Uint8Array {
  return buildSlkFrame(SLK_CMD.PRGB, [slkRw(true)])
}

/** 读 Logo 灯 */
export function buildSlkLogorgbRead(): Uint8Array {
  return buildSlkFrame(SLK_CMD.LOGORGB, [slkRw(true)])
}

/** 读单键 RGB：Key=0xFF 表示查询 */
export function buildSlkKrgbRead(key = 0xff): Uint8Array {
  return buildSlkFrame(SLK_CMD.KRGB, [slkRw(true), key & 0xff])
}

/** 读高级键（Key=0xFF 整盘探测）：MT/TGL/DKS/MPT/END/SOCD/RS */
export function buildSlkAdvKeyRead(cmd: number, key = 0xff): Uint8Array {
  return buildSlkFrame(cmd, [slkRw(true), key & 0xff])
}

export interface SlkParsedFrame {
  head: number
  len: number
  cmd: number
  cmdReq: number
  crc: number
  crcOk: boolean
  /** data 是否已按 len 收齐（多包应答未收齐时为 false） */
  complete: boolean
  /** 当前缓冲里已有的 data 字节数 */
  received: number
  data: Uint8Array
  offset: number
}

/** 完整帧字节数：head+len+cmd+crc+data[len] */
export function slkFrameTotalBytes(len: number): number {
  return 4 + (len & 0xff)
}

/**
 * 从首包推断还需要凑齐的总字节数（含帧头）。
 * 后续 HID 报告为协议字节流续传（官方 createProtocolSlice），不一定再带 0x5C。
 */
export function slkAssembleTargetBytes(first: ArrayLike<number>): number | null {
  let offset = 0
  const b0 = (first[0] ?? 0) & 0xff
  if (b0 !== SLK_HEAD && (first[1] ?? 0) === SLK_HEAD) offset = 1
  if (((first[offset] ?? 0) & 0xff) !== SLK_HEAD) return null
  if (first.length < offset + 2) return null
  const len = (first[offset + 1] ?? 0) & 0xff
  return offset + slkFrameTotalBytes(len)
}

/** 定位 0x5C 帧（容忍可选 Report ID） */
export function parseSlkFrame(raw: ArrayLike<number>): SlkParsedFrame | null {
  let offset = 0
  const b0 = (raw[0] ?? 0) & 0xff
  if (b0 !== SLK_HEAD && (raw[1] ?? 0) === SLK_HEAD) offset = 1
  if (((raw[offset] ?? 0) & 0xff) !== SLK_HEAD) return null
  if (raw.length < offset + 4) return null

  const len = (raw[offset + 1] ?? 0) & 0xff
  const cmd = (raw[offset + 2] ?? 0) & 0xff
  const crc = (raw[offset + 3] ?? 0) & 0xff
  const available = Math.max(0, raw.length - offset - 4)
  const received = Math.min(len, available)
  const complete = available >= len
  const data = new Uint8Array(len)
  for (let i = 0; i < received; i++) data[i] = (raw[offset + 4 + i] ?? 0) & 0xff
  const crcOk = complete && crc === computeSlkCrc(len, cmd, data)
  return {
    head: SLK_HEAD,
    len,
    cmd,
    cmdReq: cmd & 0x7f,
    crc,
    crcOk,
    complete,
    received,
    data,
    offset,
  }
}

function decodeAscii(bytes: ArrayLike<number>): string {
  const filtered: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]! & 0xff
    if (b !== 0 && b !== 0xff) filtered.push(b)
  }
  if (!filtered.length) return ''
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(filtered))
  } catch {
    return toHex(filtered)
  }
}

function parseProtocolVersion(data: ArrayLike<number>): string | null {
  if (data.length < 4) return null
  // SDK：version1=data[3]&0x0f, version2=(data[2]>>4)&0x0f, version3=data[2]&0x0f
  // data 若含 order 在 [0]，则版本在 [1..]；兼容 order@0 与官方 getCmdRecdata 的 data[1]=order
  let d2 = (data[2] ?? 0) & 0xff
  let d3 = (data[3] ?? 0) & 0xff
  if (((data[0] ?? 0) & 0xff) === SLK_ORDER.PROTOCOL_VERSION && data.length >= 3) {
    // payload: order, verLo?, verHi? — 官方解析把整包当 data 且 order 在 [1]
    // 我们这里 data 已是 payload：order 在 [0]
    d2 = (data[1] ?? 0) & 0xff
    d3 = (data[2] ?? 0) & 0xff
  }
  const v1 = d3 & 0x0f
  const v2 = (d2 >> 4) & 0x0f
  const v3 = d2 & 0x0f
  return `${v1}.${v2}.${v3}`
}

function parseSyncSummary(data: ArrayLike<number>): string[] {
  const lines: string[] = []
  if (data.length < 8) return lines
  // 官方 getCmdSyncRecdata 在「跳过 1 字节」后取 BoardID；兼容 payload 直接布局
  const boardId =
    ((data[1] ?? 0) |
      ((data[2] ?? 0) << 8) |
      ((data[3] ?? 0) << 16) |
      ((data[4] ?? 0) << 24)) >>>
    0
  lines.push(`BoardID=0x${boardId.toString(16).toUpperCase().padStart(8, '0')}`)
  lines.push(`KeyType=${(data[3] ?? 0) & 0xff}`)
  lines.push(`Layout=${(data[4] ?? 0) & 0xff}`)
  lines.push(`RunMode=${(data[7] ?? 0) & 0xff}`)
  if (data.length >= 25) {
    const sn = decodeAscii(Array.from({ length: 16 }, (_, i) => data[9 + i] ?? 0))
    if (sn) lines.push(`SN=${sn}`)
  }
  if (data.length >= 36) {
    const ver = decodeAscii(Array.from({ length: 11 }, (_, i) => data[26 + i] ?? 0))
    if (ver) lines.push(`App=${ver}`)
  }
  return lines
}

export function parseSlkResponse(_cmd: number, raw: ArrayLike<number>): string {
  const parsed = parseSlkFrame(raw)
  if (!parsed) {
    return `非 SparkLink 帧（无 0x5C）\nHEX: ${toHex(raw)}`
  }

  const label = CMD_LABEL[parsed.cmdReq] ?? `CMD 0x${parsed.cmdReq.toString(16)}`
  const lines: string[] = [
    `${label} 应答 cmd=0x${parsed.cmd.toString(16).toUpperCase()} (req=0x${parsed.cmdReq.toString(16)})`,
  ]
  if (!parsed.complete) {
    lines.push(
      `len=${parsed.len} crc=0x${parsed.crc.toString(16).toUpperCase().padStart(2, '0')} 数据未收齐 ${parsed.received}/${parsed.len}（多包未拼完，CRC 待收齐后校验）`,
    )
  } else {
    lines.push(
      `len=${parsed.len} crc=0x${parsed.crc.toString(16).toUpperCase().padStart(2, '0')}${parsed.crcOk ? ' OK' : ' 校验失败'}`,
    )
  }

  const { data } = parsed
  if (parsed.cmdReq === SLK_CMD.SYNC) {
    lines.push(...parseSyncSummary(data))
  } else if (parsed.cmdReq === SLK_CMD.CMD && data.length > 0) {
    const order = data[0]! & 0xff
    lines.push(`order=0x${order.toString(16).toUpperCase()} ${ORDER_LABEL[order] ?? ''}`)
    if (order === SLK_ORDER.PROTOCOL_VERSION) {
      const ver = parseProtocolVersion(data)
      if (ver) lines.push(`协议版本=${ver}`)
    } else if (order === SLK_ORDER.KEYBOARD_NAME) {
      const name = decodeAscii(data.slice(1, 33))
      if (name) lines.push(`名字=${name}`)
    } else if (order === SLK_ORDER.ROES) {
      const rateMap: Record<number, string> = {
        0: '8KHz',
        1: '4KHz',
        2: '2KHz',
        3: '1KHz',
        4: '500Hz',
        5: '250Hz',
        6: '125Hz',
      }
      const v = (data[1] ?? 0) & 0xff
      lines.push(`回报率=${rateMap[v] ?? v}`)
    } else if (
      order === SLK_ORDER.QUERY_WIN_MODEL ||
      order === SLK_ORDER.QUERY_MAC_MODEL ||
      order === SLK_ORDER.QUERY_STANDARD_MODEL ||
      order === SLK_ORDER.QUERY_ADJUSTABLE_MODEL ||
      order === SLK_ORDER.LOCK_WIN_KEY ||
      order === SLK_ORDER.SET_WIN_MODEL ||
      order === SLK_ORDER.SET_MAC_MODEL ||
      order === SLK_ORDER.SET_STANDARD_MODEL ||
      order === SLK_ORDER.SET_ADJUSTABLE_MODEL ||
      order === SLK_ORDER.CONFIG ||
      order === SLK_ORDER.KEYBOARD_COLOR ||
      order === SLK_ORDER.TOP_DEAD_SWITCH ||
      order === SLK_ORDER.APPEARANCE_COLOR ||
      order === SLK_ORDER.RT_TRIGGER_MODE ||
      order === SLK_ORDER.SOCD_SWITCH
    ) {
      lines.push(`s_arg=${(data[1] ?? 0) & 0xff}`)
    } else if (order === SLK_ORDER.PRECISION_STROKE && data.length >= 7) {
      const precision = ((data[1] ?? 0) & 0xff) / 1000
      const min = (((data[3] ?? 0) << 8) | (data[2] ?? 0)) / 1000
      const max = (((data[5] ?? 0) << 8) | (data[4] ?? 0)) / 1000
      lines.push(`精度=${precision}mm 行程=${min}~${max}mm`)
    }
  } else if (parsed.cmdReq === SLK_CMD.DEFKEY && data.length >= 1) {
    const err = data[0]! & 0xff
    lines.push(`Err=0x${err.toString(16).toUpperCase().padStart(2, '0')} (${SLK_ERR[err] ?? '未知'})`)
    const body = parseSlkDefKeyPayload(data)
    if (body) {
      for (const row of body.rows) {
        const hex = row.keys.map((v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0')).join(',')
        lines.push(`ROW${row.row}: ${hex}`)
      }
    }
  } else if (parsed.cmdReq === SLK_CMD.KEY && data.length >= 1) {
    // 应答：Err[1] + (Key,Layout,NewKeyLE)×N；整盘读时 Key=0xFF 请求
    const err = data[0]! & 0xff
    lines.push(`Err=0x${err.toString(16).toUpperCase().padStart(2, '0')} (${SLK_ERR[err] ?? '未知'})`)
    const pairs: string[] = []
    for (let i = 0; i + 4 < data.length; i += 4) {
      const key = data[i + 1]! & 0xff
      const layout = data[i + 2]! & 0xff
      const value = ((data[i + 3]! & 0xff) | ((data[i + 4]! & 0xff) << 8)) & 0xffff
      if (key === 0 && layout === 0xff) continue
      pairs.push(
        `Key=0x${key.toString(16).toUpperCase().padStart(2, '0')} Layout=0x${layout
          .toString(16)
          .toUpperCase()
          .padStart(2, '0')}(${SLK_LAYER[layout] ?? '?'}) New=0x${value.toString(16).toUpperCase().padStart(4, '0')}`,
      )
    }
    if (pairs.length) lines.push(`改键组(${pairs.length}):\n${pairs.slice(0, 32).join('\n')}${pairs.length > 32 ? '\n…' : ''}`)
  } else if (parsed.cmdReq === SLK_CMD.DB && data.length >= 9) {
    const travel = (((data[4] ?? 0) << 8) | (data[3] ?? 0)) / 1000
    const press = (((data[6] ?? 0) << 8) | (data[5] ?? 0)) / 1000
    const release = (((data[8] ?? 0) << 8) | (data[7] ?? 0)) / 1000
    lines.push(`全局行程=${travel}mm 按下死区=${press}mm 释放死区=${release}mm`)
  } else if (parsed.cmdReq === SLK_CMD.RM6X21 && data.length >= 2) {
    // 载荷：Err[1] + MATRIX[1] + 内容(最多 2+126B)
    const err = data[0]! & 0xff
    const layer = data[1]! & 0xff
    lines.push(
      `Err=0x${err.toString(16).toUpperCase().padStart(2, '0')} (${SLK_ERR[err] ?? '未知'})`,
    )
    lines.push(`层=0x${layer.toString(16).toUpperCase().padStart(2, '0')} (${SLK_LAYER[layer] ?? '未知'})`)
    if (err !== 0) {
      lines.push('提示：RM6X21 读 FN0/FN1 键值常返回参数错误；默认键位请用 DEFKEY，改键层请用 KEY+Layout')
    }
    const body = data.slice(2)
    if (err === 0 && parsed.complete && body.length >= 21) {
      const rows: string[] = ['矩阵 6×21 (十六进制):', '[']
      const rowCount = Math.min(6, Math.floor(body.length / 21))
      for (let r = 0; r < rowCount; r++) {
        const slice = Array.from(body.slice(r * 21, r * 21 + 21), (v) =>
          (v & 0xff).toString(16).toUpperCase().padStart(2, '0'),
        )
        rows.push(`  ${slice.join(',')}${r === rowCount - 1 ? '' : ','}`)
      }
      rows.push(']')
      lines.push(rows.join('\n'))
    }
  }

  if (data.length) {
    lines.push(`Data: ${toHex(data)}`)
  }
  return lines.join('\n')
}

function applyChecksumNone(frame: Uint8Array): Uint8Array {
  return frame
}

function parseSlkHex(text: string, bodyLen?: number): Uint8Array {
  const bytes = parseHexBytes(text)
  return padToLength(bytes, bodyLen ?? FRAME_LEN)
}

const PRESETS: PresetCommand[] = [
  // —— 同步 / 设备信息 ——
  {
    id: 'sync',
    label: 'SYNC 同步设备信息 (0x01)',
    cmd: SLK_CMD.SYNC,
    build: () => buildSlkSync(),
  },
  {
    id: 'protocol_version',
    label: '读协议版本 (CMD/0x01)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.PROTOCOL_VERSION),
  },
  {
    id: 'keyboard_name',
    label: '读键盘名字 (CMD/0x26)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.KEYBOARD_NAME),
  },
  {
    id: 'precision_stroke',
    label: '读行程精度 (CMD/0x25)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.PRECISION_STROKE),
  },
  {
    id: 'keyboard_color',
    label: '查询键盘颜色 (CMD/0x27)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.KEYBOARD_COLOR, [0xff]),
  },
  {
    id: 'appearance_color',
    label: '查询外观颜色 (CMD/0xA0)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.APPEARANCE_COLOR, [0xff]),
  },
  {
    id: 'current_axis',
    label: '读当前轴体 (CMD/0x75)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.CURRENT_AXIS),
  },
  {
    id: 'axis_list',
    label: '查询支持轴体 (CMD/0x76)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.AXIS_LIST),
  },

  // —— 模式查询 / 切换 ——
  {
    id: 'query_win',
    label: '查询 Win 模式 (CMD/0x21)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.QUERY_WIN_MODEL),
  },
  {
    id: 'query_mac',
    label: '查询 Mac 模式 (CMD/0x22)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.QUERY_MAC_MODEL),
  },
  {
    id: 'query_standard',
    label: '查询标准模式 (CMD/0x23)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.QUERY_STANDARD_MODEL),
  },
  {
    id: 'query_adjustable',
    label: '查询可调行程 (CMD/0x24)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.QUERY_ADJUSTABLE_MODEL),
  },
  {
    id: 'lock_win',
    label: '查询锁 Win 键 (CMD/0x20)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.LOCK_WIN_KEY),
  },
  {
    id: 'set_win',
    label: '切换 Win 模式 (CMD/0x30)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.SET_WIN_MODEL),
  },
  {
    id: 'set_mac',
    label: '切换 Mac 模式 (CMD/0x31)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.SET_MAC_MODEL),
  },
  {
    id: 'set_standard',
    label: '切换标准模式 (CMD/0x32)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.SET_STANDARD_MODEL),
  },
  {
    id: 'set_adjustable',
    label: '切换可调行程 (CMD/0x33)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.SET_ADJUSTABLE_MODEL),
  },

  // —— 回报率 / 配置 / 功能开关 ——
  {
    id: 'report_rate',
    label: '读回报率 (CMD/0x50)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.ROES),
  },
  {
    id: 'config_query',
    label: '读当前配置 (CMD/0x70)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.CONFIG),
  },
  {
    id: 'top_dead_query',
    label: '查询顶部死区 (CMD/0x34)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.TOP_DEAD_SWITCH, [0x02]),
  },
  {
    id: 'rt_mode_query',
    label: '查询 RT 触发模式 (CMD/0xA1)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.RT_TRIGGER_MODE, [0xff]),
  },
  {
    id: 'open_dks',
    label: '开启 DKS (CMD/0x05)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.OPEN_DKS),
  },
  {
    id: 'close_dks',
    label: '关闭 DKS (CMD/0x06)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.CLOSE_DKS),
  },
  {
    id: 'remap_on',
    label: '开启重映射 (CMD/0x08)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.TURN_ON_REMAPPING),
  },
  {
    id: 'remap_off',
    label: '关闭重映射 (CMD/0x09)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.TURN_OFF_REMAPPING),
  },
  {
    id: 'rt_on',
    label: '开启相对触发 (CMD/0x0A)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.ENABLE_RELATIVE_TRIGGER),
  },
  {
    id: 'rt_off',
    label: '关闭相对触发 (CMD/0x0B)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.TURN_OFF_RELATIVE_TRIGGER),
  },
  {
    id: 'socd_off',
    label: '关闭 SOCD (CMD/0x61 h=0)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.SOCD_SWITCH, [0x00]),
  },
  {
    id: 'socd_on',
    label: '开启 SOCD (CMD/0x61 h=1)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.SOCD_SWITCH, [0x01]),
  },

  // —— 参数保存 / 校准（写操作） ——
  {
    id: 'save_param',
    label: '保存参数 (CMD/0x02)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.SAVING_PARAMETER),
  },
  {
    id: 'reload_param',
    label: '重载参数 (CMD/0x03)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.RELOAD_PARAMETERS),
  },
  {
    id: 'clear_calibration',
    label: '清除校准 (CMD/0x04)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.CLEAR_CALIBRATION),
  },
  {
    id: 'restore_factory',
    label: '恢复出厂 (CMD/0x11，超时>200ms)',
    cmd: SLK_CMD.CMD,
    build: () => buildSlkCmd(SLK_ORDER.RESTORE_FACTORY),
  },

  // —— DEFKEY 默认布局 ——
  {
    id: 'defkey_r01',
    label: 'DEFKEY 读行 0+1 (0x2B)',
    cmd: SLK_CMD.DEFKEY,
    build: () => buildSlkDefKey(0, 1),
  },
  {
    id: 'defkey_r23',
    label: 'DEFKEY 读行 2+3 (0x2B)',
    cmd: SLK_CMD.DEFKEY,
    build: () => buildSlkDefKey(2, 3),
  },
  {
    id: 'defkey_r45',
    label: 'DEFKEY 读行 4+5 (0x2B)',
    cmd: SLK_CMD.DEFKEY,
    build: () => buildSlkDefKey(4, 5),
  },
  {
    id: 'defkey_dump_all',
    label: '读取全盘默认键值（3包）',
    cmd: SLK_CMD.DEFKEY,
    build: () => buildSlkDefKey(0, 1),
  },

  // —— KEY 改键层（协议：Key=0xFF + NewKey=0xFF 读整盘） ——
  {
    id: 'key_fn0',
    label: 'KEY 读 FN0 全盘 (0x23 Layout=0)',
    cmd: SLK_CMD.KEY,
    build: () => buildSlkKeyReadLayout(0x00),
  },
  {
    id: 'key_fn1',
    label: 'KEY 读 FN1 全盘 (0x23 Layout=1)',
    cmd: SLK_CMD.KEY,
    build: () => buildSlkKeyReadLayout(0x01),
  },
  {
    id: 'key_fn2',
    label: 'KEY 读 FN2 全盘 (0x23 Layout=2)',
    cmd: SLK_CMD.KEY,
    build: () => buildSlkKeyReadLayout(0x02),
  },
  {
    id: 'key_fn3',
    label: 'KEY 读 FN3 全盘 (0x23 Layout=3)',
    cmd: SLK_CMD.KEY,
    build: () => buildSlkKeyReadLayout(0x03),
  },
  {
    id: 'key_mode',
    label: 'KEY 读 MODE 层 (0x23 Layout=8)',
    cmd: SLK_CMD.KEY,
    build: () => buildSlkKeyReadLayout(0x08),
  },
  {
    id: 'key_rtp',
    label: 'KEY 读 RT 按下行程 (Layout=0x14)',
    cmd: SLK_CMD.KEY,
    build: () => buildSlkKeyReadLayout(0x14),
  },
  {
    id: 'key_rtr',
    label: 'KEY 读 RT 释放行程 (Layout=0x15)',
    cmd: SLK_CMD.KEY,
    build: () => buildSlkKeyReadLayout(0x15),
  },

  // —— RM6X21 层矩阵（8bit=dt1；16bit 先 1 再 2） ——
  {
    id: 'rm6x21_fn3',
    label: 'RM6X21 FN3 8bit (3,1) SDK示例',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(3, 1),
  },
  {
    id: 'rm6x21_mode',
    label: 'RM6X21 MODE 8bit (8,1)',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(8, 1),
  },
  {
    id: 'rm6x21_travel_2_lo',
    label: 'RM6X21 行程 matrix=2 dt=1',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(2, 1),
  },
  {
    id: 'rm6x21_travel_2_hi',
    label: 'RM6X21 行程 matrix=2 dt=2',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(2, 2),
  },
  {
    id: 'rm6x21_db0_lo',
    label: 'RM6X21 DB0 行程 dt=1 (4,1)',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(4, 1),
  },
  {
    id: 'rm6x21_db0_hi',
    label: 'RM6X21 DB0 行程 dt=2 (4,2)',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(4, 2),
  },
  {
    id: 'rm6x21_db2_lo',
    label: 'RM6X21 DB2 行程 dt=1 (6,1) SDK示例',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(6, 1),
  },
  {
    id: 'rm6x21_db2_hi',
    label: 'RM6X21 DB2 行程 dt=2 (6,2)',
    cmd: SLK_CMD.RM6X21,
    build: () => buildSlkRm6x21(6, 2),
  },

  // —— 全局行程 / 灯光 ——
  {
    id: 'db_read',
    label: '读全局行程 DB (0x29)',
    cmd: SLK_CMD.DB,
    build: () => buildSlkDbRead(),
  },
  {
    id: 'prgb_read',
    label: '读主灯 PRGB (0x18)',
    cmd: SLK_CMD.PRGB,
    build: () => buildSlkPrgbRead(),
  },
  {
    id: 'logorgb_read',
    label: '读 Logo 灯 (0x19)',
    cmd: SLK_CMD.LOGORGB,
    build: () => buildSlkLogorgbRead(),
  },
  {
    id: 'krgb_read',
    label: '读单键 RGB Key=0xFF (0x2A)',
    cmd: SLK_CMD.KRGB,
    build: () => buildSlkKrgbRead(0xff),
  },

  // —— 高级键（Key=0xFF 探测读） ——
  {
    id: 'mt_read',
    label: '读 MT Key=0xFF (0x24)',
    cmd: SLK_CMD.MT,
    build: () => buildSlkAdvKeyRead(SLK_CMD.MT),
  },
  {
    id: 'tgl_read',
    label: '读 TGL Key=0xFF (0x25)',
    cmd: SLK_CMD.TGL,
    build: () => buildSlkAdvKeyRead(SLK_CMD.TGL),
  },
  {
    id: 'dks_read',
    label: '读 DKS Key=0xFF (0x26)',
    cmd: SLK_CMD.DKS,
    build: () => buildSlkAdvKeyRead(SLK_CMD.DKS),
  },
  {
    id: 'mpt_read',
    label: '读 MPT Key=0xFF (0x27)',
    cmd: SLK_CMD.MPT,
    build: () => buildSlkAdvKeyRead(SLK_CMD.MPT),
  },
  {
    id: 'end_read',
    label: '读 END Key=0xFF (0x28)',
    cmd: SLK_CMD.END,
    build: () => buildSlkAdvKeyRead(SLK_CMD.END),
  },
  {
    id: 'socd_read',
    label: '读 SOCD Key=0xFF (0x2C)',
    cmd: SLK_CMD.SOCD,
    build: () => buildSlkAdvKeyRead(SLK_CMD.SOCD),
  },
  {
    id: 'rs_read',
    label: '读 RS Key=0xFF (0x2D)',
    cmd: SLK_CMD.RS,
    build: () => buildSlkAdvKeyRead(SLK_CMD.RS),
  },
]

export const sparklinkProfile: ProtocolProfile = {
  id: 'sparklink',
  label: '星闪悦动 SparkLink',
  bodyLen: FRAME_LEN,
  reportId: 0,
  // 官方 SDK 走 sendReport（Output/Input）；auto 会先 Feature 再 Output，总线上多发一次
  channel: 'output',
  checksum: 'none',
  usagePageHint: 0xffb0,
  vids: ['1CA2'],
  timeoutMs: 400,
  presets: PRESETS,
  buildFrame: (cmd, params, data) => {
    const rest: number[] = []
    if (params) {
      for (let i = 0; i < params.length; i++) rest.push(params[i]! & 0xff)
    }
    if (data) {
      for (let i = 0; i < data.length; i++) rest.push(data[i]! & 0xff)
    }
    return buildSlkFrame(cmd, rest)
  },
  applyChecksum: applyChecksumNone,
  parseHex: parseSlkHex,
  parseResponse: parseSlkResponse,
}
