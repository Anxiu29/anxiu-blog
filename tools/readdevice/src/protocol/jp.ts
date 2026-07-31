import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex } from './types'
import { HS_READ_LEN_PER_PACKAGE, parseHsResponse } from './hs'

/**
 * 巨朋 JP：
 * 1) 上位机驱动协议（宏/灯光/改键/版本）— USB 包固定 64 字节，VID=0603
 * 2) mono_usb_hid_dfu 在线升级协议 — Feature / IN 混用
 *
 * 回包通道（DFU 文档）：
 * - GET_INFO / WRITE_BUFFER / READ → Get Feature Report
 * - ERASE / PROGRAM_BUFFER / RESET / GO → IN Endpoint
 * 默认 channel=auto。
 */
export const FRAME_LEN = 64

/** DFU 命令 */
export const JP_CMD = {
  GET_INFO: 0x01,
  ERASE: 0x5e,
  WRITE_BUFFER: 0x63,
  PROGRAM_BUFFER: 0x65,
  READ: 0x71,
  RESET: 0x83,
  GO: 0x9b,
} as const

/** 上位机命令（与航晟同骨架） */
export const JP_HOST_CMD = {
  MACRO: 0x80,
  LIGHT_MONO_MAIN: 0x81,
  KEYMAP: 0x82,
  HW_INFO: 0x83,
  LIGHT_RGB_MAIN: 0x85,
  LIGHT_MONO_SIDE: 0x87,
  LIGHT_RGB_SIDE: 0x88,
} as const

export interface JpBuildOptions {
  cmd: number
  /** 紧跟 Cmd 之后的载荷（DFU） */
  payload?: ArrayLike<number>
}

function u16leBytes(n: number): [number, number] {
  const v = n >>> 0
  return [v & 0xff, (v >> 8) & 0xff]
}

function u32leBytes(n: number): [number, number, number, number] {
  const v = n >>> 0
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
}

function readU32le(data: ArrayLike<number>, off: number): number {
  return (
    ((data[off] ?? 0) |
      ((data[off + 1] ?? 0) << 8) |
      ((data[off + 2] ?? 0) << 16) |
      ((data[off + 3] ?? 0) << 24)) >>>
    0
  )
}

export function buildJpFrame(opts: JpBuildOptions): Uint8Array {
  const frame = new Uint8Array(FRAME_LEN)
  frame[0] = opts.cmd & 0xff
  const payload = opts.payload
  if (payload) {
    const n = Math.min(payload.length, FRAME_LEN - 1)
    for (let i = 0; i < n; i++) frame[1 + i] = payload[i] & 0xff
  }
  return frame
}

/** 上位机：CMD + 类型 + 参数，固定 64 字节 */
export function buildJpHostFrame(
  cmd: number,
  type: number,
  payload?: ArrayLike<number>,
): Uint8Array {
  const frame = new Uint8Array(FRAME_LEN)
  frame[0] = cmd & 0xff
  frame[1] = type & 0xff
  if (payload) {
    const n = Math.min(payload.length, FRAME_LEN - 2)
    for (let i = 0; i < n; i++) frame[2 + i] = payload[i] & 0xff
  }
  return frame
}

export function buildJpGetBufferFrame(addr: number, readLen: number): Uint8Array {
  return buildJpHostFrame(JP_HOST_CMD.KEYMAP, 0x01, [
    addr & 0xff,
    (addr >> 8) & 0xff,
    readLen & 0xff,
  ])
}

export function buildJpGetInfo(id = 0x00): Uint8Array {
  return buildJpFrame({ cmd: JP_CMD.GET_INFO, payload: [id & 0xff] })
}

/** method: 0x00 页擦除 / 0xF0 整片擦除 */
export function buildJpErase(method: number, pageAddr = 0, numPages = 0): Uint8Array {
  return buildJpFrame({
    cmd: JP_CMD.ERASE,
    payload: [method & 0xff, 0x00, 0x00, ...u32leBytes(pageAddr), ...u32leBytes(numPages)],
  })
}

/** 写入 Buffer：最多 60 字节数据 */
export function buildJpWriteBuffer(offset: number, data: ArrayLike<number>): Uint8Array {
  const len = Math.min(60, data.length)
  const payload: number[] = [len & 0xff, ...u16leBytes(offset)]
  for (let i = 0; i < len; i++) payload.push(data[i] & 0xff)
  return buildJpFrame({ cmd: JP_CMD.WRITE_BUFFER, payload })
}

