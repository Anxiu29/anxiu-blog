import type { HidChannel } from '../hid/types'

export type ChecksumMode = 'none' | 'ry_cs7' | 'tlw_cs'

export interface PresetCommand {
  id: string
  label: string
  /** Command byte used for response parsing. */
  cmd: number
  /** Optional builder; if omitted, profile.buildFrame(cmd) is used. */
  build?: () => Uint8Array
  params?: number[]
  /** Override profile reportId when this preset is selected / sent. */
  reportId?: number
  /** Override profile bodyLen when this preset is selected / sent. */
  bodyLen?: number
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

/** Display Report ID as `0x0A` so the editor field is obviously hex-editable. */
export function formatReportIdText(n: number): string {
  return `0x${(n & 0xff).toString(16).toUpperCase().padStart(2, '0')}`
}

/**
 * Preset reportId/bodyLen override wins.
 * Otherwise keep the current UI value if the user edited it (贝盈等默认 0x09 但仍可改 0x06).
 * Else use the protocol default.
 */
export function resolveWireField<T>(
  presetOverride: T | null | undefined,
  profileDefault: T,
  userDirty: boolean,
): { apply: true; value: T } | { apply: false } {
  if (presetOverride != null) return { apply: true, value: presetOverride }
  if (userDirty) return { apply: false }
  return { apply: true, value: profileDefault }
}

/**
 * Parse Report ID from the editor: `10`, `0x0A`, `0A` all mean 10.
 * Empty string → undefined (backend auto).
 */
export function parseReportIdText(text: string): number | undefined {
  const t = text.trim()
  if (t === '') return undefined
  const hexish = /^0x/i.test(t) || /[a-f]/i.test(t)
  const n = hexish
    ? Number.parseInt(t.replace(/^0x/i, ''), 16)
    : Number.parseInt(t, 10)
  if (Number.isNaN(n) || n < 0 || n > 255) {
    throw new Error('Report ID 须为 0–255（十进制或 0x 十六进制）')
  }
  return n
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

/** UI omit note, e.g. `… (省略 48 个 00)` or `… (省略 2 个 0)`. May appear mid-string before a tail checksum. */
const OMIT_NOTE_SRC =
  '(?:[…\u2026.。]{1,3}\\s*)?[\\(（]\\s*省略\\s*(\\d+)\\s*个\\s*0{1,2}\\s*[\\)）]'

function omitNoteRe(): RegExp {
  return new RegExp(OMIT_NOTE_SRC, 'gi')
}

/** Strip omit notes (does not re-insert zeros). Prefer expandOmittedZeroNotes when parsing. */
export function stripTrailingZeroOmitNote(text: string): string {
  return text.replace(omitNoteRe(), ' ').replace(/\s+/g, ' ').trim()
}

/** Turn `… (省略 N 个 00)` into N zero bytes so a trailing checksum stays at the correct offset. */
export function expandOmittedZeroNotes(text: string): string {
  return text.replace(omitNoteRe(), (_m, n) => {
    const count = Number.parseInt(n, 10)
    if (!Number.isFinite(count) || count <= 0) return ' '
    return ` ${Array.from({ length: count }, () => '00').join(' ')} `
  })
}

function sliceBytes(bytes: ArrayLike<number>, start: number, end: number): number[] {
  const n = Math.max(0, end - start)
  return Array.from({ length: n }, (_, i) => (bytes[start + i] ?? 0) & 0xff)
}

/**
 * Omit a run of 0x00 after keepHead.
 * If the last byte is non-zero (checksum), keep it as a suffix: `AA … (省略 N 个 00) 70`.
 */
function omitZeroRun(
  bytes: ArrayLike<number>,
  keepHead: number,
): { prefixLen: number; omitted: number; suffixStart: number } {
  const len = bytes.length
  if (len === 0) return { prefixLen: 0, omitted: 0, suffixStart: 0 }

  const last = (bytes[len - 1] ?? 0) & 0xff
  if (last === 0) {
    let end = len
    while (end > keepHead && ((bytes[end - 1] ?? 0) & 0xff) === 0) end -= 1
    return { prefixLen: end, omitted: len - end, suffixStart: len }
  }

  let suffixStart = len
  while (suffixStart > keepHead && ((bytes[suffixStart - 1] ?? 0) & 0xff) !== 0) {
    suffixStart -= 1
  }
  let zeroStart = suffixStart
  while (zeroStart > keepHead && ((bytes[zeroStart - 1] ?? 0) & 0xff) === 0) {
    zeroStart -= 1
  }
  const omitted = suffixStart - zeroStart
  if (omitted <= 0) return { prefixLen: len, omitted: 0, suffixStart: len }
  return { prefixLen: zeroStart, omitted, suffixStart }
}

/**
 * Hex display that omits interior/trailing 0x00 bytes.
 * The first `keepHead` bytes are always kept (default 8 = protocol header).
 * A non-zero last byte (checksum) is preserved after the omit note.
 */
export function toHexOmitTrailingZeros(
  bytes: ArrayLike<number>,
  options?: { keepHead?: number; sep?: string },
): string {
  const keepHead = options?.keepHead ?? 8
  const sep = options?.sep ?? ' '
  const len = bytes.length
  if (len === 0) return ''

  const { prefixLen, omitted, suffixStart } = omitZeroRun(bytes, keepHead)
  const prefix = toHex(sliceBytes(bytes, 0, prefixLen), sep)
  if (omitted <= 0) return prefix
  if (suffixStart >= len) return `${prefix} … (省略 ${omitted} 个 00)`
  const suffix = toHex(sliceBytes(bytes, suffixStart, len), sep)
  return `${prefix} … (省略 ${omitted} 个 00) ${suffix}`
}

/**
 * 十进制显示，规则同 toHexOmitTrailingZeros（省略中间/末尾 0）。
 */
export function toDecOmitTrailingZeros(
  bytes: ArrayLike<number>,
  options?: { keepHead?: number; sep?: string },
): string {
  const keepHead = options?.keepHead ?? 8
  const sep = options?.sep ?? ' '
  const len = bytes.length
  if (len === 0) return ''

  const { prefixLen, omitted, suffixStart } = omitZeroRun(bytes, keepHead)
  const prefix = toDec(sliceBytes(bytes, 0, prefixLen), sep)
  if (omitted <= 0) return prefix
  if (suffixStart >= len) return `${prefix} … (省略 ${omitted} 个 0)`
  const suffix = toDec(sliceBytes(bytes, suffixStart, len), sep)
  return `${prefix} … (省略 ${omitted} 个 0) ${suffix}`
}

export function parseHexBytes(text: string): number[] {
  const cleaned = expandOmittedZeroNotes(text)
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
