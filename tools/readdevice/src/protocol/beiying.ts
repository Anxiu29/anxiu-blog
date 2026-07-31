import type { ProtocolProfile, PresetCommand } from './types'
import { padToLength, parseHexBytes, toHex, u16le } from './types'

export const BODY_LEN = 519
export const MAX_PAYLOAD = BODY_LEN - 7 // 512

/** Default onboard index used by presets (协议板载 0~2；示例多用板载 1). */
const BOARD1 = 0x01

/**
 * Matrix Val:
 * bit0-1 layer: 0=Normal 1=FN1 2=FN2 3=Tap
 * bit2-4 system: 0=Win 1=Mac
 */
function matrixVal(layer: 0 | 1 | 2 | 3, mac: boolean): number {
  return (layer & 0x03) | ((mac ? 1 : 0) << 2)
}

export interface BeiYingBuildOptions {
  cmd: number
  param?: number
  board?: number
  packs?: number
  seq?: number
  /** Explicit data-length field (BYTE6..7). Defaults to payload byte count. */
  dataLen?: number
  payload?: ArrayLike<number>
}

/** Build BeiYing Feature body (519 bytes, no Report ID). */
export function buildBeiYingFrame(opts: BeiYingBuildOptions): Uint8Array {
  const frame = new Uint8Array(BODY_LEN)
  frame[0] = opts.cmd & 0xff
  frame[1] = (opts.param ?? 0) & 0xff
  frame[2] = (opts.board ?? 0) & 0xff
  frame[3] = (opts.packs ?? 1) & 0xff
  frame[4] = (opts.seq ?? 0) & 0xff
  const payload = opts.payload
  const payloadBytes = payload ? Math.min(payload.length, MAX_PAYLOAD) : 0
  const dataLen = Math.min(
    MAX_PAYLOAD,
    Math.max(0, opts.dataLen != null ? opts.dataLen : payloadBytes),
  )
  // Body layout without Report ID:
  //   [0]=CMD [1]=Param [2]=Board [3]=Packs [4]=Seq [5]=LenL [6]=LenH [7..]=payload
  frame[5] = dataLen & 0xff
  frame[6] = (dataLen >> 8) & 0xff
  if (payload && payloadBytes > 0) {
    for (let i = 0; i < payloadBytes; i++) {
      frame[7 + i] = payload[i] & 0xff
    }
  }
  return frame
}

export function applyChecksumNone(frame: Uint8Array): Uint8Array {
  return new Uint8Array(frame)
}

export function parseBeiYingHex(text: string, bodyLen = BODY_LEN): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  return padToLength(bytes, bodyLen)
}

function chargeLabel(status: number): string {
  const charging = (status >> 4) & 0x0f
  const full = status & 0x0f
  const parts: string[] = []
  parts.push(charging === 1 ? '充电中' : '未充电')
  parts.push(full === 1 ? '已充满' : '未充满')
  return parts.join(' / ')
}

const MATRIX_ROWS = 6
const MATRIX_COLS = 21
const MATRIX_KEYS = MATRIX_ROWS * MATRIX_COLS // 126
const MATRIX_BYTES = MATRIX_KEYS * 4 // 504

const LAYER_NAMES = ['Normal', 'FN1', 'FN2', 'Tap'] as const

function matrixParamLabel(param: number): string {
  const layer = param & 0x03
  const sys = (param >> 2) & 0x07
  const sysName = sys === 1 ? 'Mac' : sys === 0 ? 'Win' : `Sys${sys}`
  return `${sysName}/${LAYER_NAMES[layer] ?? layer}`
}

function keyBytesCompact(data: ArrayLike<number>, start: number, available: number): string {
  const parts: string[] = []
  for (let i = 0; i < 4; i++) {
    if (start + i < available) {
      parts.push((data[start + i] & 0xff).toString(16).toUpperCase().padStart(2, '0'))
    } else {
      parts.push('--')
    }
  }
  return parts.join('')
}

/**
 * 504-byte matrix → 6 rows × 21 cols, column-major (top→bottom, then next col).
 * Key index 0 = r1c1, index 6 = r1c2 (第七个按键).
 */
export function formatKeyMatrix(
  payload: ArrayLike<number>,
  payloadLen = payload.length,
): string {
  const available = Math.min(payloadLen, payload.length)
  const lines: string[] = [
    `按键矩阵 ${MATRIX_ROWS}行×${MATRIX_COLS}列（按列：上→下；第7键=第1行第2列）`,
  ]
  for (let row = 0; row < MATRIX_ROWS; row++) {
    const cells: string[] = []
    for (let col = 0; col < MATRIX_COLS; col++) {
      const keyIndex = col * MATRIX_ROWS + row
      const off = keyIndex * 4
      cells.push(keyBytesCompact(payload, off, available))
    }
    lines.push(cells.join(' '))
  }
  return lines.join('\n')
}

