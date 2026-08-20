import {
  applyChecksumNone,
  BODY_LEN,
  buildBeiYingFrame,
  formatKeyMatrix,
} from './beiying'
import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex, u16le } from './types'

/**
 * RK 9007：1.25 主通道（0x09 / 519）与旧版小包（0x0A / 64）互补，预设合在同一协议。
 *
 * 1.25 帧（不含 Report ID）：
 *   [0]=CMD [1]=Param [2]=Reserved [3]=Packs [4]=Seq [5]=LenL [6]=LenH [7..]=payload
 * 0x0A 帧（不含 Report ID）：
 *   [0]=CMD [1]=当前包 [2]=总包数 [3]=长度或数据…
 */
export const RK9007_BODY_LEN = BODY_LEN
export const RK9007_OA_BODY_LEN = 64
export const RK9007_MATRIX_LEN = 504 // 21*6*4
export const RK9007_MACRO_LEN = 192
export const RK9007_CONFIG_LEN = 0x29 // 41
export const RK9007_LED_RGB_LEN = 375 // 125*3
export const RK9007_LED_RGB_GROUP_LEN = 0x7d // 125

export const RK9007_CMD = {
  SET_MATRIX: 0x01,
  GET_MATRIX: 0x81,
  SET_MACRO: 0x02,
  GET_MACRO: 0x82,
  SET_CONFIG: 0x03,
  GET_CONFIG: 0x83,
  SET_GAME_LED: 0x04,
  GET_GAME_LED: 0x84,
  FACTORY: 0x05,
  SET_LED_COLORS: 0x09,
  GET_LED_COLORS: 0x89,
  REALTIME_LIGHT: 0x10,
} as const

export const RK9007_OA_CMD = {
  LIGHT: 0x01,
  REALTIME: 0x03,
  KEYS: 0x09,
} as const

export interface Rk9007BuildOptions {
  cmd: number
  param?: number
  reserved?: number
  packs?: number
  seq?: number
  dataLen?: number
  payload?: ArrayLike<number>
}

export interface Rk9007OaBuildOptions {
  cmd: number
  seq?: number
  packs?: number
  dataLen?: number
  data?: ArrayLike<number>
}

/** 与贝盈同布局；Byte2 在 9007 为预留（文档固定 0）。 */
export function buildRk9007Frame(opts: Rk9007BuildOptions): Uint8Array {
  return buildBeiYingFrame({
    cmd: opts.cmd,
    param: opts.param,
    board: opts.reserved ?? 0,
    packs: opts.packs,
    seq: opts.seq,
    dataLen: opts.dataLen,
    payload: opts.payload,
  })
}

/** 旧版 0x0A：64 字节 body（不含 Report ID）。 */
export function buildRk9007OaFrame(opts: Rk9007OaBuildOptions): Uint8Array {
  const frame = new Uint8Array(RK9007_OA_BODY_LEN)
  const seq = (opts.seq ?? 1) & 0xff
  const packs = (opts.packs ?? 1) & 0xff
  frame[0] = opts.cmd & 0xff
  frame[1] = seq
  frame[2] = packs
  const data = opts.data
  const dataBytes = data ? Math.min(data.length, RK9007_OA_BODY_LEN - 4) : 0
  frame[3] = opts.dataLen != null ? opts.dataLen & 0xff : dataBytes
  if (data && dataBytes > 0) {
    for (let i = 0; i < dataBytes; i++) frame[4 + i] = data[i] & 0xff
  }
  return frame
}

function stripReportId(data: ArrayLike<number>): number {
  const b0 = data[0] ?? 0
  if ((b0 === 0x06 || b0 === 0x09 || b0 === 0x0a) && data.length > 8) {
    const maybeCmd = data[1] ?? 0
    if (maybeCmd !== 0x06 && maybeCmd !== 0x09 && maybeCmd !== 0x0a) return 1
  }
  return 0
}

