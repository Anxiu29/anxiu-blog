/** Shared RY-style 64-byte Feature frame + CS@7 (灯效 0x07/0x08 为 CS@8). */

import type { PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex, u16le } from './types'

export const FRAME_LEN = 64
export const CS_INDEX = 7
/** 主背光/侧灯：cmd+Effect+Speed+Bri+Option+R+G+B 共 8 字节后再跟 CS。 */
export const LED_CS_INDEX = 8

export function checksum(bytes: ArrayLike<number>, endExclusive = CS_INDEX): number {
  let sum = 0
  for (let i = 0; i < endExclusive; i++) {
    sum = (sum + (bytes[i] ?? 0)) & 0xff
  }
  return (0xff - sum) & 0xff
}

/** 灯效设置命令 CS 落在 Byte8。 */
export function usesLedChecksum(cmd: number): boolean {
  const c = cmd & 0xff
  return c === 0x07 || c === 0x08
}

export function applyChecksum(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(frame)
  const cmd = out[0] ?? 0
  if (usesLedChecksum(cmd)) {
    if (out.length < LED_CS_INDEX + 1) {
      throw new Error(`灯效帧长度至少 ${LED_CS_INDEX + 1} 字节`)
    }
    out[LED_CS_INDEX] = checksum(out, LED_CS_INDEX)
  } else {
    if (out.length < CS_INDEX + 1) {
      throw new Error(`帧长度至少 ${CS_INDEX + 1} 字节`)
    }
    out[CS_INDEX] = checksum(out, CS_INDEX)
  }
  return out
}

/**
 * 标准帧：Byte0=Cmd, Byte1..6=参数, Byte7=CS, Byte8..=数据。
 * 灯效 0x07/0x08 请用 buildLedParamFrame。
 */
