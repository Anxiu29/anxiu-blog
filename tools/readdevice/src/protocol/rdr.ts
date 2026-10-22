import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex, u16le } from './types'

/**
 * 睿鼎荣鼠标软件驱动协议 20260911 V1.0。
 *
 * 独立 USB 接口，没有 Report ID。64 字节全部是数据，首字节固定 0xAA：
 *   [0]=0xAA [1]=CMD [2]=ADDR_L [3]=ADDR_H [4]=LEN
 *   [5]=CRC_L [6]=CRC_H（保留，填 0）
 *   [7]=结果（发 0；回 0x55 成功 / 0x0F 失败）
 *   [8..63]=DATA，一包最多 56 字节
 *
 * 命令号采用文档「代码枚举」。摘要表在 0x21 之后与枚举冲突（0x24 出现两次），
 * 0x10–0x21 两边一致。空闲超过 5 秒下位机会结束会话，下次需先发 0x10。
 */
export const RDR_FRAME_LEN = 64
export const RDR_DATA_MAX = 56
export const RDR_HEAD = 0xaa
export const RDR_OK = 0x55
export const RDR_FAIL = 0x0f
export const RDR_INFO_MAGIC_L = 0xaa
export const RDR_INFO_MAGIC_H = 0xbb
export const RDR_INFO_BYTES = 64
export const RDR_FUNC_BYTES = 128
export const RDR_KEY_STRIDE = 3
export const RDR_KEY_MAX = 128
export const RDR_DPI_GROUPS = 8
export const RDR_DPI_STRIDE = 9
export const RDR_DPI_BASE = 30
export const RDR_VID = 0x36b0

export const RDR_CMD = {
  START: 0x10,
  STOP: 0x11,
  READ_INFO: 0x12,
  WRITE_INFO: 0x13,
  READ_FUNC: 0x14,
  WRITE_FUNC: 0x15,
  READ_DEFAULT_MATRIX1: 0x16,
  READ_DEFAULT_MATRIX2: 0x17,
  READ_DEFAULT_MATRIX3: 0x18,
  READ_DEFAULT_MATRIX4: 0x19,
  READ_MATRIX1: 0x1a,
  WRITE_MATRIX1: 0x1b,
  READ_MATRIX2: 0x1c,
  WRITE_MATRIX2: 0x1d,
  READ_MATRIX3: 0x1e,
  WRITE_MATRIX3: 0x1f,
  READ_MATRIX4: 0x20,
  WRITE_MATRIX4: 0x21,
  READ_DEFINE1_LED: 0x22,
  WRITE_DEFINE1_LED: 0x23,
  READ_DEFINE2_LED: 0x24,
  WRITE_DEFINE2_LED: 0x25,
  READ_DEFINE3_LED: 0x26,
  WRITE_DEFINE3_LED: 0x27,
  READ_DEFINE4_LED: 0x28,
  WRITE_DEFINE4_LED: 0x29,
  READ_DEFINE5_LED: 0x2a,
  WRITE_DEFINE5_LED: 0x2b,
  READ_MACRO: 0x2c,
  WRITE_MACRO: 0x2d,
  CONTROL_LED_START: 0x2e,
  CONTROL_LED_STOP: 0x2f,
  READ_BATT: 0x30,
  RESET: 0x31,
  READ_LED_MATRIX: 0x32,
  READ_BL_MODE: 0x33,
  READ_LED_DATA: 0x34,
  READ_LOGO_INDEX: 0x35,
  READ_LG_MODE: 0x36,
  READ_SIDE_INDEX: 0x37,
  READ_SD_MODE: 0x38,
  READ_LT_MODE: 0x39,
  READ_LT_DEFINE: 0x3a,
  WRITE_LT_DEFINE: 0x3b,
  CONTROL_LT_START: 0x3c,
  CONTROL_LT_STOP: 0x3d,
  READ_LT_GIF: 0x3e,
  WRITE_LT_GIF: 0x3f,
  READ_WHEEL: 0x40,
  RF24: 0xd0,
  LCD_USB_OPEN: 0xe0,
  LCD_USB_CLOSE: 0xe1,
  LCD_USB_STATUS: 0xe2,
  LCD_GIF_SYNC: 0xe3,
} as const