function parseConfigPayload(payload: ArrayLike<number>, len: number): string[] {
  const b = (i: number) => (i < len ? (payload[i] ?? 0) & 0xff : 0)
  const lines = [
    `键模式=${b(0) === 1 ? 'Mac' : 'Win'}(${b(0)})`,
    `去抖=${b(1)}`,
    `灯光模式=${b(2)}`,
    `指点江山No=${b(3)}`,
    `速度=${b(4)} 亮度=${b(5)}`,
    `关灯模式=${b(6)} 方向键互换=${b(7)}`,
    `锁WIN=${b(8)} 锁全键=${b(9)} 小键盘/F区=${b(10)}`,
    `LOGO 模式=${b(11)} 速度=${b(12)} 亮度=${b(13)} 颜色=${b(14)}`,
    `wheel=${b(15)} 主色索引=${b(16)} RGB=${b(17)},${b(18)},${b(19)}`,
    `休眠=${b(20)}`,
  ]
  if (len >= 37) {
    lines.push(`密码=${toHex(Array.from({ length: 6 }, (_, i) => b(29 + i)))}`)
    lines.push(`版本=${b(35)}.${b(36)}`)
  }
  return lines
}

function parseOaResponse(data: ArrayLike<number>): string {
  let off = 0
  if ((data[0] ?? 0) === 0x0a && data.length > 4) off = 1
  const cmd = data[off] ?? 0
  const seq = data[off + 1] ?? 0
  const packs = data[off + 2] ?? 0
  const b3 = data[off + 3] ?? 0
  const preview = toHex(
    Array.from({ length: Math.min(16, Math.max(0, data.length - off)) }, (_, i) => data[off + i] ?? 0),
  )
  const lines = [
    `通道=0x0A/64`,
    `CMD=0x${cmd.toString(16).toUpperCase().padStart(2, '0')}`,
    `包=${seq}/${packs || '?'}`,
    `Byte3=0x${b3.toString(16).toUpperCase().padStart(2, '0')}`,
  ]
  if (cmd === RK9007_OA_CMD.LIGHT) {
    const speed = data[off + 6] ?? 0
    const bri = data[off + 7] ?? 0
    lines.push(`速度=${speed} 亮度=${bri}`)
  }
  lines.push(`预览: ${preview}`)
  return lines.join('\n')
}

export function parseRk9007Response(_cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'
  // 短包按旧版 0x0A 解析
  if (data.length <= RK9007_OA_BODY_LEN + 1) {
    const b0 = data[0] ?? 0
    if (b0 === 0x0a || data.length <= RK9007_OA_BODY_LEN) {
      const cmd = b0 === 0x0a ? (data[1] ?? 0) : b0
      if (cmd === RK9007_OA_CMD.LIGHT || cmd === RK9007_OA_CMD.REALTIME || cmd === RK9007_OA_CMD.KEYS) {
        return parseOaResponse(data)
      }
      if (data.length <= RK9007_OA_BODY_LEN && b0 !== 0x81 && b0 !== 0x83 && b0 !== 0x82) {
        return parseOaResponse(data)
      }
    }
  }

  const off = stripReportId(data)
  const cmd = data[off] ?? 0
  const param = data[off + 1] ?? 0
  const reserved = data[off + 2] ?? 0
  const packs = data[off + 3] ?? 0
  const seq = data[off + 4] ?? 0
  const len = u16le(data, off + 5)
  const payloadStart = off + 7
  const payloadEnd = Math.min(data.length, payloadStart + len)
  const head = [
    `通道=1.25/519`,
    `CMD=0x${cmd.toString(16).toUpperCase().padStart(2, '0')}`,
    `Param=0x${param.toString(16).toUpperCase().padStart(2, '0')}`,
    `Reserved=${reserved}`,
    `包=${seq + 1}/${packs || '?'}`,
    `负载长度=${len}`,
  ]

  const payloadLen = Math.max(0, payloadEnd - payloadStart)
  const payload = Array.from({ length: payloadLen }, (_, i) => data[payloadStart + i] ?? 0)

  if ((cmd & 0xff) === RK9007_CMD.GET_MATRIX && payloadLen > 0) {
    const layer = param === 1 ? 'Mac' : 'Win'
    return [...head, `表=${layer}`, formatKeyMatrix(payload, Math.min(payloadLen, RK9007_MATRIX_LEN))].join(
      '\n',
    )
  }
  if ((cmd & 0xff) === RK9007_CMD.GET_CONFIG && payloadLen > 0) {
    return [...head, ...parseConfigPayload(payload, payloadLen)].join('\n')
  }
  if ((cmd & 0xff) === RK9007_CMD.GET_MACRO && payloadLen > 0) {
    return [...head, `宏序号=${param}`, `预览: ${toHex(payload.slice(0, Math.min(24, payloadLen)))}`].join(
      '\n',
    )
  }
  if (
    ((cmd & 0xff) === RK9007_CMD.GET_LED_COLORS || (cmd & 0xff) === RK9007_CMD.GET_GAME_LED) &&
    payloadLen > 0
  ) {
    return [...head, `RGB预览: ${toHex(payload.slice(0, Math.min(24, payloadLen)))}`].join('\n')
  }
  if (len <= 0) return `${head.join('\n')}\n（无负载）`
  const previewLen = Math.min(32, payloadLen)
  return `${head.join('\n')}\n负载预览(${previewLen}/${len}): ${toHex(payload.slice(0, previewLen))}`
}

