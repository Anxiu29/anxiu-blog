import { beiyingProfile } from './beiying'
import { customProfile } from './custom'
import { hsProfile } from './hs'
import { jpProfile } from './jp'
import { kb250718Profile } from './kb250718'
import { ry5088Profile } from './ry5088'
import { sparklinkProfile } from './sparklink'
import type { ProtocolProfile } from './types'

export const PROTOCOL_PROFILES: ProtocolProfile[] = [
  ry5088Profile,
  kb250718Profile,
  beiyingProfile,
  hsProfile,
  jpProfile,
  sparklinkProfile,
  customProfile,
]

export function getProtocol(id: string): ProtocolProfile {
  const found = PROTOCOL_PROFILES.find((p) => p.id === id)
  if (!found) throw new Error(`未知协议: ${id}`)
  return found
}

export function listProtocols(): ProtocolProfile[] {
  return PROTOCOL_PROFILES
}

/** Resolve protocol by USB VID hex (case-insensitive). */
export function resolveProtocolByVid(vid: string | null | undefined): ProtocolProfile | undefined {
  const key = (vid ?? '').trim().toUpperCase().replace(/^0X/, '')
  if (!key) return undefined
  return PROTOCOL_PROFILES.find((p) =>
    (p.vids ?? []).some((v) => v.toUpperCase().replace(/^0X/, '') === key),
  )
}

export type { ProtocolProfile, PresetCommand, ChecksumMode } from './types'
export { toHex, toDec, toHexOmitTrailingZeros, toDecOmitTrailingZeros, stripTrailingZeroOmitNote, parseHexBytes } from './types'
