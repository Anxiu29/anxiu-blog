import type { ProtocolProfile } from './types'
import {
  FRAME_LEN,
  RY_COMMON_PRESETS,
  applyChecksum,
  buildFrame,
  parseHex,
  parseRy5088Response,
} from './ryCommon'

export const ry5088Profile: ProtocolProfile = {
  id: 'ry5088',
  label: '容圆磁轴 RY5088',
  bodyLen: FRAME_LEN,
  reportId: 0,
  channel: 'auto',
  checksum: 'ry_cs7',
  usagePageHint: 0xffff,
  timeoutMs: 200,
  presets: [
    ...RY_COMMON_PRESETS,
    { id: 'sku', label: '读取 SKU (0xD0)', cmd: 0xd0 },
  ],
  buildFrame,
  applyChecksum,
  parseHex,
  parseResponse: parseRy5088Response,
}