export function parseRk9007Hex(text: string, bodyLen = RK9007_BODY_LEN): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bodyLen > 0 && bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  if (bodyLen > 0) return padToLength(bytes, bodyLen)
  return Uint8Array.from(bytes)
}

/** 文档示例密码（驱动 1.2）：Byte29=0x01 Byte30=0x20 */
function defaultConfigPayload(): Uint8Array {
  const p = new Uint8Array(RK9007_CONFIG_LEN)
  p[0] = 0
  p[1] = 3
  p[4] = 2
  p[5] = 4
  p[16] = 1
  p[20] = 10
  p[29] = 0x01
  p[30] = 0x20
  return p
}

/**
 * S70 抓包灯效/亮度负载（dataLen=0x29）。
 * body[7]（payload[3]）为亮度；末字节 0x70。
 */
function sampleOaLightPayload(brightness = 5, speed = 5): Uint8Array {
  const p = new Uint8Array(0x29)
  p[0] = 0x02
  p[1] = 0x01
  p[2] = speed & 0xff
  p[3] = brightness & 0xff
  p[4] = 0xff
  p[7] = 0x01
  p[8] = 0x02
  return p
}

/** 旧版 0x0A 灯效/亮度第 1 包，对齐 S70 Feature SET_REPORT 抓包。 */
export function buildRk9007OaLightBrightnessFrame(brightness = 5, speed = 5): Uint8Array {
  const frame = buildRk9007OaFrame({
    cmd: RK9007_OA_CMD.LIGHT,
    seq: 1,
    packs: 2,
    dataLen: 0x29,
    data: sampleOaLightPayload(brightness, speed),
  })
  frame[frame.length - 1] = 0x70
  return frame
}

const OA_WIRE = { reportId: 0x0a, bodyLen: RK9007_OA_BODY_LEN } as const

