import type { HidChannel } from '../hid/types'

export type ChecksumMode = 'none' | 'ry_cs7'

export interface PresetCommand {
  id: string
  label: string
  /** Command byte used for response parsing. */
  cmd: number
  /** Optional builder; if omitted, profile.buildFrame(cmd) is used. */
  build?: () => Uint8Array
  params?: number[]
}

export interface ProtocolProfile {
  id: string
  label: string
  /** USB VID hex (e.g. `258A`); used to auto-select protocol for a device. */
  vids?: string[]
  bodyLen: number
  /** null = leave blank / auto in UI */
  reportId: number | null
  channel: HidChannel
  checksum: ChecksumMode
  usagePageHint?: number
  timeoutMs: number
  presets: PresetCommand[]
  buildFrame: (cmd: number, params?: number[], data?: ArrayLike<number>) => Uint8Array
  applyChecksum: (frame: Uint8Array) => Uint8Array
  parseHex: (text: string, bodyLen?: number) => Uint8Array
  parseResponse: (cmd: number, data: ArrayLike<number>) => string
}

export function toHex(bytes: ArrayLike<number>, sep = ' '): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    parts.push((bytes[i] & 0xff).toString(16).toUpperCase().padStart(2, '0'))
  }
  return parts.join(sep)
}

/** 字节转十进制空格分隔（星闪协议文档常用）。 */
export function toDec(bytes: ArrayLike<number>, sep = ' '): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    parts.push(String((bytes[i] ?? 0) & 0xff))
  }
  return parts.join(sep)
}

/** Strip UI suffix like `… (省略 511 个 00)` before parsing. */
export function stripTrailingZeroOmitNote(text: string): string {
  return text.replace(/\s*[…\.。]{1,3}\s*\(省略\s*\d+\s*个\s*0{1,2}\)\s*$/i, '').trim()
}

function omitTrailingZerosEnd(bytes: ArrayLike<number>, keepHead: number): { end: number; omitted: number } {
  const len = bytes.length
  let end = len
  while (end > keepHead && (bytes[end - 1] ?? 0) === 0) {
    end -= 1
  }
  return { end, omitted: len - end }
}

/**
 * Hex display that omits trailing 0x00 bytes.
 * The first `keepHead` bytes are always kept (default 8 = protocol header).
 */
export function toHexOmitTrailingZeros(
  bytes: ArrayLike<number>,
  options?: { keepHead?: number; sep?: string },
): string {
  const keepHead = options?.keepHead ?? 8
  const sep = options?.sep ?? ' '
  const len = bytes.length
  if (len === 0) return ''

  const { end, omitted } = omitTrailingZerosEnd(bytes, keepHead)
  const shown = toHex(
    Array.from({ length: end }, (_, i) => bytes[i] ?? 0),
    sep,
  )
  if (omitted <= 0) return shown
  return `${shown} … (省略 ${omitted} 个 00)`
}

/**
 * 十进制显示，规则同 toHexOmitTrailingZeros（省略末尾 0）。
 */
export function toDecOmitTrailingZeros(
  bytes: ArrayLike<number>,
  options?: { keepHead?: number; sep?: string },
): string {
  const keepHead = options?.keepHead ?? 8
  const sep = options?.sep ?? ' '
  const len = bytes.length
  if (len === 0) return ''

  const { end, omitted } = omitTrailingZerosEnd(bytes, keepHead)
  const shown = toDec(
    Array.from({ length: end }, (_, i) => bytes[i] ?? 0),
    sep,
  )
  if (omitted <= 0) return shown
  return `${shown} … (省略 ${omitted} 个 0)`
}

export function parseHexBytes(text: string): number[] {
  const cleaned = stripTrailingZeroOmitNote(text)
    .replace(/0x/gi, '')
    .replace(/[^0-9a-fA-F]/g, ' ')
    .trim()
  if (!cleaned) {
    throw new Error('请输入十六进制数据')
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean)
  const bytes: number[] = []
  for (const tok of tokens) {
    if (tok.length % 2 !== 0) {
      throw new Error(`无效十六进制: ${tok}`)
    }
    for (let i = 0; i < tok.length; i += 2) {
      const v = Number.parseInt(tok.slice(i, i + 2), 16)
      if (Number.isNaN(v)) {
        throw new Error(`无效十六进制: ${tok}`)
      }
      bytes.push(v)
    }
  }
  return bytes
}

export function padToLength(bytes: ArrayLike<number>, len: number): Uint8Array {
  const out = new Uint8Array(len)
  const n = Math.min(bytes.length, len)
  for (let i = 0; i < n; i++) out[i] = bytes[i] & 0xff
  return out
}

export function u16le(b: ArrayLike<number>, off: number): number {
  return ((b[off] ?? 0) | ((b[off + 1] ?? 0) << 8)) & 0xffff
}