const CMD_NAME: Record<number, string> = {
  0x10: '开始通讯',
  0x11: '结束通讯',
  0x12: '读设备信息',
  0x13: '写设备信息',
  0x14: '读功能区',
  0x15: '写功能区',
  0x16: '读默认矩阵1',
  0x17: '读默认矩阵2',
  0x18: '读默认矩阵3',
  0x19: '读默认矩阵4',
  0x1a: '读矩阵1',
  0x1b: '写矩阵1',
  0x1c: '读矩阵2',
  0x1d: '写矩阵2',
  0x1e: '读矩阵3',
  0x1f: '写矩阵3',
  0x20: '读矩阵4',
  0x21: '写矩阵4',
  0x22: '读自定义灯1',
  0x23: '写自定义灯1',
  0x24: '读自定义灯2',
  0x25: '写自定义灯2',
  0x26: '读自定义灯3',
  0x27: '写自定义灯3',
  0x28: '读自定义灯4',
  0x29: '写自定义灯4',
  0x2a: '读自定义灯5',
  0x2b: '写自定义灯5',
  0x2c: '读宏',
  0x2d: '写宏',
  0x2e: '同步控制灯光',
  0x2f: '关闭同步灯光',
  0x30: '读电量',
  0x31: '复位',
  0x32: '读灯光矩阵',
  0x33: '读按键灯模式表',
  0x34: '读灯光 PWM',
  0x35: '读 LOGO 灯索引',
  0x36: '读 LOGO 灯模式表',
  0x37: '读侧灯索引',
  0x38: '读侧灯模式表',
  0x39: '读灯阵屏模式',
  0x3a: '读灯阵自定义',
  0x3b: '写灯阵自定义',
  0x3c: '同步灯阵',
  0x3d: '关闭灯阵同步',
  0x3e: '读灯阵 GIF',
  0x3f: '写灯阵 GIF',
  0x40: '读编码器位置',
  0xd0: '读 2.4G 状态',
  0xe0: '打开 LCD USB',
  0xe1: '关闭 LCD USB',
  0xe2: '查询 LCD USB',
  0xe3: '同步 LCD GIF 数量',
}

export interface RdrBuildOptions {
  cmd: number
  addr?: number
  len?: number
  data?: ArrayLike<number>
}

export interface RdrPacket {
  cmd: number
  addr: number
  len: number
  crc: number
  result: number
  data: Uint8Array
}

function u8(data: ArrayLike<number>, i: number): number {
  return (data[i] ?? 0) & 0xff
}

