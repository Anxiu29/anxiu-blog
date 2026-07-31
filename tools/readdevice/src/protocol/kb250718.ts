import type { ProtocolProfile } from './types'
import {
  FRAME_LEN,
  RY_COMMON_PRESETS,
  applyChecksum,
  buildFrame,
  parseHex,
  parseKb250718Response,
} from './ryCommon'

export const kb250718Profile: ProtocolProfile = {
  id: 'kb250718',
  label: '容圆键盘 250718',
  bodyLen: FRAME_LEN,
  reportId: 0,
  channel: 'auto',
  checksum: 'ry_cs7',
  usagePageHint: 0xffff,
  timeoutMs: 200,
  presets: [...RY_COMMON_PRESETS],
  buildFrame,
  applyChecksum,
  parseHex,
  parseResponse: parseKb250718Response,
}