export function buildJpProgramBuffer(pageAddr: number, len: number): Uint8Array {
  return buildJpFrame({
    cmd: JP_CMD.PROGRAM_BUFFER,
    payload: [0x00, 0x00, 0x00, ...u32leBytes(pageAddr), ...u16leBytes(len)],
  })
}

/** 读取 Flash/内存：最多 62 字节 */
export function buildJpRead(addr: number, len: number): Uint8Array {
  const n = Math.min(62, Math.max(0, len))
  return buildJpFrame({
    cmd: JP_CMD.READ,
    payload: [0x00, 0x00, 0x00, ...u32leBytes(addr), ...u16leBytes(n)],
  })
}

export function buildJpReset(dlyMs = 1000): Uint8Array {
  return buildJpFrame({
    cmd: JP_CMD.RESET,
    payload: [0x00, 0x00, 0x00, ...u32leBytes(dlyMs)],
  })
}

export function buildJpGo(addr: number, dlyMs = 1000): Uint8Array {
  return buildJpFrame({
    cmd: JP_CMD.GO,
    payload: [0x00, 0x00, 0x00, ...u32leBytes(addr), ...u32leBytes(dlyMs)],
  })
}

export function applyChecksumNone(frame: Uint8Array): Uint8Array {
  return new Uint8Array(frame)
}

export function parseJpHex(text: string, bodyLen = FRAME_LEN): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  return padToLength(bytes, bodyLen)
}

