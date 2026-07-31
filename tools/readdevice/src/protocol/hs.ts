import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex } from './types'

/** 航晟 ARGB 灯键盘上位机驱动协议 v0.1.3。
 * PDF 写 64 字节；实机 VID 342D（如 RK R108）厂商口 UsagePage=0xFF00，
 * HID Report=33（ReportID + 32 字节 body），走 Output/Input。
 */
export const FRAME_LEN = 32

/** CMD codes */
export const HS_CMD = {
  MACRO: 0x80,
  LIGHT_MONO_MAIN: 0x81,
  KEYMAP: 0x82,
  HW_INFO: 0x83,
  CUSTOM_MONO: 0x84,
  LIGHT_RGB_MAIN: 0x85,
  LIGHT_MONO_SIDE: 0x87,
  LIGHT_RGB_SIDE: 0x88,
  CUSTOM_RGB: 0x89,
} as const

/** 按键矩阵：6×21×4 层，每键 2 字节 LE。 */
export const HS_KEYMAP = {
  rows: 6,
  cols: 21,
  layers: 4,
  keyDataLen: 2,
  /** 每包最多键数 */
  maxKeysPerPackage: 0x0e,
} as const

export const HS_KEY_COUNT = HS_KEYMAP.rows * HS_KEYMAP.cols // 126
export const HS_READ_LEN_PER_PACKAGE = HS_KEYMAP.keyDataLen * HS_KEYMAP.maxKeysPerPackage // 0x1C
export const HS_KEYMAP_TOTAL_BYTES =
  HS_KEY_COUNT * HS_KEYMAP.layers * HS_KEYMAP.keyDataLen // 1008

export interface HsBuildOptions {
  cmd: number
  /** Byte1 操作类型 */
  type?: number
  /** Byte2.. 参数 / 数据（不含 CMD、type） */
  payload?: ArrayLike<number>
}

/** get_buffer：82 01 addrL addrH readLen */
export function buildHsGetBufferFrame(addr: number, readLen: number): Uint8Array {
  return buildHsFrame({
    cmd: HS_CMD.KEYMAP,
    type: 0x01,
    payload: [addr & 0xff, (addr >> 8) & 0xff, readLen & 0xff],
  })
}

/** 从 get_buffer 回包提取负载（跳过 CMD+类型）。 */
export function extractHsGetBufferPayload(report: ArrayLike<number>, readLen: number): Uint8Array {
  const b0 = (report[0] ?? 0) & 0xff
  const b1 = (report[1] ?? 0) & 0xff
  let off = 0
  if (b0 === HS_CMD.KEYMAP && b1 === 0x01) {
    off = 2
  } else if ((report[1] ?? 0) === HS_CMD.KEYMAP && (report[2] ?? 0) === 0x01) {
    // 容忍可选 Report ID 前缀
    off = 3
  } else {
    throw new Error(
      `get_buffer 回包异常: 期望 82 01，实际 ${((report[0] ?? 0) & 0xff).toString(16)} ${((report[1] ?? 0) & 0xff).toString(16)}`,
    )
  }
  const out = new Uint8Array(readLen)
  for (let i = 0; i < readLen; i++) {
    out[i] = (report[off + i] ?? 0) & 0xff
  }
  return out
}

/** 原始键表 → 每层 Uint16[]（小端，长度 126）。 */
export function parseHsKeyBufferToLayers(keysBuffer: ArrayLike<number>): number[][] {
  const layers: number[][] = []
  for (let layer = 0; layer < HS_KEYMAP.layers; layer++) {
    const row: number[] = []
    for (let keyIndex = 0; keyIndex < HS_KEY_COUNT; keyIndex++) {
      const offset = layer * HS_KEY_COUNT * HS_KEYMAP.keyDataLen + keyIndex * HS_KEYMAP.keyDataLen
      const lo = (keysBuffer[offset] ?? 0) & 0xff
      const hi = (keysBuffer[offset + 1] ?? 0) & 0xff
      row.push(lo | (hi << 8))
    }
    layers.push(row)
  }
  return layers
}