function hex2(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

export function rdrCmdName(cmd: number): string {
  return CMD_NAME[cmd & 0xff] ?? `CMD=0x${hex2(cmd)}`
}

export function buildRdrFrame(opts: RdrBuildOptions): Uint8Array {
  const frame = new Uint8Array(RDR_FRAME_LEN)
  frame[0] = RDR_HEAD
  frame[1] = opts.cmd & 0xff
  const addr = (opts.addr ?? 0) & 0xffff
  frame[2] = addr & 0xff
  frame[3] = (addr >> 8) & 0xff
  const src = opts.data
  const srcLen = src ? Math.min(src.length, RDR_DATA_MAX) : 0
  const requested = opts.len != null ? opts.len & 0xff : srcLen
  const len = Math.min(RDR_DATA_MAX, requested)
  frame[4] = len
  if (src && srcLen > 0) {
    const n = Math.min(srcLen, len > 0 ? len : srcLen)
    for (let i = 0; i < n; i++) frame[8 + i] = src[i] & 0xff
  }
  return frame
}

export function parseRdrPacket(data: ArrayLike<number>): RdrPacket {
  let off = 0
  if (u8(data, 0) !== RDR_HEAD && u8(data, 1) === RDR_HEAD) off = 1
  if (data.length < off + 8 || u8(data, off) !== RDR_HEAD) {
    throw new Error(`RDR 回包头不是 0xAA（${data.length} 字节）`)
  }
  const len = u8(data, off + 4)
  const take = Math.min(RDR_DATA_MAX, len, Math.max(0, data.length - (off + 8)))
  const payload = new Uint8Array(take)
  for (let i = 0; i < take; i++) payload[i] = u8(data, off + 8 + i)
  return {
    cmd: u8(data, off + 1),
    addr: u16le(data, off + 2),
    len,
    crc: u16le(data, off + 5),
    result: u8(data, off + 7),
    data: payload,
  }
}

export function rdrResultLabel(result: number): string {
  if (result === RDR_OK) return '成功'
  if (result === RDR_FAIL) return '失败 0x0F（未发 0x10，或空闲已超过 5 秒）'
  return `结果=0x${hex2(result)}`
}

export function extractRdrData(report: ArrayLike<number>, expectCmd?: number): Uint8Array {
  const pkt = parseRdrPacket(report)
  if (expectCmd != null && pkt.cmd !== (expectCmd & 0xff)) {
    throw new Error(`回包 CMD=0x${hex2(pkt.cmd)}，期望 0x${hex2(expectCmd)}`)
  }
  if (pkt.result === RDR_FAIL) {
    throw new Error(`设备拒绝 ${rdrCmdName(pkt.cmd)}：${rdrResultLabel(pkt.result)}`)
  }
  if (pkt.result !== RDR_OK) {
    throw new Error(`${rdrCmdName(pkt.cmd)} ${rdrResultLabel(pkt.result)}，期望 0x55`)
  }
  return pkt.data
}

export function rdrExpectPrefix(frame: ArrayLike<number>): number[] | undefined {
  if (u8(frame, 0) !== RDR_HEAD) return undefined
  const cmd = u8(frame, 1)
  if (cmd === 0) return undefined
  return [RDR_HEAD, cmd]
}

export function rdrExpectPrefixes(frame: ArrayLike<number>): number[][] | undefined {
  const prefix = rdrExpectPrefix(frame)
  return prefix ? [prefix] : undefined
}

export interface RdrDeviceInfo {
  valid: boolean
  role: 'mouse' | 'receiver' | 'short'
  vendorId: number
  productId: number
  firmware: number
  protocolVersion: number
  profileCount: number
  deviceId: number
  deviceType: number
  keyCount: number
  macroUnits: number
  macroBytes: number
  hasKeyLight: boolean
  keyLightModes: number
  keyLightMaxBrightness: number
  keyLightMaxSpeed: number
  customLightCount: number
  hasLogoLight: boolean
  logoLightModes: number
  logoLightCount: number
  logoMaxBrightness: number
  logoMaxSpeed: number
  logoMusic: boolean
  sensor: number
  reportRateGears: number
  dpiGearMax: number
}

export function parseRdrDeviceInfo(data: ArrayLike<number>): RdrDeviceInfo {
  const keyCount = u8(data, 12)
  const macroUnits = u8(data, 13)
  const sensor = u8(data, 25)
  let role: RdrDeviceInfo['role'] = 'mouse'
  if (data.length < 28) role = 'short'
  else if (keyCount === 0 && macroUnits === 0 && sensor === 0) role = 'receiver'
  return {
    valid: u8(data, 0) === RDR_INFO_MAGIC_L && u8(data, 1) === RDR_INFO_MAGIC_H,
    role,
    vendorId: u16le(data, 2),
    productId: u16le(data, 4),
    firmware: u16le(data, 6),
    protocolVersion: u8(data, 8),
    profileCount: u8(data, 9),
    deviceId: u8(data, 10),
    deviceType: u8(data, 11),
    keyCount,
    macroUnits,
    macroBytes: macroUnits * 256,
    hasKeyLight: u8(data, 14) !== 0,
    keyLightModes: u8(data, 15),
    keyLightMaxBrightness: u8(data, 16),
    keyLightMaxSpeed: u8(data, 17),
    customLightCount: u8(data, 18),
    hasLogoLight: u8(data, 19) !== 0,
    logoLightModes: u8(data, 20),
    logoLightCount: u8(data, 21),
    logoMaxBrightness: u8(data, 22),
    logoMaxSpeed: u8(data, 23),
    logoMusic: u8(data, 24) !== 0,
    sensor,
    reportRateGears: u8(data, 26),
    dpiGearMax: u8(data, 27),
  }
}

function mouseTypeName(t: number): string {
  if (t === 0) return '普通1K三模'
  if (t === 1) return '双8K三模'
  return `未知(${t})`
}

function sensorName(id: number): string {
  if (id === 0x10) return 'PAW3311'
  if (id === 0) return '无'
  return `未知 0x${hex2(id)}`
}

export function formatRdrDeviceInfo(info: RdrDeviceInfo): string {
  const head = [
    `标志=${info.valid ? 'AA BB 有效' : '无效'}`,
    `USB VID:PID=${hex4(info.vendorId)}:${hex4(info.productId)}`,
    `固件=0x${hex4(info.firmware)} 协议=V${info.protocolVersion.toString().padStart(2, '0')}`,
  ]
  if (info.role === 'receiver') {
    return [...head, '设备=接收器（索引 9 之后为预留）'].join('\n')
  }
  if (info.role === 'short') {
    return [...head, '数据不足 28 字节，鼠标字段未解析'].join('\n')
  }
  return [
    ...head,
    `情景模式数=${info.profileCount} 设备ID=${info.deviceId} 类型=${mouseTypeName(info.deviceType)}`,
    `按键=${info.keyCount}（${info.keyCount * RDR_KEY_STRIDE}B） 宏空间=${info.macroBytes}B（${info.macroUnits}×256）`,
    `按键灯=${info.hasKeyLight ? '有' : '无'} 模式数=${info.keyLightModes} 最大亮度=${info.keyLightMaxBrightness} 最大速度=${info.keyLightMaxSpeed} 自定义组=${info.customLightCount}`,
    `LOGO灯=${info.hasLogoLight ? '有' : '无'} 模式数=${info.logoLightModes} 灯数=${info.logoLightCount} 最大亮度=${info.logoMaxBrightness} 最大速度=${info.logoMaxSpeed} 音乐律动=${info.logoMusic ? '支持' : '不支持'}`,
    `Sensor=${sensorName(info.sensor)} 回报率档位数=${info.reportRateGears} DPI档位上限=${info.dpiGearMax}（实际看各组 EN）`,
  ].join('\n')
}

function reportRateName(code: number): string {
  const names = ['1000 Hz', '500 Hz', '250 Hz', '125 Hz']
  return names[code] ?? `未知(${code})`
}

function lightSwitchName(v: number): string {
  if (v === 0) return '打开'
  if (v === 1) return '关闭'
  return `未知(${v})`
}

function u24le(data: ArrayLike<number>, off: number): number {
  return (u8(data, off) | (u8(data, off + 1) << 8) | (u8(data, off + 2) << 16)) >>> 0
}

export function formatRdrFunctions(data: ArrayLike<number>, base = 0): string {
  const end = base + data.length
  const has = (index: number, len = 1) => index >= base && index + len <= end
  const at = (index: number) => u8(data, index - base)
  const lines: string[] = []
  if (has(0)) lines.push(`当前情景=${at(0)}`)
  if (has(1, 10)) {
    lines.push(
      `按键灯 ${lightSwitchName(at(1))} 模式=${at(2)} 亮度=${at(3)} 速度=${at(4)} ${at(5) === 1 ? '彩色' : '单色'} 颜色索引=${at(6)} RGB=${at(7)},${at(8)},${at(9)} 自定义组=${at(10)}`,
    )
  }
  if (has(11, 2)) lines.push(`回报率=${reportRateName(at(11))} 当前DPI档=${at(12)}（0 为第 1 组）`)
  if (has(13, 2)) lines.push(`静默高度=${at(13)} 按键延迟=${at(14)}（0–3，越大越慢）`)
  if (has(15, 3)) lines.push(`一级休眠=${u24le(data, 15 - base)}s`)
  if (has(18, 3)) lines.push(`二级休眠=${u24le(data, 18 - base)}s`)
  for (let i = 0; i < RDR_DPI_GROUPS; i++) {
    const o = RDR_DPI_BASE + i * RDR_DPI_STRIDE
    if (!has(o, RDR_DPI_STRIDE)) continue
    lines.push(
      `  DPI${i + 1} ${at(o) ? '使能' : '关闭'} XY分开=${at(o + 1) ? '是' : '否'} X=${u16le(data, o + 2 - base)} Y=${u16le(data, o + 4 - base)} RGB=${at(o + 6)},${at(o + 7)},${at(o + 8)}`,
    )
  }
  if (lines.length === 0) lines.push('本包没有落在功能区字段上')
  return lines.join('\n')
}

const KEY_NAME: Record<number, string> = {
  0x04: 'A',
  0x05: 'B',
  0x06: 'C',
  0x07: 'D',
  0x08: 'E',
  0x09: 'F',
  0x0a: 'G',
  0x0b: 'H',
  0x0c: 'I',
  0x0d: 'J',
  0x0e: 'K',
  0x0f: 'L',
  0x10: 'M',
  0x11: 'N',
  0x12: 'O',
  0x13: 'P',
  0x14: 'Q',
  0x15: 'R',
  0x16: 'S',
  0x17: 'T',
  0x18: 'U',
  0x19: 'V',
  0x1a: 'W',
  0x1b: 'X',
  0x1c: 'Y',
  0x1d: 'Z',
  0x1e: '1',
  0x1f: '2',
  0x20: '3',
  0x21: '4',
  0x22: '5',
  0x23: '6',
  0x24: '7',
  0x25: '8',
  0x26: '9',
  0x27: '0',
  0x28: 'Enter',
  0x29: 'Esc',
  0x2a: 'Backspace',
  0x2b: 'Tab',
  0x2c: 'Space',
  0x2d: '-',
  0x2e: '=',
  0x2f: '[',
  0x30: ']',
  0x31: '\\',
  0x32: 'K42',
  0x33: ';',
  0x34: "'",
  0x35: '`',
  0x36: ',',
  0x37: '.',
  0x38: '/',
  0x39: 'CapsLock',
  0x3a: 'F1',
  0x3b: 'F2',
  0x3c: 'F3',
  0x3d: 'F4',
  0x3e: 'F5',
  0x3f: 'F6',
  0x40: 'F7',
  0x41: 'F8',
  0x42: 'F9',
  0x43: 'F10',
  0x44: 'F11',
  0x45: 'F12',
  0x46: 'PrintScreen',
  0x47: 'ScrollLock',
  0x48: 'Pause',
  0x49: 'Insert',
  0x4a: 'Home',
  0x4b: 'PageUp',
  0x4c: 'Delete',
  0x4d: 'End',
  0x4e: 'PageDown',
  0x4f: 'Right',
  0x50: 'Left',
  0x51: 'Down',
  0x52: 'Up',
  0x53: 'NumLock',
  0x54: 'Num/',
  0x55: 'Num*',
  0x56: 'Num-',
  0x57: 'Num+',
  0x58: 'NumEnter',
  0x59: 'Num1',
  0x5a: 'Num2',
  0x5b: 'Num3',
  0x5c: 'Num4',
  0x5d: 'Num5',
  0x5e: 'Num6',
  0x5f: 'Num7',
  0x60: 'Num8',
  0x61: 'Num9',
  0x62: 'Num0',
  0x63: 'Num.',
  0x64: 'K45',
  0x65: 'App',
  0x68: 'F13',
  0x69: 'F14',
  0x6a: 'F15',
  0x6b: 'F16',
  0x6c: 'F17',
  0x6d: 'F18',
  0x6e: 'F19',
  0x6f: 'F20',
  0x70: 'F21',
  0x71: 'F22',
  0x72: 'F23',
  0x73: 'F24',
  0x87: 'K56',
  0x88: 'K133',
  0x89: 'K14',
  0x8a: 'K132',
  0x8b: 'K131',
  0x90: 'K151',
  0x91: 'K150',
}

function keyName(code: number): string {
  return KEY_NAME[code] ?? `KEY 0x${hex2(code)}`
}

function modifierName(mask: number): string {
  const names: Array<[number, string]> = [
    [0x01, 'LCtrl'],
    [0x02, 'LShift'],
    [0x04, 'LAlt'],
    [0x08, 'LWin'],
    [0x10, 'RCtrl'],
    [0x20, 'RShift'],
    [0x40, 'RAlt'],
    [0x80, 'RWin'],
  ]
  const hit = names.filter(([bit]) => mask & bit).map(([, name]) => name)
  return hit.length ? hit.join('+') : ''
}

/** 宏定义名是 HID 位：0x01 左、0x02 右、0x04 中。文档注释把右键和中键写反了。 */
function mouseButtonName(mask: number): string {
  const names: Array<[number, string]> = [
    [0x01, '左键'],
    [0x02, '右键'],
    [0x04, '中键'],
    [0x08, '后退'],
    [0x10, '前进'],
  ]
  const hit = names.filter(([bit]) => mask & bit).map(([, name]) => name)
  return hit.length ? hit.join('+') : `按键 0x${hex2(mask)}`
}

const MOUSE_MOVE = ['按键', '左移', '右移', '上移', '下移', '滚轮上', '滚轮下', '滚轮左', '滚轮右']

const FUNC_NAME = [
  '',
  '按下切到矩阵0，松开还原',
  '开关按键灯',
  '灯光模式+',
  '灯光模式-',
  '灯光颜色+',
  '灯光颜色-',
  '灯光亮度+',
  '灯光亮度-',
  '灯光速度+',
  '灯光速度-',
  '自定义灯光1',
  '复位',
  '蓝牙1',
  '蓝牙2',
  '蓝牙3',
  '2.4G',
  'USB',
  '电量状态',
  '按键延迟',
  '短按切 CPI，长按 3 秒切回报率',
  '短按进网页驱动，长按 3 秒配对',
]

const CONSUMER: Record<number, string> = {
  0x00e2: '静音',
  0x00e9: '音量+',
  0x00ea: '音量-',
  0x00b5: '下一首',
  0x00b6: '上一首',
  0x00b7: '停止',
  0x00cd: '播放/暂停',
  0x0183: '媒体播放器',
  0x00cc: '弹出',
  0x018a: '邮件',
  0x0192: '计算器',
  0x0194: '我的电脑',
  0x0221: '浏览器搜索',
  0x0223: '浏览器主页',
  0x0224: '浏览器后退',
  0x0225: '浏览器前进',
  0x0226: '浏览器停止',
  0x0227: '浏览器刷新',
  0x022a: '浏览器收藏',
  0x00b3: '快进',
  0x00b4: '快退',
  0x006f: '屏幕亮度+',
  0x0070: '屏幕亮度-',
  0x019f: '控制面板',
  0x01cb: '助手',
  0x029f: '调度中心',
  0x02a0: '文件管理',
}

const MACRO_PLAY = ['播一次', '按住播放，松开停止', '松手后循环，按下停止', '按一下开始，再按一下停止']

function formatKeyTriple(t: number, c1: number, c2: number): string {
  if (t === 0 && c1 === 0 && c2 === 0) return '空'
  if (t === 0x10 || t === 0x11 || t === 0x12) {
    const mods = t === 0x12 ? '' : modifierName(c1)
    const key = keyName(c2)
    const body = mods ? `${mods}+${key}` : key
    return `键盘 ${body}`
  }
  if (t === 0x20) {
    if (c1 === 0x81) return '系统 关机'
    if (c1 === 0x82) return '系统 睡眠'
    return `系统 0x${hex2(c1)}`
  }
  if (t === 0x30) {
    const code = c1 | (c2 << 8)
    return `多媒体 ${CONSUMER[code] ?? `0x${hex4(code)}`}`
  }
  if (t === 0x40) {
    const move = MOUSE_MOVE[c1] ?? `类型${c1}`
    if (c1 === 0) return `鼠标 ${mouseButtonName(c2)}`
    return `鼠标 ${move} 数据=${c2}`
  }
  if (t === 0x50) return `功能 ${FUNC_NAME[c1] ?? `0x${hex2(c1)}`}`
  if (t === 0x60) return `宏#${c1} ${MACRO_PLAY[c2] ?? `类型${c2}`}`
  if (t === 0x61) return `宏#${c1} 重复 ${c2} 次`
  if (t === 0x70) return `火力键 间隔原始=${c1}（单位 2ms，0 表示 2ms） 次数=${c2}`
  if (t === 0x80) return `连发 间隔原始=${c1}（单位 2ms，0 表示 2ms） 键=${keyName(c2)}`
  return `0x${hex2(t)} ${hex2(c1)} ${hex2(c2)}`
}

export function formatRdrKeys(data: ArrayLike<number>, keyCount?: number, baseAddr = 0): string {
  if (baseAddr % RDR_KEY_STRIDE !== 0) {
    return `地址 ${baseAddr} 没有按 3 字节对齐\n${toHex(data)}`
  }
  const maxByBuf = Math.floor(data.length / RDR_KEY_STRIDE)
  const n = keyCount != null && keyCount >= 0 ? Math.min(keyCount, maxByBuf) : maxByBuf
  const start = baseAddr / RDR_KEY_STRIDE
  const lines: string[] = []
  let empty = 0
  for (let i = 0; i < n; i++) {
    const t = u8(data, i * 3)
    const c1 = u8(data, i * 3 + 1)
    const c2 = u8(data, i * 3 + 2)
    if (t === 0 && c1 === 0 && c2 === 0) {
      empty += 1
      continue
    }
    lines.push(
      `  键${String(start + i).padStart(2, ' ')}  ${hex2(t)} ${hex2(c1)} ${hex2(c2)}  ${formatKeyTriple(t, c1, c2)}`,
    )
  }
  if (lines.length === 0) return '（全部为空）'
  if (empty > 0) lines.push(`  其余 ${empty} 个空键已省略`)
  return lines.join('\n')
}

const MACRO_ACTION = [
  '',
  '键盘普通键',
  '键盘热键',
  '鼠标按键',
  '鼠标X',
  '鼠标Y',
  '鼠标左右摆',
  '鼠标滚轮',
]

function formatMacroActionType(typeByte: number): string {
  const kind = typeByte & 0x7f
  const flag = (typeByte & 0x80) !== 0
  const name = MACRO_ACTION[kind] ?? `类型0x${hex2(kind)}`
  return `${name} ${flag ? '按下/左/上' : '弹起/右/下'}`
}

/** 宏头：AA 55、总长度、组数，以及从偏移 8 开始的各组地址。动作按 4 字节解析。 */
export function formatRdrMacro(data: ArrayLike<number>): string {
  if (data.length < 8) return `宏数据 ${data.length} 字节\n${toHex(data)}`
  const valid = u8(data, 0) === 0xaa && u8(data, 1) === 0x55
  const length = u16le(data, 2)
  const count = u16le(data, 4)
  const lines = [
    `标志=${valid ? 'AA 55 有效' : '无效'} 总长度=${length}（含宏头） 宏组数=${count}`,
  ]
  const slots = Math.min(count, Math.floor(Math.max(0, data.length - 8) / 2), 32)
  for (let i = 0; i < slots; i++) {
    const addr = u16le(data, 8 + i * 2)
    lines.push(`  宏${i} 偏移=${addr}`)
    if (i > 0 || addr + 8 > data.length || addr < 8) continue
    const actions = u16le(data, addr)
    const shown = Math.min(actions, 8, Math.floor((data.length - (addr + 4)) / 4))
    lines.push(`    动作数=${actions}`)
    for (let a = 0; a < shown; a++) {
      const p = addr + 4 + a * 4
      const delay = u16le(data, p)
      const key = u8(data, p + 2)
      const typeByte = u8(data, p + 3)
      lines.push(`    #${a} 延时=${delay} 键值=0x${hex2(key)} ${formatMacroActionType(typeByte)}`)
    }
  }
  return lines.join('\n')
}

/** 非 0xFF 的最大索引 + 1 就是灯数量。0xFF 表示该键没有灯。 */
export function formatRdrLedIndex(data: ArrayLike<number>): string {
  let max = -1
  let mapped = 0
  for (let i = 0; i < data.length; i++) {
    const v = u8(data, i)
    if (v === 0xff) continue
    mapped += 1
    if (v > max) max = v
  }
  const count = max >= 0 ? max + 1 : 0
  return `灯数量=${count}（非 0xFF 最大索引 + 1） 已映射=${mapped}`
}

function formatModeList(data: ArrayLike<number>): string {
  if (data.length === 0) return '（空）'
  return Array.from(data, (b) => `0x${hex2(b)}`).join(' ')
}

function formatRaw(label: string, data: ArrayLike<number>): string {
  if (data.length === 0) return `${label}（无数据）`
  return `${label} ${toHex(data)}`
}

function isMatrixCmd(cmd: number): boolean {
  return (
    (cmd >= RDR_CMD.READ_DEFAULT_MATRIX1 && cmd <= RDR_CMD.READ_DEFAULT_MATRIX4) ||
    cmd === RDR_CMD.READ_MATRIX1 ||
    cmd === RDR_CMD.WRITE_MATRIX1 ||
    cmd === RDR_CMD.READ_MATRIX2 ||
    cmd === RDR_CMD.WRITE_MATRIX2 ||
    cmd === RDR_CMD.READ_MATRIX3 ||
    cmd === RDR_CMD.WRITE_MATRIX3 ||
    cmd === RDR_CMD.READ_MATRIX4 ||
    cmd === RDR_CMD.WRITE_MATRIX4
  )
}

export function parseRdrResponse(_cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'
  let pkt: RdrPacket
  try {
    pkt = parseRdrPacket(data)
  } catch (e) {
    return `原始 ${data.length} 字节\n${toHex(Array.from({ length: Math.min(16, data.length) }, (_, i) => u8(data, i)))}\n${String(e)}`
  }
  const lines = [
    `${rdrCmdName(pkt.cmd)} ${rdrResultLabel(pkt.result)}`,
    `ADDR=${pkt.addr} LEN=${pkt.len} CRC=0x${hex4(pkt.crc)}`,
  ]
  const cmd = pkt.cmd
  if (cmd === RDR_CMD.READ_INFO || cmd === RDR_CMD.WRITE_INFO) {
    if (pkt.addr === 0) lines.push(formatRdrDeviceInfo(parseRdrDeviceInfo(pkt.data)))
    else lines.push(`设备信息片段\n${toHex(pkt.data)}`)
  } else if (cmd === RDR_CMD.READ_FUNC || cmd === RDR_CMD.WRITE_FUNC) {
    lines.push(formatRdrFunctions(pkt.data, pkt.addr))
  } else if (isMatrixCmd(cmd)) {
    lines.push(formatRdrKeys(pkt.data, undefined, pkt.addr))
  } else if (cmd === RDR_CMD.READ_MACRO || cmd === RDR_CMD.WRITE_MACRO) {
    lines.push(pkt.addr === 0 ? formatRdrMacro(pkt.data) : formatRaw('宏片段', pkt.data))
  } else if (cmd === RDR_CMD.READ_LED_MATRIX || cmd === RDR_CMD.READ_LOGO_INDEX || cmd === RDR_CMD.READ_SIDE_INDEX) {
    lines.push(formatRdrLedIndex(pkt.data))
  } else if (cmd === RDR_CMD.READ_BL_MODE || cmd === RDR_CMD.READ_LG_MODE || cmd === RDR_CMD.READ_SD_MODE || cmd === RDR_CMD.READ_LT_MODE) {
    lines.push(`模式值 ${formatModeList(pkt.data)}`)
  } else if (cmd === RDR_CMD.READ_BATT) {
    lines.push(formatRaw('电量原始（协议未定义字节含义）', pkt.data))
  } else if (cmd === RDR_CMD.RF24) {
    lines.push(formatRaw('2.4G 原始（协议未定义字节含义）', pkt.data))
  } else if (cmd === RDR_CMD.START) {
    lines.push('通讯已开始')
  } else if (cmd === RDR_CMD.STOP) {
    lines.push('通讯已结束')
  } else if (cmd === RDR_CMD.RESET) {
    lines.push('已复位')
  } else if (pkt.data.length > 0) {
    lines.push(formatRaw('DATA', pkt.data.slice(0, Math.min(24, pkt.data.length))))
  }
  return lines.join('\n')
}

export function parseRdrHex(text: string, bodyLen = RDR_FRAME_LEN): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bodyLen > 0 && bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  if (bodyLen > 0) return padToLength(bytes, bodyLen)
  return Uint8Array.from(bytes)
}