const PRESETS: PresetCommand[] = [
  // —— 1.25 主通道（Report 0x09 / 519）——
  {
    id: 'read_matrix_win',
    label: '读按键矩阵 Win 层 (0x81)',
    cmd: RK9007_CMD.GET_MATRIX,
    build: () =>
      buildRk9007Frame({ cmd: RK9007_CMD.GET_MATRIX, param: 0, dataLen: RK9007_MATRIX_LEN }),
  },
  {
    id: 'read_matrix_mac',
    label: '读按键矩阵 Mac 层 (0x81)',
    cmd: RK9007_CMD.GET_MATRIX,
    build: () =>
      buildRk9007Frame({ cmd: RK9007_CMD.GET_MATRIX, param: 1, dataLen: RK9007_MATRIX_LEN }),
  },
  {
    id: 'read_macro_0',
    label: '读宏 序号0 (0x82)',
    cmd: RK9007_CMD.GET_MACRO,
    build: () =>
      buildRk9007Frame({ cmd: RK9007_CMD.GET_MACRO, param: 0, dataLen: RK9007_MACRO_LEN }),
  },
  {
    id: 'read_macro_1',
    label: '读宏 序号1 (0x82)',
    cmd: RK9007_CMD.GET_MACRO,
    build: () =>
      buildRk9007Frame({ cmd: RK9007_CMD.GET_MACRO, param: 1, dataLen: RK9007_MACRO_LEN }),
  },
  {
    id: 'read_macro_2',
    label: '读宏 序号2 (0x82)',
    cmd: RK9007_CMD.GET_MACRO,
    build: () =>
      buildRk9007Frame({ cmd: RK9007_CMD.GET_MACRO, param: 2, dataLen: RK9007_MACRO_LEN }),
  },
  {
    id: 'read_macro_3',
    label: '读宏 序号3 (0x82)',
    cmd: RK9007_CMD.GET_MACRO,
    build: () =>
      buildRk9007Frame({ cmd: RK9007_CMD.GET_MACRO, param: 3, dataLen: RK9007_MACRO_LEN }),
  },
  {
    id: 'read_config',
    label: '读配置 灯光/密码/版本 (0x83)',
    cmd: RK9007_CMD.GET_CONFIG,
    build: () =>
      buildRk9007Frame({ cmd: RK9007_CMD.GET_CONFIG, param: 0, dataLen: RK9007_CONFIG_LEN }),
  },
  {
    id: 'read_game_led_1',
    label: '读指点江山/游戏灯 组1 (0x84)',
    cmd: RK9007_CMD.GET_GAME_LED,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.GET_GAME_LED,
        param: 1,
        dataLen: RK9007_LED_RGB_GROUP_LEN,
      }),
  },
  {
    id: 'read_led_colors',
    label: '读自定义灯色 375B (0x89)',
    cmd: RK9007_CMD.GET_LED_COLORS,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.GET_LED_COLORS,
        param: 0,
        dataLen: RK9007_LED_RGB_LEN,
      }),
  },
  {
    id: 'write_matrix_win',
    label: '写按键矩阵 Win 空模板 504B (0x01)',
    cmd: RK9007_CMD.SET_MATRIX,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.SET_MATRIX,
        param: 0,
        dataLen: RK9007_MATRIX_LEN,
        payload: new Uint8Array(RK9007_MATRIX_LEN),
      }),
  },
  {
    id: 'write_macro_0',
    label: '写宏 序号0 空模板 192B (0x02)',
    cmd: RK9007_CMD.SET_MACRO,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.SET_MACRO,
        param: 0,
        dataLen: RK9007_MACRO_LEN,
        payload: new Uint8Array(RK9007_MACRO_LEN),
      }),
  },
  {
    id: 'write_config_default',
    label: '写配置 默认模板 (0x03) 含密码 01 20',
    cmd: RK9007_CMD.SET_CONFIG,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.SET_CONFIG,
        param: 0,
        dataLen: RK9007_CONFIG_LEN,
        payload: defaultConfigPayload(),
      }),
  },
  {
    id: 'write_game_led_1',
    label: '写指点江山 组1 空模板 375B (0x04)',
    cmd: RK9007_CMD.SET_GAME_LED,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.SET_GAME_LED,
        param: 1,
        dataLen: RK9007_LED_RGB_LEN,
        payload: new Uint8Array(RK9007_LED_RGB_LEN),
      }),
  },
  {
    id: 'write_led_colors',
    label: '写自定义灯色 空模板 375B (0x09)',
    cmd: RK9007_CMD.SET_LED_COLORS,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.SET_LED_COLORS,
        param: 0,
        dataLen: RK9007_LED_RGB_LEN,
        payload: new Uint8Array(RK9007_LED_RGB_LEN),
      }),
  },
  {
    id: 'realtime_light',
    label: '实时灯光 空模板 375B (0x10)',
    cmd: RK9007_CMD.REALTIME_LIGHT,
    build: () =>
      buildRk9007Frame({
        cmd: RK9007_CMD.REALTIME_LIGHT,
        param: 0,
        dataLen: RK9007_LED_RGB_LEN,
        payload: new Uint8Array(RK9007_LED_RGB_LEN),
      }),
  },
  {
    id: 'factory_reset',
    label: '整机复位 (0x05)',
    cmd: RK9007_CMD.FACTORY,
    build: () => buildRk9007Frame({ cmd: RK9007_CMD.FACTORY, param: 0, dataLen: 1 }),
  },
  // —— 旧版补充通道（Report 0x0A / 64）——
  {
    id: 'oa_set_brightness',
    label: '旧版0x0A 设置亮度=5 (0x01)',
    cmd: RK9007_OA_CMD.LIGHT,
    ...OA_WIRE,
    build: () => buildRk9007OaLightBrightnessFrame(5),
  },
  {
    id: 'oa_light_cfg_pkt1',
    label: '旧版0x0A 灯效/亮度 第1/2包 (0x01)',
    cmd: RK9007_OA_CMD.LIGHT,
    ...OA_WIRE,
    build: () => buildRk9007OaLightBrightnessFrame(5),
  },
  {
    id: 'oa_light_cfg_pkt2',
    label: '旧版0x0A 灯效配置 第2/2包 (0x01)',
    cmd: RK9007_OA_CMD.LIGHT,
    ...OA_WIRE,
    build: () =>
      buildRk9007OaFrame({
        cmd: RK9007_OA_CMD.LIGHT,
        seq: 2,
        packs: 2,
        dataLen: 0,
      }),
  },
  {
    id: 'oa_keys_pkt1',
    label: '旧版0x0A 键值矩阵 第1/9包 (0x09)',
    cmd: RK9007_OA_CMD.KEYS,
    ...OA_WIRE,
    build: () =>
      buildRk9007OaFrame({
        cmd: RK9007_OA_CMD.KEYS,
        seq: 1,
        packs: 9,
        dataLen: 0xf8,
        data: new Uint8Array(60),
      }),
  },
  {
    id: 'oa_keys_pkt2',
    label: '旧版0x0A 键值矩阵 第2/9包 (0x09)',
    cmd: RK9007_OA_CMD.KEYS,
    ...OA_WIRE,
    build: () =>
      buildRk9007OaFrame({
        cmd: RK9007_OA_CMD.KEYS,
        seq: 2,
        packs: 9,
        data: new Uint8Array(60),
      }),
  },
  {
    id: 'oa_realtime_pkt1',
    label: '旧版0x0A 实时灯效 第1包 (0x03)',
    cmd: RK9007_OA_CMD.REALTIME,
    ...OA_WIRE,
    build: () =>
      buildRk9007OaFrame({
        cmd: RK9007_OA_CMD.REALTIME,
        seq: 1,
        packs: 3,
        dataLen: 0x3c,
        data: new Uint8Array(60),
      }),
  },
]

export const rk9007Profile: ProtocolProfile = {
  id: 'rk9007',
  label: 'RK 9007 (S70)',
  bodyLen: RK9007_BODY_LEN,
  reportId: 0x09,
  channel: 'feature',
  checksum: 'none',
  usagePageHint: 0xff00,
  timeoutMs: 400,
  presets: PRESETS,
  buildFrame: (cmd, params, data) =>
    buildRk9007Frame({
      cmd,
      param: params?.[0],
      reserved: params?.[1],
      packs: params?.[2] ?? 1,
      seq: params?.[3] ?? 0,
      dataLen: params?.[4],
      payload: data,
    }),
  applyChecksum: applyChecksumNone,
  parseHex: parseRk9007Hex,
  parseResponse: parseRk9007Response,
}
