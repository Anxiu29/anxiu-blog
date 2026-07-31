/** Shared RY-style 64-byte Feature frame + CS@7. */

import { padToLength, parseHexBytes, toHex, u16le } from './types'

export const FRAME_LEN = 64
export const CS_INDEX = 7

export function checksum(bytes: ArrayLike<number>, endExclusive = CS_INDEX): number {
  let sum = 0
  for (let i = 0; i < endExclusive; i++) {
    sum = (sum + (bytes[i] ?? 0)) & 0xff
  }
  return (0xff - sum) & 0xff
}

export function applyChecksum(frame: Uint8Array): Uint8Array {
  if (frame.length < CS_INDEX + 1) {
    throw new Error(`帧长度至少 ${CS_INDEX + 1} 字节`)
  }
  const out = new Uint8Array(frame)
  out[CS_INDEX] = checksum(out, CS_INDEX)
  return out
}

export function buildFrame(cmd: number, params?: number[], data?: ArrayLike<number>): Uint8Array {
  const frame = new Uint8Array(FRAME_LEN)
  frame[0] = cmd & 0xff
  const p = params ?? []
  for (let i = 0; i < 4; i++) {
    frame[1 + i] = (p[i] ?? 0) & 0xff
  }
  if (data) {
    const n = Math.min(data.length, FRAME_LEN - 8)
    for (let i = 0; i < n; i++) {
      frame[8 + i] = data[i] & 0xff
    }
  }
  return applyChecksum(frame)
}

export function parseHex(text: string, bodyLen = FRAME_LEN): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  return padToLength(bytes, bodyLen)
}

const LINK_MODES = ['BT1', 'BT2', 'BT3', 'BT4', 'BT5', '2.4G', 'USB'] as const
const REPORT_RATES_HE = [8000, 4000, 2000, 1000, 500, 250, 125] as const
const REPORT_RATES_STD = [1000, 500, 250, 125] as const
const CHARGE_STATES = ['未充电', '充电中', '充满'] as const

export { toHex }

/** Version bytes are stored L then H; display as raw hex H then L (no radix convert). */
function formatRyVersion(lo: number, hi: number): string {
  return toHex([hi & 0xff, lo & 0xff], '')
}

/** Magnetic RY5088 GET_INFOR layout: Byte0=cmd echo, ID at 1..4. */
export function parseRy5088Response(cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'

  switch (cmd & 0xff) {
    case 0x8f: {
      const id = toHex([data[1], data[2], data[3], data[4]], '')
      const link = LINK_MODES[data[5] ?? 0xff] ?? `未知(${data[5]})`
      const kind = (data[6] ?? 0) === 1 ? '鼠标' : '键盘'
      const ver = formatRyVersion(data[7] ?? 0, data[8] ?? 0)
      const panRf = (data[9] ?? 0) === 1 ? '是' : '否'
      return [
        `Cmd=0x${(data[0] ?? 0).toString(16).toUpperCase()}`,
        `设备ID=${id}`,
        `连接=${link}`,
        `类型=${kind}`,
        `版本=${ver}`,
        `PAN_RF_BOOT=${panRf}`,
      ].join('\n')
    }
    case 0x82: {
      // Byte0 is cmd echo 0x82; payload starts at Byte1.
      const pct = data[1] ?? 0
      const state = CHARGE_STATES[data[2] ?? 0xff] ?? `未知(${data[2]})`
      const low = data[3] ?? 0
      return `电量=${pct}%\n状态=${state}\n低电阈值=${low}`
    }
    case 0x83: {
      const idx = data[2] ?? data[1] ?? 0
      const hz = REPORT_RATES_HE[idx] ?? null
      return hz != null ? `回报率索引=${idx} → ${hz} Hz` : `回报率索引=${idx}`
    }
    case 0x84:
      return `配置层 Profile=${data[1] ?? data[0] ?? 0}`
    case 0x85: {
      const spot = (data[1] ?? 0) === 1 ? '关' : '开'
      const light = (data[2] ?? 0) === 1 ? '关' : '开'
      return `灯光焦点=${spot}\n灯光=${light}`
    }
    case 0x86:
      return `去抖 Debounce=${data[1] ?? data[0] ?? 0}`
    case 0x91: {
      return [
        `浅睡 BT=${u16le(data, 8)}s`,
        `浅睡 2.4G=${u16le(data, 10)}s`,
        `深睡 BT=${u16le(data, 12)}s`,
        `深睡 2.4G=${u16le(data, 14)}s`,
      ].join('\n')
    }
    case 0xd0:
      return `SKU 原始: ${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0))}`
    default:
      return `原始数据 ${data.length} 字节`
  }
}

/** Keyboard 250718 GET_INFOR: no cmd echo, ID at Byte0..3. */
export function parseKb250718Response(cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'

  switch (cmd & 0xff) {
    case 0x8f: {
      const id = toHex([data[0], data[1], data[2], data[3]], '')
      const link = LINK_MODES[data[4] ?? 0xff] ?? `未知(${data[4]})`
      const kind = (data[5] ?? 0) === 1 ? '鼠标' : '键盘'
      const ver = formatRyVersion(data[6] ?? 0, data[7] ?? 0)
      return [
        `设备ID=${id}`,
        `连接=${link}`,
        `类型=${kind}`,
        `版本=${ver}`,
      ].join('\n')
    }
    case 0x82: {
      // Skip cmd echo 0x82 when present (same layout as RY5088).
      const off = (data[0] ?? 0) === 0x82 ? 1 : 0
      const pct = data[off] ?? 0
      const state = CHARGE_STATES[data[off + 1] ?? 0xff] ?? `未知(${data[off + 1]})`
      return `电量=${pct}%\n状态=${state}`
    }
    case 0x83: {
      // 250718 often uses Byte1 as index into 1/2/4/8 ms → 1000/500/250/125
      const idx = data[1] ?? data[0] ?? 0
      const hz = REPORT_RATES_STD[idx] ?? REPORT_RATES_HE[idx] ?? null
      return hz != null ? `回报率索引=${idx} → ${hz} Hz` : `回报率索引=${idx}`
    }
    case 0x84:
      return `配置层 Profile=${data[0] ?? data[1] ?? 0}`
    case 0x85: {
      return `LED On/Off 原始: ${toHex([data[0], data[1], data[2], data[3]])}`
    }
    case 0x86:
      return `去抖 Debounce=${data[0] ?? data[1] ?? 0}`
    case 0x91: {
      return [
        `浅睡 BT=${u16le(data, 0)}s`,
        `浅睡 2.4G=${u16le(data, 2)}s`,
        `深睡 BT=${u16le(data, 4)}s`,
        `深睡 2.4G=${u16le(data, 6)}s`,
      ].join('\n')
    }
    default:
      return `原始数据 ${data.length} 字节\n头: ${toHex(
        Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0),
      )}`
  }
}

export const RY_COMMON_PRESETS = [
  { id: 'device_info', label: '读取设备信息 (0x8F)', cmd: 0x8f },
  { id: 'battery', label: '读取电池状态 (0x82)', cmd: 0x82 },
  { id: 'report_rate', label: '读取回报率 (0x83)', cmd: 0x83 },
  { id: 'profile', label: '读取配置层 (0x84)', cmd: 0x84 },
  { id: 'light_focus', label: '读取灯光焦点 (0x85)', cmd: 0x85 },
  { id: 'debounce', label: '读取消抖 (0x86)', cmd: 0x86 },
  { id: 'sleep', label: '读取睡眠时间 (0x91)', cmd: 0x91 },
]
