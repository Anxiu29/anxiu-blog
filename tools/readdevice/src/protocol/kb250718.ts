import type { ProtocolProfile } from './types'
import {
  FRAME_LEN,
  RY_COMMON_PRESETS,
  applyChecksum,
  buildFrame,
  defaultSleepPayload,
  parseHex,
  parseKb250718Response,
} from './ryCommon'

/** 键盘回报率/睡眠与磁轴填包略有差异，替换共用里的对应项。 */
const KB_REPLACE_IDS = new Set(['set_report', 'set_sleep_default', 'set_profile_0'])

export const kb250718Profile: ProtocolProfile = {
  id: 'kb250718',
  label: '容圆键盘 250718',
  bodyLen: FRAME_LEN,
  reportId: 0,
  channel: 'auto',
  checksum: 'ry_cs7',
  usagePageHint: 0xffff,
  timeoutMs: 200,
  presets: [
    ...RY_COMMON_PRESETS.filter((p) => !KB_REPLACE_IDS.has(p.id)),
    {
      id: 'set_report',
      label: '设置1K回报率 (0x03) 改第3字节：0=1K/1=500/2=250/3=125',
      cmd: 0x03,
      // 键盘：第3字节（Byte2）索引 0/1/2/3 → 1/2/4/8ms → 1000/500/250/125；默认 0=1000Hz
      params: [0, 0],
    },
    {
      id: 'set_profile_0',
      label: '设置配置层 Profile=0 (0~7) (0x04)',
      cmd: 0x04,
      params: [0],
    },
    {
      id: 'set_sleep_default',
      label: '设置睡眠默认 2min/30min (0x11)',
      cmd: 0x11,
      // Byte1=BT 有效位、Byte2=2.4G 有效位（0=有效）
      build: () => buildFrame(0x11, [0, 0], defaultSleepPayload()),
    },
  ],
  buildFrame,
  applyChecksum,
  parseHex,
  parseResponse: parseKb250718Response,
}