export function buildFrame(cmd: number, params?: number[], data?: ArrayLike<number>): Uint8Array {
  const frame = new Uint8Array(FRAME_LEN)
  frame[0] = cmd & 0xff
  const p = params ?? []
  for (let i = 0; i < 6; i++) {
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

/** 主背光(0x07) / 侧灯(0x08)：Byte1..7=Effect..B，Byte8=CS。 */
export function buildLedParamFrame(
  cmd: 0x07 | 0x08,
  opts: {
    effect?: number
    speed?: number
    bri?: number
    option?: number
    r?: number
    g?: number
    b?: number
  } = {},
): Uint8Array {
  const frame = new Uint8Array(FRAME_LEN)
  frame[0] = cmd
  frame[1] = (opts.effect ?? 0) & 0xff
  frame[2] = (opts.speed ?? 2) & 0xff
  frame[3] = (opts.bri ?? 3) & 0xff
  frame[4] = (opts.option ?? 0) & 0xff
  frame[5] = (opts.r ?? 0xff) & 0xff
  frame[6] = (opts.g ?? 0xff) & 0xff
  frame[7] = (opts.b ?? 0xff) & 0xff
  return applyChecksum(frame)
}

/** 小端 u16 两字节，用于睡眠时间等。 */
export function le16(n: number): [number, number] {
  const v = n & 0xffff
  return [v & 0xff, (v >> 8) & 0xff]
}

/** 默认浅睡 2min、深睡 30min（协议 default）。 */
export function defaultSleepPayload(
  sleep1Bt = 2 * 60,
  sleep1G24 = 2 * 60,
  deepBt = 30 * 60,
  deepG24 = 30 * 60,
): number[] {
  return [...le16(sleep1Bt), ...le16(sleep1G24), ...le16(deepBt), ...le16(deepG24)]
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
const KB_SYSTEMS = ['WIN', 'MAC', 'IOS', 'ANR'] as const
const RT_STAB = ['0%', '25%', '50%', '75%', '100%'] as const

export { toHex }

/** Version bytes are stored L then H; display as raw hex H then L (no radix convert). */
function formatRyVersion(lo: number, hi: number): string {
  return toHex([hi & 0xff, lo & 0xff], '')
}

function formatLedParam(data: ArrayLike<number>, off = 0): string {
  return [
    `Effect=${data[off] ?? 0}`,
    `Speed=${data[off + 1] ?? 0}`,
    `Bri=${data[off + 2] ?? 0}`,
    `Option=${data[off + 3] ?? 0}`,
    `RGB=${toHex([data[off + 4] ?? 0, data[off + 5] ?? 0, data[off + 6] ?? 0], '')}`,
  ].join('\n')
}

function formatKbOption(data: ArrayLike<number>, off = 0): string {
  const sys = data[off] ?? 0
  const fn = data[off + 1] ?? 0
  const debounce = data[off + 2] ?? 0
  const rt = data[off + 3] ?? 0
  const wasd = data[off + 4] ?? 0
  return [
    `系统=${KB_SYSTEMS[sys] ?? `未知(${sys})`}`,
    `Fn层=${fn}`,
    `防抖开关=${debounce === 1 ? '开' : '关'}`,
    `RT Stab=${RT_STAB[rt] ?? `未知(${rt})`}`,
    `WASD↔方向键=${wasd === 1 ? '开' : '关'}`,
  ].join('\n')
}

function formatSleep(data: ArrayLike<number>, off = 8): string {
  return [
    `浅睡 BT=${u16le(data, off)}s`,
    `浅睡 2.4G=${u16le(data, off + 2)}s`,
    `深睡 BT=${u16le(data, off + 4)}s`,
    `深睡 2.4G=${u16le(data, off + 6)}s`,
  ].join('\n')
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
      return `主背光=${spot === '关' ? '关' : '开'}\n侧灯=${light === '关' ? '关' : '开'}`
    }
    case 0x86:
      return `去抖 Debounce=${data[1] ?? data[0] ?? 0}`
    case 0x87:
      return `主背光\n${formatLedParam(data, (data[0] ?? 0) === 0x87 ? 1 : 0)}`
    case 0x88:
      return `侧灯\n${formatLedParam(data, (data[0] ?? 0) === 0x88 ? 1 : 0)}`
    case 0x89:
      return formatKbOption(data, (data[0] ?? 0) === 0x89 ? 1 : 0)
    case 0x8a:
      return `键矩阵原始头: ${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0))}`
    case 0x8b:
      return `宏原始头: ${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0))}`
    case 0x91:
      return formatSleep(data, 8)
    case 0x9d: {
      const off = (data[0] ?? 0) === 0x9d ? 1 : 0
      const mode = data[off] ?? 0
      return `手柄模式=${mode === 1 ? '手柄' : '正常'} (${mode})`
    }
    case 0xd0:
      return `SKU 原始: ${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0))}`
    case 0xe5:
      return `磁轴行程原始头: ${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0))}`
    case 0xe6: {
      const off = (data[0] ?? 0) === 0xe6 ? 1 : 0
      const ok = data[off] ?? 0
      const prec = data[off + 1] ?? 0
      const pad = data[off + 2] ?? 0
      const precLabel = ['0.01mm', '0.005mm', '0.001mm'][prec] ?? `未知(${prec})`
      return [
        `有效标记=${ok === 0xaa ? '是 (0xAA)' : `否 (0x${ok.toString(16)})`}`,
        `精度=${precLabel}`,
        `手柄=${pad === 1 ? '支持' : '不支持'}`,
      ].join('\n')
    }
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
    case 0x87:
      return `主背光\n${formatLedParam(data, (data[0] ?? 0) === 0x87 ? 1 : 0)}`
    case 0x88:
      return `侧灯\n${formatLedParam(data, (data[0] ?? 0) === 0x88 ? 1 : 0)}`
    case 0x89:
      return formatKbOption(data, (data[0] ?? 0) === 0x89 ? 1 : 0)
    case 0x8a:
      return `键矩阵原始头: ${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0))}`
    case 0x8b:
      return `宏原始头: ${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0))}`
    case 0x91:
      // 与磁轴相同：时间在 Byte8..15（前面为头/CS）
      return formatSleep(data, 8)
    default:
      return `原始数据 ${data.length} 字节\n头: ${toHex(
        Array.from({ length: Math.min(16, data.length) }, (_, i) => data[i] ?? 0),
      )}`
  }
}

/** 两侧共用的读写预设（标准 CS@7 帧）。 */
export const RY_COMMON_PRESETS: PresetCommand[] = [
  // —— 读取 ——
  { id: 'device_info', label: '读取设备信息 (0x8F)', cmd: 0x8f },
  { id: 'battery', label: '读取电池状态 (0x82)', cmd: 0x82 },
  { id: 'report_rate', label: '读取回报率 (0x83)', cmd: 0x83 },
  { id: 'profile', label: '读取配置层 (0x84)', cmd: 0x84 },
  { id: 'led_onoff', label: '读取背光开关 (0x85)', cmd: 0x85 },
  { id: 'debounce', label: '读取消抖 (0x86)', cmd: 0x86 },
  { id: 'led_main', label: '读取主背光 (0x87)', cmd: 0x87 },
  { id: 'led_side', label: '读取侧灯 (0x88)', cmd: 0x88 },
  { id: 'kb_option', label: '读取键盘选项 (0x89)', cmd: 0x89 },
  {
    id: 'keymatrix_p0',
    label: '读取键矩阵 P0/Page0 (0x8A)',
    cmd: 0x8a,
    // Profile=0, Type=0xFF(整页), Page=0, Index/留空=0
    params: [0, 0xff, 0, 0],
  },
  {
    id: 'macro_0',
    label: '读取宏#0 Page0 (0x8B)',
    cmd: 0x8b,
    params: [0, 0],
  },
  { id: 'sleep', label: '读取睡眠时间 (0x91)', cmd: 0x91 },

  // —— 设置（带协议默认值，可在编辑区改）——
  { id: 'reset', label: '设备复位 (0x01)', cmd: 0x01 },
  {
    id: 'set_low_power',
    label: '设置低电阈值=30 (0x02)',
    cmd: 0x02,
    params: [30],
  },
  {
    id: 'set_report_1000',
    label: '设置回报率 1000Hz (0x03)',
    cmd: 0x03,
    // | 0x03 | 00 | Report | … |；磁轴 Report=3→1000Hz
    params: [0, 3],
  },
  {
    id: 'set_report_500',
    label: '设置回报率 500Hz (0x03)',
    cmd: 0x03,
    params: [0, 4],
  },
  {
    id: 'set_profile_0',
    label: '设置配置层 Profile=0 (0x04)',
    cmd: 0x04,
    params: [0],
  },
  {
    id: 'set_led_on',
    label: '设置背光全开 (0x05)',
    cmd: 0x05,
    // Byte1 主背光 0=开；Byte2 侧灯 0=开
    params: [0, 0],
  },
  {
    id: 'set_led_off',
    label: '设置背光全关 (0x05)',
    cmd: 0x05,
    params: [1, 1],
  },
  {
    id: 'set_debounce_0',
    label: '设置去抖=0 (0x06)',
    cmd: 0x06,
    params: [0],
  },
  {
    id: 'set_led_main',
    label: '设置主背光常亮白 (0x07)',
    cmd: 0x07,
    build: () =>
      buildLedParamFrame(0x07, {
        effect: 0,
        speed: 2,
        bri: 3,
        option: 0,
        r: 0xff,
        g: 0xff,
        b: 0xff,
      }),
  },
  {
    id: 'set_led_side',
    label: '设置侧灯常亮白 (0x08)',
    cmd: 0x08,
    build: () =>
      buildLedParamFrame(0x08, {
        effect: 0,
        speed: 2,
        bri: 3,
        option: 0,
        r: 0xff,
        g: 0xff,
        b: 0xff,
      }),
  },
  {
    id: 'set_kb_option_win',
    label: '设置键盘选项 WIN (0x09)',
    cmd: 0x09,
    // 系统WIN / Fn0 / 防抖关 / RT 25% / WASD关
    params: [0, 0, 0, 1, 0],
  },
  {
    id: 'set_sleep_default',
    label: '设置睡眠默认 2min/30min (0x11)',
    cmd: 0x11,
    build: () => buildFrame(0x11, [], defaultSleepPayload()),
  },
]