/**
 * 格式化为可复制数组：每层一个 []，每行 COLS 个数字（无空格）。
 * 例：
 * 层0:
 * [
 *   41,0,58,...
 *   ...
 * ]
 */
export function formatHsLayersAsCopyableArrays(layers: number[][]): string {
  const blocks: string[] = []
  for (let layer = 0; layer < layers.length; layer++) {
    const keys = layers[layer] ?? []
    const lines: string[] = ['[']
    for (let row = 0; row < HS_KEYMAP.rows; row++) {
      const slice = keys.slice(row * HS_KEYMAP.cols, (row + 1) * HS_KEYMAP.cols)
      const line = slice.join(',')
      const isLast = row === HS_KEYMAP.rows - 1
      lines.push(`  ${line}${isLast ? '' : ','}`)
    }
    lines.push(']')
    blocks.push(`层${layer}:\n${lines.join('\n')}`)
  }
  return blocks.join('\n\n')
}

export interface HsKeymapDumpProgress {
  packageIndex: number
  packageCount: number
  addr: number
  readLen: number
}

/**
 * 分包读取全盘按键矩阵。
 * 不绑定具体 PID：按 6×21×4×2 自算地址，自行组 82 01 包；
 * 收包侧应由 exchange 过滤期望前缀 82 01（丢弃残留报告）。
 */
export async function dumpHsKeymapBuffer(
  exchange: (frame: Uint8Array) => Promise<Uint8Array>,
  options?: {
    gapMs?: number
    onProgress?: (p: HsKeymapDumpProgress) => void
    /** 默认用航晟 32B 帧；巨朋等可传入 64B 组帧函数 */
    buildGetBuffer?: (addr: number, readLen: number) => Uint8Array
  },
): Promise<{ keysBuffer: Uint8Array; layers: number[][]; text: string }> {
  const gapMs = options?.gapMs ?? 20
  const buildGetBuffer = options?.buildGetBuffer ?? buildHsGetBufferFrame
  const keysBuffer = new Uint8Array(HS_KEYMAP_TOTAL_BYTES)
  const packageCount = Math.ceil(HS_KEYMAP_TOTAL_BYTES / HS_READ_LEN_PER_PACKAGE)

  for (let packageIndex = 0; packageIndex < packageCount; packageIndex++) {
    const addr = HS_READ_LEN_PER_PACKAGE * packageIndex
    const readLen = Math.min(HS_READ_LEN_PER_PACKAGE, HS_KEYMAP_TOTAL_BYTES - addr)
    options?.onProgress?.({ packageIndex, packageCount, addr, readLen })

    const tx = buildGetBuffer(addr, readLen)
    const rx = await exchange(tx)
    const payload = extractHsGetBufferPayload(rx, readLen)
    keysBuffer.set(payload, addr)

    if (gapMs > 0 && packageIndex + 1 < packageCount) {
      await new Promise((r) => setTimeout(r, gapMs))
    }
  }

  const layers = parseHsKeyBufferToLayers(keysBuffer)
  const text = formatHsLayersAsCopyableArrays(layers)
  return { keysBuffer, layers, text }
}

/** Build HS vendor report body (32 bytes for VID 342D; no Report ID). */
export function buildHsFrame(opts: HsBuildOptions): Uint8Array {
  const frame = new Uint8Array(FRAME_LEN)
  frame[0] = opts.cmd & 0xff
  frame[1] = (opts.type ?? 0) & 0xff
  const payload = opts.payload
  if (payload) {
    const n = Math.min(payload.length, FRAME_LEN - 2)
    for (let i = 0; i < n; i++) frame[2 + i] = payload[i] & 0xff
  }
  return frame
}

export function applyChecksumNone(frame: Uint8Array): Uint8Array {
  return new Uint8Array(frame)
}