export function parseBeiYingResponse(_cmd: number, data: ArrayLike<number>): string {
  if (data.length === 0) return '（空响应）'
  // Some stacks return Report ID as first body byte; tolerate 0x06/0x09 prefix.
  let off = 0
  const b0 = data[0] ?? 0
  if ((b0 === 0x06 || b0 === 0x09) && data.length > 8) {
    const maybeCmd = data[1] ?? 0
    if (maybeCmd !== 0x06 && maybeCmd !== 0x09) {
      off = 1
    }
  }
  const cmd = data[off] ?? 0
  const param = data[off + 1] ?? 0
  const board = data[off + 2] ?? 0
  const packs = data[off + 3] ?? 0
  const seq = data[off + 4] ?? 0
  const len = u16le(data, off + 5)
  const payloadStart = off + 7
  const payloadEnd = Math.min(data.length, payloadStart + len)
  const head = [
    `CMD=0x${cmd.toString(16).toUpperCase().padStart(2, '0')}`,
    `Param=0x${param.toString(16).toUpperCase().padStart(2, '0')}`,
    `Board=${board}`,
    `包=${seq + 1}/${packs || '?'}`,
    `负载长度=${len}`,
  ]

  // Battery 0x87: 2 bytes
  if ((cmd & 0xff) === 0x87 && len >= 2) {
    const pct = data[payloadStart] ?? 0
    const st = data[payloadStart + 1] ?? 0
    return [...head, `电量=${pct}%`, `状态=${chargeLabel(st)}`].join('\n')
  }

  // Current profile board 0x90: 1 byte
  if ((cmd & 0xff) === 0x90 && len >= 1) {
    return [...head, `当前板载=${data[payloadStart] ?? 0}`].join('\n')
  }

  // Key matrix 0x83: 126 keys × 4 bytes, column-major 6×21
  if ((cmd & 0xff) === 0x83 && len > 0) {
    const payload = Array.from(
      { length: Math.min(len, payloadEnd - payloadStart) },
      (_, i) => data[payloadStart + i] ?? 0,
    )
    return [
      ...head,
      `表=${matrixParamLabel(param)}`,
      formatKeyMatrix(payload, Math.min(len, MATRIX_BYTES)),
    ].join('\n')
  }

  if (len <= 0) {
    return `${head.join('\n')}\n（无负载）`
  }
  const previewLen = Math.min(32, Math.max(0, payloadEnd - payloadStart))
  const preview = toHex(
    Array.from({ length: previewLen }, (_, i) => data[payloadStart + i] ?? 0),
  )
  return `${head.join('\n')}\n负载预览(${previewLen}/${len}): ${preview}`
}

