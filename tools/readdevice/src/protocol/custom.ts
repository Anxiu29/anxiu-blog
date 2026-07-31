import type { ProtocolProfile } from './types'
import { padToLength, parseHexBytes, toHex } from './types'
import { applyChecksum as applyRyCs7, buildFrame as buildRyFrame } from './ryCommon'

function parseCustomHex(text: string, bodyLen = 64): Uint8Array {
  const bytes = parseHexBytes(text)
  if (bodyLen > 0 && bytes.length > bodyLen) {
    throw new Error(`最多 ${bodyLen} 字节，当前 ${bytes.length}`)
  }
  if (bodyLen > 0) return padToLength(bytes, bodyLen)
  return Uint8Array.from(bytes)
}

export const customProfile: ProtocolProfile = {
  id: 'custom',
  label: '自定义 Custom',
  bodyLen: 64,
  reportId: null,
  channel: 'auto',
  checksum: 'none',
  timeoutMs: 200,
  presets: [
    {
      id: 'empty64',
      label: '空白 64 字节',
      cmd: 0,
      build: () => new Uint8Array(64),
    },
    {
      id: 'ry_8f',
      label: '模板: RY 读设备信息',
      cmd: 0x8f,
      build: () => buildRyFrame(0x8f),
    },
  ],
  buildFrame: (cmd, params, data) => buildRyFrame(cmd, params, data),
  applyChecksum: (frame) => {
    // Optional: user can enable ry_cs7 in UI; profile default is none.
    return new Uint8Array(frame)
  },
  parseHex: parseCustomHex,
  parseResponse: (_cmd, data) =>
    `原始数据 ${data.length} 字节\n头: ${toHex(
      Array.from({ length: Math.min(24, data.length) }, (_, i) => data[i] ?? 0),
    )}`,
}

export function applyCustomChecksum(
  frame: Uint8Array,
  mode: 'none' | 'ry_cs7',
): Uint8Array {
  if (mode === 'ry_cs7') return applyRyCs7(frame)
  return new Uint8Array(frame)
}