export function applyRdrChecksum(frame: Uint8Array): Uint8Array {
  return new Uint8Array(frame)
}

export interface RdrDumpProgress {
  step: string
  index: number
  total: number
}

export interface RdrDumpOptions {
  gapMs?: number
  onProgress?: (p: RdrDumpProgress) => void
}

function packetCount(totalBytes: number): number {
  if (totalBytes <= 0) return 0
  return Math.ceil(totalBytes / RDR_DATA_MAX)
}

/**
 * 先 0x10，再按 56 字节分包读取设备信息、功能区、矩阵 1、宏头。
 * 电量、2.4G、宏头失败不会丢掉已经读到的内容。结束时发 0x11。
 */
export async function dumpRdrSnapshot(
  exchange: (frame: Uint8Array, expectPrefix?: number[]) => Promise<Uint8Array>,
  options?: RdrDumpOptions,
): Promise<{ text: string }> {
  const gapMs = options?.gapMs ?? 20
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let step = 0
  let total =
    2 +
    packetCount(RDR_INFO_BYTES) +
    packetCount(RDR_FUNC_BYTES) +
    packetCount(RDR_KEY_MAX * RDR_KEY_STRIDE) * 2 +
    3

  const send = async (frame: Uint8Array, label: string) => {
    options?.onProgress?.({ step: label, index: step, total })
    step += 1
    const rx = await exchange(frame, rdrExpectPrefix(frame))
    if (gapMs > 0) await sleep(gapMs)
    return rx
  }

  const readRange = async (cmd: number, totalBytes: number, label: string) => {
    const out = new Uint8Array(totalBytes)
    for (let addr = 0; addr < totalBytes; addr += RDR_DATA_MAX) {
      const len = Math.min(RDR_DATA_MAX, totalBytes - addr)
      const rx = await send(buildRdrFrame({ cmd, addr, len }), `${label} ADDR=${addr}`)
      const part = extractRdrData(rx, cmd)
      out.set(part.subarray(0, Math.min(len, part.length)), addr)
    }
    return out
  }

  const readOptional = async (cmd: number, len: number, label: string) => {
    try {
      const rx = await send(buildRdrFrame({ cmd, len }), label)
      return extractRdrData(rx, cmd)
    } catch (e) {
      return String(e)
    }
  }

  const startRx = await send(buildRdrFrame({ cmd: RDR_CMD.START, len: 0 }), '开始通讯')
  extractRdrData(startRx, RDR_CMD.START)
  try {
    const infoRaw = await readRange(RDR_CMD.READ_INFO, RDR_INFO_BYTES, '设备信息')
    const info = parseRdrDeviceInfo(infoRaw)
    const functions = await readRange(RDR_CMD.READ_FUNC, RDR_FUNC_BYTES, '功能区')
    const keyCount =
      info.role === 'mouse' && info.keyCount > 0 ? Math.min(RDR_KEY_MAX, info.keyCount) : 0
    const keyBytes = keyCount * RDR_KEY_STRIDE
    total =
      2 +
      packetCount(RDR_INFO_BYTES) +
      packetCount(RDR_FUNC_BYTES) +
      packetCount(keyBytes) * 2 +
      3
    const defKeys =
      keyBytes > 0
        ? await readRange(RDR_CMD.READ_DEFAULT_MATRIX1, keyBytes, '默认矩阵1')
        : null
    const keys =
      keyBytes > 0 ? await readRange(RDR_CMD.READ_MATRIX1, keyBytes, '当前矩阵1') : null
    const macro = await readOptional(RDR_CMD.READ_MACRO, RDR_DATA_MAX, '宏头')
    const battery = await readOptional(RDR_CMD.READ_BATT, 8, '电量')
    const rf24 = await readOptional(RDR_CMD.RF24, 8, '2.4G')

    const sections = [
      '睿鼎荣设备快照（V1.0，56 字节分包）',
      '',
      '—— 设备信息 ——',
      formatRdrDeviceInfo(info),
      '',
      '—— 功能区 ——',
      formatRdrFunctions(functions),
      '',
      '—— 默认按键矩阵1 ——',
      defKeys ? formatRdrKeys(defKeys, keyCount) : '设备信息没有按键矩阵',
      '',
      '—— 当前按键矩阵1 ——',
      keys ? formatRdrKeys(keys, keyCount) : '设备信息没有按键矩阵',
      '',
      '—— 宏 ——',
      macro instanceof Uint8Array ? formatRdrMacro(macro) : `读取失败：${macro}`,
      '',
      '—— 电量 ——',
      battery instanceof Uint8Array
        ? formatRaw('原始（协议未定义字节含义）', battery)
        : `读取失败：${battery}`,
      '',
      '—— 2.4G ——',
      rf24 instanceof Uint8Array ? formatRaw('原始（协议未定义字节含义）', rf24) : `读取失败：${rf24}`,
    ]
    if (info.profileCount > 1) {
      sections.push('', `情景模式共 ${info.profileCount} 个，本次只读矩阵 1。`)
    }
    return { text: sections.join('\n') }
  } finally {
    try {
      const stopRx = await send(buildRdrFrame({ cmd: RDR_CMD.STOP, len: 0 }), '结束通讯')
      extractRdrData(stopRx, RDR_CMD.STOP)
    } catch {
      /* 会话可能已经超时结束 */
    }
  }
}