/** Read presets aligned with BY USB examples (board=1 unless noted). */
const PRESETS: PresetCommand[] = [
  // —— 读取 ——
  {
    id: 'read_matrix_win_normal',
    label: '读按键矩阵 Win/Normal 板载1 (0x83)',
    cmd: 0x83,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x83,
        param: matrixVal(0, false),
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 504,
      }),
  },
  {
    id: 'read_matrix_mac_normal',
    label: '读按键矩阵 Mac/Normal 板载1 (0x83)',
    cmd: 0x83,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x83,
        param: matrixVal(0, true), // 0x04 — 文档示例
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 504,
      }),
  },
  {
    id: 'read_matrix_win_fn1',
    label: '读按键矩阵 Win/FN1 板载1 (0x83)',
    cmd: 0x83,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x83,
        param: matrixVal(1, false),
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 504,
      }),
  },
  {
    id: 'read_matrix_win_fn2',
    label: '读按键矩阵 Win/FN2 板载1 (0x83)',
    cmd: 0x83,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x83,
        param: matrixVal(2, false),
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 504,
      }),
  },
  {
    id: 'read_matrix_win_tap',
    label: '读按键矩阵 Win/Tap 板载1 (0x83)',
    cmd: 0x83,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x83,
        param: matrixVal(3, false),
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 504,
      }),
  },
  {
    id: 'read_profile',
    label: '读配置 profile 板载1 (0x84)',
    cmd: 0x84,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x84,
        param: 0x00,
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 128,
      }),
  },
  {
    id: 'read_macro_p0',
    label: '读宏数据 第1包/508B (0x85)',
    cmd: 0x85,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x85,
        param: 0x00,
        board: 0x00,
        packs: 1,
        seq: 0,
        dataLen: 508,
      }),
  },
  {
    id: 'read_light_custom',
    label: '读自定义灯效 板载1 (0x86)',
    cmd: 0x86,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x86,
        param: 0x00, // 灯效组 0
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 0x017a, // 378 = 126*3
      }),
  },
  {
    id: 'read_battery',
    label: '读电量与充电状态 (0x87)',
    cmd: 0x87,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x87,
        param: 0x00,
        board: 0x00,
        packs: 1,
        seq: 0,
        dataLen: 2,
      }),
  },
  {
    id: 'read_light_colors',
    label: '读灯效颜色表 板载1 (0x8A)',
    cmd: 0x8a,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x8a,
        param: 0x00,
        board: BOARD1,
        packs: 1,
        seq: 0,
        dataLen: 0x01e3, // 483
      }),
  },
  {
    id: 'read_board',
    label: '读当前板载 (0x90)',
    cmd: 0x90,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x90,
        param: 0x00,
        board: 0x00,
        packs: 1,
        seq: 0,
        dataLen: 1,
      }),
  },
  {
    id: 'read_user_data',
    label: '读用户自定义数据/序列号 (0xF1)',
    cmd: 0xf1,
    build: () =>
      buildBeiYingFrame({
        cmd: 0xf1,
        param: 0x00,
        board: 0x00,
        packs: 1,
        seq: 0,
        dataLen: 0x0100, // 256
      }),
  },
  {
    id: 'read_fw',
    label: '读 FW 版本 (0x80)',
    cmd: 0x80,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x80,
        param: 0x00,
        board: 0x00,
        packs: 1,
        seq: 0,
        dataLen: 8,
      }),
  },
  // —— 复位 / 切换（危险：仅短帧，不写大块配置）——
  {
    id: 'reset_all',
    label: '整机复位 (0x11 Val=0)',
    cmd: 0x11,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x11,
        packs: 1,
        seq: 0,
        dataLen: 1,
        payload: [0x00],
      }),
  },
  {
    id: 'reset_keys',
    label: '按键复位 (0x11 Val=1)',
    cmd: 0x11,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x11,
        packs: 1,
        seq: 0,
        dataLen: 1,
        payload: [0x01],
      }),
  },
  {
    id: 'reset_light',
    label: '灯光复位 (0x11 Val=2)',
    cmd: 0x11,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x11,
        packs: 1,
        seq: 0,
        dataLen: 1,
        payload: [0x02],
      }),
  },
  {
    id: 'set_board_0',
    label: '切换板载 0 (0x10)',
    cmd: 0x10,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x10,
        packs: 1,
        seq: 0,
        dataLen: 1,
        payload: [0x00],
      }),
  },
  {
    id: 'set_board_1',
    label: '切换板载 1 (0x10)',
    cmd: 0x10,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x10,
        packs: 1,
        seq: 0,
        dataLen: 1,
        payload: [0x01],
      }),
  },
  {
    id: 'set_board_2',
    label: '切换板载 2 (0x10)',
    cmd: 0x10,
    build: () =>
      buildBeiYingFrame({
        cmd: 0x10,
        packs: 1,
        seq: 0,
        dataLen: 1,
        payload: [0x02],
      }),
  },
  {
    id: 'channel_verify',
    label: '多设备通道验证 (0xAA)',
    cmd: 0xaa,
    build: () =>
      buildBeiYingFrame({
        cmd: 0xaa,
        packs: 1,
        seq: 0,
        dataLen: 1,
        payload: [0x05],
      }),
  },
]

export const beiyingProfile: ProtocolProfile = {
  id: 'beiying',
  label: '贝盈 BeiYing',
  vids: ['258A'],
  bodyLen: BODY_LEN,
  reportId: 0x09, // 文档示例多用 0x09；部分机型为 0x06，可在 UI 改
  channel: 'feature',
  checksum: 'none',
  usagePageHint: 0xff02,
  timeoutMs: 400,
  presets: PRESETS,
  buildFrame: (cmd, params, data) =>
    buildBeiYingFrame({
      cmd,
      param: params?.[0],
      board: params?.[1],
      packs: params?.[2] ?? 1,
      seq: params?.[3] ?? 0,
      dataLen: params?.[4],
      payload: data,
    }),
  applyChecksum: applyChecksumNone,
  parseHex: parseBeiYingHex,
  parseResponse: parseBeiYingResponse,
}