export function parseHsHex(text: string, bodyLen = FRAME_LEN): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  return padToLength(bytes, bodyLen)
}

function u8(data: ArrayLike<number>, i: number): number {
  return (data[i] ?? 0) & 0xff
}

function hex2(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

function formatVersion(lo16: number): string {
  const j = (lo16 >> 12) & 0x0f
  const m = (lo16 >> 8) & 0x0f
  const nn = lo16 & 0xff
  return `${j}.${m}.${nn.toString(16).toUpperCase().padStart(2, '0')}`
}

function lightTypeLabel(type: number, rgb: boolean): string {
  const map: Record<number, string> = {
    0x01: 'get_status',
    0x02: 'set_enable',
    0x03: 'set_mode',
    0x04: 'set_val',
    0x05: 'set_speed',
    0x06: 'set_color',
  }
  if (!rgb && type === 0x06) return `类型=0x${hex2(type)}`
  return map[type] ?? `类型=0x${hex2(type)}`
}

function keymapTypeLabel(type: number): string {
  const map: Record<number, string> = {
    0x01: 'get_buffer',
    0x02: 'reset_keymap',
    0x03: 'set_keycode',
    0x04: 'get_layer_count',
    0x05: 'get_encoder_buffer',
    0x06: 'set_encoder_buffer',
  }
  return map[type] ?? `类型=0x${hex2(type)}`
}

function customTypeLabel(type: number): string {
  const map: Record<number, string> = {
    0x01: 'get_status',
    0x02: 'get_index',
    0x03: 'get_data',
    0x04: 'set_data',
    0x05: 'set_play',
    0x06: 'set_stop',
    0x07: 'set_save',
  }
  return map[type] ?? `类型=0x${hex2(type)}`
}

function macroTypeLabel(type: number): string {
  const map: Record<number, string> = {
    0x01: 'read',
    0x02: 'write',
    0x03: 'del',
    0x04: 'get_macro_size',
  }
  return map[type] ?? `类型=0x${hex2(type)}`
}

function parseLightResponse(cmd: number, type: number, data: ArrayLike<number>, rgb: boolean): string {
  const zone =
    cmd === HS_CMD.LIGHT_MONO_MAIN || cmd === HS_CMD.LIGHT_RGB_MAIN ? '主灯区' : '侧灯区'
  const kind = rgb ? 'RGB' : '单色'
  const head = [
    `CMD=0x${hex2(cmd)}`,
    lightTypeLabel(type, rgb),
    `${kind}${zone}`,
  ]
  if (type === 0x01 && data.length >= (rgb ? 8 : 6)) {
    const parts = [
      ...head,
      `使能=${u8(data, 2)}`,
      `模式=${u8(data, 3)}`,
      `亮度=${u8(data, 4)}`,
      `速度=${u8(data, 5)}`,
    ]
    if (rgb) {
      parts.push(`HUE=${u8(data, 6)}`, `SAT=${u8(data, 7)}`)
    }
    return parts.join(' ')
  }
  if (data.length > 2) {
    return `${head.join(' ')} 数据=${toHex(
      Array.from({ length: Math.min(16, data.length - 2) }, (_, i) => u8(data, 2 + i)),
    )}`
  }
  return head.join(' ')
}

function parseKeymapResponse(type: number, data: ArrayLike<number>): string {
  const head = [`CMD=0x82`, keymapTypeLabel(type)]
  if (type === 0x04 && data.length >= 3) {
    return `${head.join(' ')} 层数=${u8(data, 2)}`
  }
  if (type === 0x01 || type === 0x05) {
    const payload = Array.from(
      { length: Math.min(60, Math.max(0, data.length - 2)) },
      (_, i) => u8(data, 2 + i),
    )
    return `${head.join(' ')} 负载 ${payload.length}B: ${toHex(payload.slice(0, 24))}${
      payload.length > 24 ? ' …' : ''
    }`
  }
  if (data.length > 2) {
    return `${head.join(' ')} ${toHex(
      Array.from({ length: Math.min(8, data.length - 2) }, (_, i) => u8(data, 2 + i)),
    )}`
  }
  return head.join(' ')
}

function parseHwInfoResponse(type: number, data: ArrayLike<number>): string {
  if (type === 0x01 && data.length >= 4) {
    // 4 字节版本号（不足则按已有字节 LE 拼）：丢弃高 16 位，低 16 位 = 0xJMNN
    const b0 = u8(data, 2)
    const b1 = u8(data, 3)
    const b2 = data.length > 4 ? u8(data, 4) : 0
    const b3 = data.length > 5 ? u8(data, 5) : 0
    const dword = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    const lo = dword & 0xffff
    const raw = toHex([b0, b1, b2, b3])
    return `CMD=0x83 get_version 原始=${raw} 版本=${formatVersion(lo)} (0x${lo.toString(16).toUpperCase().padStart(4, '0')})`
  }
  return `CMD=0x83 类型=0x${hex2(type)} ${toHex(
    Array.from({ length: Math.min(16, data.length) }, (_, i) => u8(data, i)),
  )}`
}

function parseCustomLedResponse(cmd: number, type: number, data: ArrayLike<number>): string {
  const kind = cmd === HS_CMD.CUSTOM_RGB ? 'RGB录制' : '单色录制'
  const head = [`CMD=0x${hex2(cmd)}`, customTypeLabel(type), kind]
  if (type === 0x01 && data.length >= 6) {
    return [
      ...head,
      `通道数=${u8(data, 2)}`,
      `灯珠数=${u8(data, 3)}`,
      `播放通道=${u8(data, 4)}`,
      `录制中=${u8(data, 5)}`,
    ].join(' ')
  }
  if (data.length > 2) {
    return `${head.join(' ')} 数据=${toHex(
      Array.from({ length: Math.min(24, data.length - 2) }, (_, i) => u8(data, 2 + i)),
    )}`
  }
  return head.join(' ')
}

function parseMacroResponse(type: number, data: ArrayLike<number>): string {
  const head = [`CMD=0x80`, macroTypeLabel(type)]
  if (type === 0x04 && data.length >= 4) {
    const size = u8(data, 2) | (u8(data, 3) << 8)
    return `${head.join(' ')} size=${size}`
  }
  if ((type === 0x01 || type === 0x02) && data.length >= 4) {
    return `${head.join(' ')} 总包=${u8(data, 2)} 当前=${u8(data, 3)} 数据=${toHex(
      Array.from({ length: Math.min(16, Math.max(0, data.length - 4)) }, (_, i) => u8(data, 4 + i)),
    )}`
  }
  return `${head.join(' ')} ${toHex(
    Array.from({ length: Math.min(16, data.length) }, (_, i) => u8(data, i)),
  )}`
}

export function parseHsResponse(_cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'
  // 容忍可选 Report ID 前缀
  let off = 0
  const b0 = u8(data, 0)
  if (data.length > 2 && b0 < 0x80 && u8(data, 1) >= 0x80) {
    off = 1
  }
  const cmd = u8(data, off)
  const type = u8(data, off + 1)
  const body = Array.from({ length: Math.max(0, data.length - off) }, (_, i) => u8(data, off + i))

  switch (cmd) {
    case HS_CMD.MACRO:
      return parseMacroResponse(type, body)
    case HS_CMD.LIGHT_MONO_MAIN:
    case HS_CMD.LIGHT_MONO_SIDE:
      return parseLightResponse(cmd, type, body, false)
    case HS_CMD.LIGHT_RGB_MAIN:
    case HS_CMD.LIGHT_RGB_SIDE:
      return parseLightResponse(cmd, type, body, true)
    case HS_CMD.KEYMAP:
      return parseKeymapResponse(type, body)
    case HS_CMD.HW_INFO:
      return parseHwInfoResponse(type, body)
    case HS_CMD.CUSTOM_MONO:
    case HS_CMD.CUSTOM_RGB:
      return parseCustomLedResponse(cmd, type, body)
    default:
      return `CMD=0x${hex2(cmd)} 类型=0x${hex2(type)} 原始=${toHex(
        body.slice(0, Math.min(24, body.length)),
      )}`
  }
}

const PRESETS: PresetCommand[] = [
  // —— 硬件信息 ——
  {
    id: 'get_version',
    label: '获取固件版本 (0x83)',
    cmd: HS_CMD.HW_INFO,
    params: [0x01],
  },
  // —— 灯光：单色主灯区 ——
  {
    id: 'mono_main_status',
    label: '单色主灯 状态 (0x81)',
    cmd: HS_CMD.LIGHT_MONO_MAIN,
    params: [0x01],
  },
  {
    id: 'mono_main_enable',
    label: '单色主灯 开启 (0x81)',
    cmd: HS_CMD.LIGHT_MONO_MAIN,
    params: [0x02, 0x01],
  },
  {
    id: 'mono_main_disable',
    label: '单色主灯 关闭 (0x81)',
    cmd: HS_CMD.LIGHT_MONO_MAIN,
    params: [0x02, 0x00],
  },
  {
    id: 'mono_main_mode0',
    label: '单色主灯 模式0 (0x81)',
    cmd: HS_CMD.LIGHT_MONO_MAIN,
    params: [0x03, 0x00],
  },
  {
    id: 'mono_main_bright',
    label: '单色主灯 亮度128 (0x81)',
    cmd: HS_CMD.LIGHT_MONO_MAIN,
    params: [0x04, 0x80],
  },
  {
    id: 'mono_main_speed',
    label: '单色主灯 速度5 (0x81)',
    cmd: HS_CMD.LIGHT_MONO_MAIN,
    params: [0x05, 0x05],
  },
  // —— 灯光：RGB 主灯区 ——
  {
    id: 'rgb_main_status',
    label: 'RGB主灯 状态 (0x85)',
    cmd: HS_CMD.LIGHT_RGB_MAIN,
    params: [0x01],
  },
  {
    id: 'rgb_main_enable',
    label: 'RGB主灯 开启 (0x85)',
    cmd: HS_CMD.LIGHT_RGB_MAIN,
    params: [0x02, 0x01],
  },
  {
    id: 'rgb_main_color',
    label: 'RGB主灯 颜色 HUE=0 SAT=255 (0x85)',
    cmd: HS_CMD.LIGHT_RGB_MAIN,
    params: [0x06, 0x00, 0xff],
  },
  // —— 灯光：侧灯区 ——
  {
    id: 'mono_side_status',
    label: '单色侧灯 状态 (0x87)',
    cmd: HS_CMD.LIGHT_MONO_SIDE,
    params: [0x01],
  },
  {
    id: 'rgb_side_status',
    label: 'RGB侧灯 状态 (0x88)',
    cmd: HS_CMD.LIGHT_RGB_SIDE,
    params: [0x01],
  },
  // —— 改键 ——
  {
    id: 'keymap_layers',
    label: '获取层数 (0x82)',
    cmd: HS_CMD.KEYMAP,
    params: [0x04],
  },
  {
    id: 'keymap_get_buffer',
    label: '读取按键矩阵 包0 addr=0 len=28 (0x82)',
    cmd: HS_CMD.KEYMAP,
    // type, addrL, addrH, length（每包最多 0x1C）
    params: [0x01, 0x00, 0x00, HS_READ_LEN_PER_PACKAGE],
  },
  {
    id: 'keymap_dump_all',
    label: '读取全盘按键矩阵（36包）',
    cmd: HS_CMD.KEYMAP,
    // 占位：实际由 UI「读取全盘」走 dumpHsKeymapBuffer
    params: [0x01, 0x00, 0x00, HS_READ_LEN_PER_PACKAGE],
  },
  {
    id: 'keymap_reset',
    label: '重置按键矩阵 (0x82)',
    cmd: HS_CMD.KEYMAP,
    params: [0x02],
  },
  {
    id: 'keymap_set_key',
    label: '改键 L0 R0 C0 → 0x0004 (0x82)',
    cmd: HS_CMD.KEYMAP,
    // type, layer, row, col, keyLo, keyHi
    params: [0x03, 0x00, 0x00, 0x00, 0x04, 0x00],
  },
  {
    id: 'encoder_get',
    label: '读取编码器矩阵 L0 id0 CW (0x82)',
    cmd: HS_CMD.KEYMAP,
    params: [0x05, 0x00, 0x00, 0x01],
  },
  // —— 宏 ——
  {
    id: 'macro_size',
    label: '获取宏容量 (0x80)',
    cmd: HS_CMD.MACRO,
    params: [0x04],
  },
  {
    id: 'macro_read0',
    label: '读取宏 包0/1 (0x80)',
    cmd: HS_CMD.MACRO,
    // type, total, index
    params: [0x01, 0x01, 0x00],
  },
  {
    id: 'macro_del',
    label: '删除宏 包0/1 (0x80)',
    cmd: HS_CMD.MACRO,
    params: [0x03, 0x01, 0x00],
  },
  // —— 自定义灯效（单色） ——
  {
    id: 'custom_mono_status',
    label: '单色录制灯效 状态 (0x84)',
    cmd: HS_CMD.CUSTOM_MONO,
    params: [0x01],
  },
  {
    id: 'custom_mono_index',
    label: '单色录制 灯珠索引 index=0 len=60 (0x84)',
    cmd: HS_CMD.CUSTOM_MONO,
    params: [0x02, 0x00, 0x3c],
  },
  {
    id: 'custom_mono_play0',
    label: '单色录制 播放通道0 (0x84)',
    cmd: HS_CMD.CUSTOM_MONO,
    params: [0x05, 0x00],
  },
  {
    id: 'custom_mono_stop',
    label: '单色录制 停止 (0x84)',
    cmd: HS_CMD.CUSTOM_MONO,
    params: [0x06],
  },
  {
    id: 'custom_mono_save0',
    label: '单色录制 保存通道0 (0x84)',
    cmd: HS_CMD.CUSTOM_MONO,
    params: [0x07, 0x00],
  },
  // —— 自定义灯效（RGB） ——
  {
    id: 'custom_rgb_status',
    label: 'RGB录制灯效 状态 (0x89)',
    cmd: HS_CMD.CUSTOM_RGB,
    params: [0x01],
  },
  {
    id: 'custom_rgb_play0',
    label: 'RGB录制 播放通道0 (0x89)',
    cmd: HS_CMD.CUSTOM_RGB,
    params: [0x05, 0x00],
  },
  {
    id: 'custom_rgb_stop',
    label: 'RGB录制 停止 (0x89)',
    cmd: HS_CMD.CUSTOM_RGB,
    params: [0x06],
  },
]

export const hsProfile: ProtocolProfile = {
  id: 'hs',
  label: '航晟 HS',
  vids: ['342D'],
  bodyLen: FRAME_LEN,
  reportId: 0,
  /** 实机 Feature Get 失败；厂商口 In/Out=33 走 Output/Input。 */
  channel: 'output',
  checksum: 'none',
  usagePageHint: 0xff00,
  timeoutMs: 300,
  presets: PRESETS,
  buildFrame: (cmd, params, data) => {
    const type = params?.[0] ?? 0
    const rest: number[] = []
    if (params && params.length > 1) {
      for (let i = 1; i < params.length; i++) rest.push(params[i] & 0xff)
    }
    if (data) {
      for (let i = 0; i < data.length; i++) rest.push(data[i] & 0xff)
    }
    return buildHsFrame({ cmd, type, payload: rest })
  },
  applyChecksum: applyChecksumNone,
  parseHex: parseHsHex,
  parseResponse: parseHsResponse,
}