function readPreset(
  id: string,
  label: string,
  cmd: number,
  addr = 0,
  len = RDR_DATA_MAX,
): PresetCommand {
  return {
    id,
    label,
    cmd,
    build: () => buildRdrFrame({ cmd, addr, len }),
  }
}

const PRESETS: PresetCommand[] = [
  {
    id: 'rdr_dump_all',
    label: '读取设备快照（多包）',
    cmd: RDR_CMD.READ_INFO,
    build: () => buildRdrFrame({ cmd: RDR_CMD.READ_INFO, len: RDR_DATA_MAX }),
  },
  readPreset('start', '开始通讯 (0x10)', RDR_CMD.START, 0, 0),
  readPreset('stop', '结束通讯 (0x11)', RDR_CMD.STOP, 0, 0),
  readPreset('info_0', '读设备信息 ADDR=0 (0x12)', RDR_CMD.READ_INFO, 0, 56),
  readPreset('info_56', '读设备信息 ADDR=56 (0x12)', RDR_CMD.READ_INFO, 56, 8),
  readPreset('func_0', '读功能区 ADDR=0 (0x14)', RDR_CMD.READ_FUNC, 0, 56),
  readPreset('func_56', '读功能区 ADDR=56 (0x14)', RDR_CMD.READ_FUNC, 56, 56),
  readPreset('func_112', '读功能区 ADDR=112 (0x14)', RDR_CMD.READ_FUNC, 112, 16),
  readPreset('defmatrix1_0', '读默认矩阵1 ADDR=0 (0x16)', RDR_CMD.READ_DEFAULT_MATRIX1),
  readPreset('matrix1_0', '读当前矩阵1 ADDR=0 (0x1A)', RDR_CMD.READ_MATRIX1),
  readPreset('macro_0', '读宏 ADDR=0 (0x2C)', RDR_CMD.READ_MACRO),
  readPreset('battery', '读电量 (0x30)', RDR_CMD.READ_BATT, 0, 8),
  readPreset('rf24', '读 2.4G 状态 (0xD0)', RDR_CMD.RF24, 0, 8),
  readPreset('led_matrix_0', '读灯光矩阵 ADDR=0 (0x32)', RDR_CMD.READ_LED_MATRIX),
  readPreset('bl_mode', '读按键灯模式表 (0x33)', RDR_CMD.READ_BL_MODE),
  readPreset('logo_index', '读 LOGO 灯索引 (0x35)', RDR_CMD.READ_LOGO_INDEX),
  readPreset('wheel', '读编码器位置 (0x40)', RDR_CMD.READ_WHEEL),
  readPreset('reset', '复位 (0x31)', RDR_CMD.RESET, 0, 0),
]

export const rdrProfile: ProtocolProfile = {
  id: 'rdr',
  label: '睿鼎荣 RDR',
  vids: ['36B0'],
  bodyLen: RDR_FRAME_LEN,
  reportId: 0,
  channel: 'output',
  checksum: 'none',
  timeoutMs: 800,
  presets: PRESETS,
  buildFrame: (cmd, params, data) =>
    buildRdrFrame({
      cmd,
      addr: params ? (params[0] ?? 0) | ((params[1] ?? 0) << 8) : 0,
      len: params?.[2],
      data,
    }),
  applyChecksum: applyRdrChecksum,
  parseHex: parseRdrHex,
  parseResponse: parseRdrResponse,
}
