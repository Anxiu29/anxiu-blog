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
    // —— 磁轴专用读取 ——
    {
      id: 'axis_actuation',
      label: '读取触发行程 键0 (0xE5)',
      cmd: 0xe5,
      // Option=0 触发行程, Select=0 单键, Index=0
      params: [0, 0, 0],
    },
    {
      id: 'axis_release',
      label: '读取抬起行程 键0 (0xE5)',
      cmd: 0xe5,
      params: [1, 0, 0],
    },
    {
      id: 'axis_page0',
      label: '读取触发行程 整页0 (0xE5)',
      cmd: 0xe5,
      // Select=1 整体, Index=0 → 键1~28
      params: [0, 1, 0],
    },
    {
      id: 'feature_list',
      label: '读取功能列表 (0xE6)',
      cmd: 0xe6,
    },
    {
      id: 'gamepad_mode',
      label: '读取手柄模式 (0x9D)',
      cmd: 0x9d,
    },
    {
      id: 'sku',
      label: '读取 SKU (0xD0)',
      cmd: 0xd0,
    },
    // —— 磁轴专用设置 ——
    {
      id: 'set_gamepad_normal',
      label: '设置正常模式 (0x1D)',
      cmd: 0x1d,
      params: [0],
    },
    {
      id: 'set_gamepad_pad',
      label: '设置手柄模式 (0x1D)',
      cmd: 0x1d,
      params: [1],
    },
    {
      id: 'set_axis_actuation_30',
      label: '设置键0触发行程 0.30mm (0x65)',
      cmd: 0x65,
      // Option=0, Select=0, Index=0, FlashEnable=1；Byte8-9=30 (0.30mm)
      build: () => buildFrame(0x65, [0, 0, 0, 1], [30, 0]),
    },
  ],
  buildFrame,
  applyChecksum,
  parseHex,
  parseResponse: parseRy5088Response,
}