function hex2(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

function statusLabel(status: number): string {
  return status === 0 ? '成功' : `失败(0x${hex2(status)})`
}

function dfuCmdName(cmd: number): string {
  const map: Record<number, string> = {
    [JP_CMD.GET_INFO]: 'GET_INFO',
    [JP_CMD.ERASE]: 'ERASE',
    [JP_CMD.WRITE_BUFFER]: 'WRITE_BUFFER',
    [JP_CMD.PROGRAM_BUFFER]: 'PROGRAM_BUFFER',
    [JP_CMD.READ]: 'READ',
    [JP_CMD.RESET]: 'RESET',
    [JP_CMD.GO]: 'GO',
  }
  return map[cmd] ?? `CMD=0x${hex2(cmd)}`
}

function isHostCmd(cmd: number, type: number): boolean {
  if (cmd === 0x80 || cmd === 0x81 || cmd === 0x82 || cmd === 0x85 || cmd === 0x87 || cmd === 0x88) {
    return true
  }
  // 0x83：上位机 get_version=01；DFU RESET 首参为 00
  if (cmd === 0x83 && type === 0x01) return true
  return false
}

export function parseJpResponse(_cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'
  let off = 0
  const b0 = (data[0] ?? 0) & 0xff
  const hostOrDfu =
    b0 === 0x01 ||
    b0 === 0x5e ||
    b0 === 0x63 ||
    b0 === 0x65 ||
    b0 === 0x71 ||
    b0 === 0x83 ||
    b0 === 0x9b ||
    b0 === 0x80 ||
    b0 === 0x81 ||
    b0 === 0x82 ||
    b0 === 0x85 ||
    b0 === 0x87 ||
    b0 === 0x88
  if (data.length > 2 && !hostOrDfu) {
    const maybe = (data[1] ?? 0) & 0xff
    if (
      maybe === 0x01 ||
      maybe === 0x5e ||
      maybe === 0x63 ||
      maybe === 0x65 ||
      maybe === 0x71 ||
      maybe === 0x83 ||
      maybe === 0x9b ||
      maybe >= 0x80
    ) {
      off = 1
    }
  }

  const cmd = (data[off] ?? 0) & 0xff
  const typeOrStatus = (data[off + 1] ?? 0) & 0xff
  if (isHostCmd(cmd, typeOrStatus)) {
    const body = Array.from({ length: Math.max(0, data.length - off) }, (_, i) => (data[off + i] ?? 0) & 0xff)
    return parseHsResponse(cmd, body)
  }

  const status = typeOrStatus
  const head = `${dfuCmdName(cmd)} Status=${statusLabel(status)}`

  if (cmd === JP_CMD.GET_INFO) {
    const len = (data[off + 2] ?? 0) & 0xff
    const infoStart = off + 3
    if (len >= 13 && data.length >= infoStart + 13) {
      const bootVer = (data[infoStart] ?? 0) & 0xff
      const chipId = readU32le(data, infoStart + 1)
      const flashSize = readU32le(data, infoStart + 5)
      const sramSize = readU32le(data, infoStart + 9)
      return [
        head,
        `Len=${len}`,
        `BootVer=V${(bootVer / 10) | 0}.${bootVer % 10} (0x${hex2(bootVer)})`,
        `ChipID=0x${hex8(chipId)}`,
        `Flash=${flashSize}B`,
        `SRAM=${sramSize}B`,
      ].join(' ')
    }
    const info = Array.from({ length: Math.min(len, Math.max(0, data.length - infoStart)) }, (_, i) =>
      (data[infoStart + i] ?? 0) & 0xff,
    )
    return `${head} Len=${len} Info=${toHex(info)}`
  }

  if (cmd === JP_CMD.READ && status === 0) {
    const payload = Array.from(
      { length: Math.max(0, data.length - (off + 2)) },
      (_, i) => (data[off + 2 + i] ?? 0) & 0xff,
    )
    let end = payload.length
    while (end > 0 && payload[end - 1] === 0) end -= 1
    const shown = payload.slice(0, Math.max(end, Math.min(16, payload.length)))
    return `${head} Data(${payload.length}B)=${toHex(shown)}${end < payload.length ? ' …' : ''}`
  }

  return `${head} 原始=${toHex(
    Array.from({ length: Math.min(16, data.length - off) }, (_, i) => (data[off + i] ?? 0) & 0xff),
  )}`
}

const HOST_PRESETS: PresetCommand[] = [
  {
    id: 'host_get_version',
    label: '[上位机] 获取固件版本 (0x83)',
    cmd: JP_HOST_CMD.HW_INFO,
    build: () => buildJpHostFrame(JP_HOST_CMD.HW_INFO, 0x01),
  },
  {
    id: 'host_mono_main_status',
    label: '[上位机] 单色主灯 状态 (0x81)',
    cmd: JP_HOST_CMD.LIGHT_MONO_MAIN,
    build: () => buildJpHostFrame(JP_HOST_CMD.LIGHT_MONO_MAIN, 0x01),
  },
  {
    id: 'host_mono_main_enable',
    label: '[上位机] 单色主灯 开启 (0x81)',
    cmd: JP_HOST_CMD.LIGHT_MONO_MAIN,
    build: () => buildJpHostFrame(JP_HOST_CMD.LIGHT_MONO_MAIN, 0x02, [0x01]),
  },
  {
    id: 'host_mono_main_disable',
    label: '[上位机] 单色主灯 关闭 (0x81)',
    cmd: JP_HOST_CMD.LIGHT_MONO_MAIN,
    build: () => buildJpHostFrame(JP_HOST_CMD.LIGHT_MONO_MAIN, 0x02, [0x00]),
  },
  {
    id: 'host_rgb_main_status',
    label: '[上位机] RGB主灯 状态 (0x85)',
    cmd: JP_HOST_CMD.LIGHT_RGB_MAIN,
    build: () => buildJpHostFrame(JP_HOST_CMD.LIGHT_RGB_MAIN, 0x01),
  },
  {
    id: 'host_rgb_main_color',
    label: '[上位机] RGB主灯 颜色 HUE=0 SAT=255 (0x85)',
    cmd: JP_HOST_CMD.LIGHT_RGB_MAIN,
    build: () => buildJpHostFrame(JP_HOST_CMD.LIGHT_RGB_MAIN, 0x06, [0x00, 0xff]),
  },
  {
    id: 'host_mono_side_status',
    label: '[上位机] 单色侧灯 状态 (0x87)',
    cmd: JP_HOST_CMD.LIGHT_MONO_SIDE,
    build: () => buildJpHostFrame(JP_HOST_CMD.LIGHT_MONO_SIDE, 0x01),
  },
  {
    id: 'host_rgb_side_status',
    label: '[上位机] RGB侧灯 状态 (0x88)',
    cmd: JP_HOST_CMD.LIGHT_RGB_SIDE,
    build: () => buildJpHostFrame(JP_HOST_CMD.LIGHT_RGB_SIDE, 0x01),
  },
  {
    id: 'host_keymap_layers',
    label: '[上位机] 获取层数 (0x82)',
    cmd: JP_HOST_CMD.KEYMAP,
    build: () => buildJpHostFrame(JP_HOST_CMD.KEYMAP, 0x04),
  },
  {
    id: 'host_keymap_get_buffer',
    label: '[上位机] 读取按键矩阵 包0 (0x82)',
    cmd: JP_HOST_CMD.KEYMAP,
    build: () => buildJpGetBufferFrame(0, HS_READ_LEN_PER_PACKAGE),
  },
  {
    id: 'keymap_dump_all',
    label: '[上位机] 读取全盘按键矩阵（36包）',
    cmd: JP_HOST_CMD.KEYMAP,
    build: () => buildJpGetBufferFrame(0, HS_READ_LEN_PER_PACKAGE),
  },
  {
    id: 'host_keymap_reset',
    label: '[上位机] 重置按键矩阵 (0x82)',
    cmd: JP_HOST_CMD.KEYMAP,
    build: () => buildJpHostFrame(JP_HOST_CMD.KEYMAP, 0x02),
  },
  {
    id: 'host_keymap_set_key',
    label: '[上位机] 改键 L0 R0 C0 → 0x0004 (0x82)',
    cmd: JP_HOST_CMD.KEYMAP,
    build: () => buildJpHostFrame(JP_HOST_CMD.KEYMAP, 0x03, [0x00, 0x00, 0x00, 0x04, 0x00]),
  },
  {
    id: 'host_macro_size',
    label: '[上位机] 获取宏容量 (0x80)',
    cmd: JP_HOST_CMD.MACRO,
    build: () => buildJpHostFrame(JP_HOST_CMD.MACRO, 0x04),
  },
]

const DFU_PRESETS: PresetCommand[] = [
  {
    id: 'get_info_boot',
    label: '[DFU] 获取 Boot/芯片信息 Id=0 (0x01)',
    cmd: JP_CMD.GET_INFO,
    build: () => buildJpGetInfo(0x00),
  },
  {
    id: 'get_info_uid',
    label: '[DFU] 获取 MCU Unique ID Id=1 (0x01)',
    cmd: JP_CMD.GET_INFO,
    build: () => buildJpGetInfo(0x01),
  },
  {
    id: 'read_flash',
    label: '[DFU] 读取 Flash 0x08000000 len=16 (0x71)',
    cmd: JP_CMD.READ,
    build: () => buildJpRead(0x08000000, 16),
  },
  {
    id: 'erase_pages',
    label: '[DFU] 页擦除 0x08001000 ×2页 (0x5E)',
    cmd: JP_CMD.ERASE,
    build: () => buildJpErase(0x00, 0x08001000, 2),
  },
  {
    id: 'erase_chip',
    label: '[DFU] 整片擦除 (0x5E)',
    cmd: JP_CMD.ERASE,
    build: () => buildJpErase(0xf0),
  },
  {
    id: 'write_buffer_demo',
    label: '[DFU] 写 Buffer offset=0 数据4字节 (0x63)',
    cmd: JP_CMD.WRITE_BUFFER,
    build: () => buildJpWriteBuffer(0, [0x00, 0x01, 0x02, 0x03]),
  },
  {
    id: 'program_buffer',
    label: '[DFU] Program Buffer → 0x08001000 len=4 (0x65)',
    cmd: JP_CMD.PROGRAM_BUFFER,
    build: () => buildJpProgramBuffer(0x08001000, 4),
  },
  {
    id: 'reset_1s',
    label: '[DFU] 复位（延时1000ms，可不取回包）(0x83)',
    cmd: JP_CMD.RESET,
    build: () => buildJpReset(1000),
  },
  {
    id: 'go_app',
    label: '[DFU] 跳转 0x08000000（延时1000ms）(0x9B)',
    cmd: JP_CMD.GO,
    build: () => buildJpGo(0x08000000, 1000),
  },
]

export const jpProfile: ProtocolProfile = {
  id: 'jp',
  label: '巨朋 JP',
  vids: ['0603'],
  bodyLen: FRAME_LEN,
  reportId: 0,
  channel: 'auto',
  checksum: 'none',
  usagePageHint: 0xff00,
  timeoutMs: 400,
  presets: [...HOST_PRESETS, ...DFU_PRESETS],
  buildFrame: (cmd, params, data) => {
    // 上位机：params[0]=类型，其后为载荷；DFU：全部跟在 Cmd 后
    if (cmd >= 0x80 && cmd !== 0x9b) {
      const type = params?.[0] ?? 0
      const rest: number[] = []
      if (params && params.length > 1) {
        for (let i = 1; i < params.length; i++) rest.push(params[i] & 0xff)
      }
      if (data) {
        for (let i = 0; i < data.length; i++) rest.push(data[i] & 0xff)
      }
      return buildJpHostFrame(cmd, type, rest)
    }
    const rest: number[] = []
    if (params) {
      for (let i = 0; i < params.length; i++) rest.push(params[i] & 0xff)
    }
    if (data) {
      for (let i = 0; i < data.length; i++) rest.push(data[i] & 0xff)
    }
    return buildJpFrame({ cmd, payload: rest })
  },
  applyChecksum: applyChecksumNone,
  parseHex: parseJpHex,
  parseResponse: parseJpResponse,
}
