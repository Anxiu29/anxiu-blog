import { computed, ref, watch } from 'vue'
import { getBackend } from '../hid'
import type { HidChannel } from '../hid/types'
import { applyCustomChecksum } from '../protocol/custom'
import { dumpHsKeymapBuffer } from '../protocol/hs'
import { buildJpGetBufferFrame } from '../protocol/jp'
import { dumpSlkDefKeyMatrix } from '../protocol/sparklink'
import {
  addUserPreset,
  loadOverlay,
  mergePresets,
  removePreset as removeStoredPreset,
} from '../protocol/presetStore'
import {
  getProtocol,
  listProtocols,
  resolveProtocolByVid,
  toHexOmitTrailingZeros,
  toDecOmitTrailingZeros,
} from '../protocol/registry'
import type { ChecksumMode, PresetCommand, ProtocolProfile } from '../protocol/types'
import { applyChecksum as applyRyCs7 } from '../protocol/ryCommon'

export interface ExchangeLogItem {
  time: string
  direction: 'TX' | 'RX'
  hex: string
  note?: string
}

function nowLabel(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function applyChecksum(frame: Uint8Array, mode: ChecksumMode): Uint8Array {
  if (mode === 'ry_cs7') return applyRyCs7(frame)
  if (mode === 'none') return new Uint8Array(frame)
  return applyCustomChecksum(frame, mode)
}

export function useProtocolCommands() {
  const backend = getBackend()
  const protocols = listProtocols()
  const protocolId = ref(protocols[0]?.id ?? 'ry5088')

  const busy = ref(false)
  const error = ref('')
  const requestHex = ref('')
  const responseHex = ref('')
  const requestDec = ref('')
  const responseDec = ref('')
  const parsedText = ref('')
  const log = ref<ExchangeLogItem[]>([])

  const reportIdText = ref('0')
  const channel = ref<HidChannel>('auto')
  const timeoutMs = ref(200)
  const checksumMode = ref<ChecksumMode>('ry_cs7')
  const bodyLen = ref(64)
  const autoChecksum = ref(true)
  const rawHex = ref('')

  /** Bumps when localStorage overlay changes so presets recompute. */
  const overlayTick = ref(0)
  /** After user picks a protocol in UI, VID auto-match must not override it. */
  const protocolLocked = ref(false)

  const profile = computed<ProtocolProfile>(() => getProtocol(protocolId.value))

  const presets = computed<PresetCommand[]>(() => {
    void overlayTick.value
    return mergePresets(profile.value.presets, loadOverlay(protocolId.value), bodyLen.value)
  })

  function loadProfileDefaults(p: ProtocolProfile) {
    bodyLen.value = p.bodyLen
    reportIdText.value = p.reportId == null ? '' : String(p.reportId)
    channel.value = p.channel
    timeoutMs.value = p.timeoutMs
    checksumMode.value = p.checksum
    autoChecksum.value = p.checksum !== 'none'
    const merged = mergePresets(p.presets, loadOverlay(p.id), p.bodyLen)
    const first = merged[0]
    if (first) {
      const frame = first.build ? first.build() : p.buildFrame(first.cmd, first.params)
      rawHex.value = toHexOmitTrailingZeros(frame)
    } else {
      rawHex.value = ''
    }
  }

  watch(
    protocolId,
    (id) => {
      loadProfileDefaults(getProtocol(id))
      clearLog()
    },
    { immediate: true },
  )

  watch(checksumMode, (mode) => {
    autoChecksum.value = mode !== 'none'
  })

  /** Manual protocol selection from UI. */
  function setProtocol(id: string) {
    protocolLocked.value = true
    protocolId.value = id
  }

  /** Auto-select protocol when device VID matches a profile (e.g. 258A → 贝盈). */
  function applyDeviceVid(vid: string | null | undefined) {
    if (protocolLocked.value) return
    const matched = resolveProtocolByVid(vid)
    if (matched && matched.id !== protocolId.value) {
      protocolId.value = matched.id
    }
  }

  /** New device: unlock auto-match and apply VID hint. */
  function onDeviceChanged(vid: string | null | undefined) {
    protocolLocked.value = false
    applyDeviceVid(vid)
  }

  function pushLog(direction: 'TX' | 'RX', hex: string, note?: string) {
    log.value = [{ time: nowLabel(), direction, hex, note }, ...log.value].slice(0, 60)
  }

  function parseReportId(): number | undefined {
    const t = reportIdText.value.trim()
    if (t === '') return undefined
    const n = Number.parseInt(t, t.toLowerCase().startsWith('0x') ? 16 : 10)
    if (Number.isNaN(n) || n < 0 || n > 255) {
      throw new Error('Report ID 须为 0–255')
    }
    return n
  }

  function findPreset(presetId: string): PresetCommand | undefined {
    return presets.value.find((x) => x.id === presetId)
  }

  function buildPresetFrame(presetId: string): Uint8Array {
    const p = profile.value
    const preset = findPreset(presetId)
    if (!preset) throw new Error('未知预设指令')
    if (preset.build) return preset.build()
    return p.buildFrame(preset.cmd, preset.params)
  }

  function setRequestDisplay(frame: Uint8Array) {
    requestHex.value = toHexOmitTrailingZeros(frame)
    requestDec.value = toDecOmitTrailingZeros(frame)
  }

  function setResponseDisplay(frame: Uint8Array) {
    responseHex.value = toHexOmitTrailingZeros(frame)
    responseDec.value = toDecOmitTrailingZeros(frame)
  }

  function clearResultDisplay() {
    requestHex.value = ''
    responseHex.value = ''
    requestDec.value = ''
    responseDec.value = ''
  }

  function fillPreset(presetId: string) {
    const frame = buildPresetFrame(presetId)
    rawHex.value = toHexOmitTrailingZeros(frame)
  }

  async function exchange(deviceId: string, frame: Uint8Array, cmdForParse: number) {
    if (!deviceId) throw new Error('请先选择设备')
    busy.value = true
    error.value = ''
    clearResultDisplay()
    parsedText.value = ''
    try {
      setRequestDisplay(frame)
      pushLog('TX', requestHex.value)
      const reportId = parseReportId()
      // 星闪固定 Output，避免界面通道仍为 auto 时双发
      const ch = protocolId.value === 'sparklink' ? 'output' : channel.value
      if (protocolId.value === 'sparklink') channel.value = 'output'
      const response = await backend.exchangeReport(deviceId, frame, {
        timeoutMs:
          protocolId.value === 'sparklink'
            ? Math.max(timeoutMs.value, 1200)
            : timeoutMs.value,
        reportId,
        channel: ch,
        usagePageHint: profile.value.usagePageHint,
        assembleSparkLink: protocolId.value === 'sparklink',
      })
      setResponseDisplay(response)
      pushLog('RX', responseHex.value)
      parsedText.value = profile.value.parseResponse(cmdForParse, response)
      return response
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      busy.value = false
    }
  }

  /** 底层单次收发（不切换 busy；供多包流程复用）。 */
  async function exchangeOnce(
    deviceId: string,
    frame: Uint8Array,
    options?: {
      expectPrefix?: number[]
      timeoutMs?: number
      channel?: HidChannel
      assembleSparkLink?: boolean
    },
  ): Promise<Uint8Array> {
    const reportId = parseReportId()
    setRequestDisplay(frame)
    pushLog('TX', requestHex.value)
    const response = await backend.exchangeReport(deviceId, frame, {
      timeoutMs: options?.timeoutMs ?? timeoutMs.value,
      reportId,
      channel: options?.channel ?? channel.value,
      usagePageHint: profile.value.usagePageHint,
      expectPrefix: options?.expectPrefix,
      assembleSparkLink: options?.assembleSparkLink,
    })
    setResponseDisplay(response)
    pushLog('RX', responseHex.value)
    return response
  }

  /** 航晟/巨朋：按矩阵尺寸自组 get_buffer 分包，过滤 82 01 回包后拼表。 */
  async function readHsKeymap(deviceId: string) {
    if (!deviceId) throw new Error('请先选择设备')
    const id = protocolId.value
    if (id !== 'hs' && id !== 'jp') throw new Error('请先切换到航晟 HS 或巨朋 JP 协议')
    busy.value = true
    error.value = ''
    parsedText.value = ''
    try {
      const result = await dumpHsKeymapBuffer(
        (frame) =>
          exchangeOnce(deviceId, frame, {
            expectPrefix: [0x82, 0x01],
            timeoutMs: Math.max(timeoutMs.value, 800),
          }),
        {
          gapMs: 20,
          buildGetBuffer: id === 'jp' ? buildJpGetBufferFrame : undefined,
          onProgress: ({ packageIndex, packageCount, addr, readLen }) => {
            parsedText.value = `读取按键矩阵… ${packageIndex + 1}/${packageCount}（addr=0x${addr.toString(16)} len=${readLen}）`
          },
        },
      )
      parsedText.value = result.text
      return result
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      busy.value = false
    }
  }

  /** 星闪：三次 DEFKEY 读完 6×21 默认键值，格式同航晟可复制数组（十六进制）。 */
  async function readSlkDefKey(deviceId: string) {
    if (!deviceId) throw new Error('请先选择设备')
    if (protocolId.value !== 'sparklink') throw new Error('请先切换到星闪悦动 SparkLink 协议')
    // 忽略界面上可能残留的 auto，避免 Feature+Output 双发
    channel.value = 'output'
    busy.value = true
    error.value = ''
    parsedText.value = ''
    try {
      const result = await dumpSlkDefKeyMatrix(
        (frame) =>
          exchangeOnce(deviceId, frame, {
            expectPrefix: [0x5c, 0x2d, 0xab],
            timeoutMs: Math.max(timeoutMs.value, 800),
            channel: 'output',
            assembleSparkLink: true,
          }),
        {
          gapMs: 20,
          onProgress: ({ packageIndex, packageCount, row1, row2 }) => {
            parsedText.value = `读取默认键值… ${packageIndex + 1}/${packageCount}（row ${row1}+${row2}）`
          },
        },
      )
      parsedText.value = result.text
      return result
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      busy.value = false
    }
  }

  async function sendPreset(deviceId: string, presetId: string) {
    if (presetId === 'keymap_dump_all') {
      return readHsKeymap(deviceId)
    }
    if (presetId === 'defkey_dump_all') {
      return readSlkDefKey(deviceId)
    }
    const preset = findPreset(presetId)
    if (!preset) throw new Error('未知预设指令')
    let frame = buildPresetFrame(presetId)
    if (autoChecksum.value) {
      frame = applyChecksum(frame, checksumMode.value)
    }
    rawHex.value = toHexOmitTrailingZeros(frame)
    return exchange(deviceId, frame, preset.cmd)
  }

  async function sendRaw(deviceId: string) {
    const p = profile.value
    let frame = p.parseHex(rawHex.value, bodyLen.value > 0 ? bodyLen.value : undefined)
    if (bodyLen.value > 0 && frame.length !== bodyLen.value) {
      // parseHex already pads; for custom with bodyLen 0 keep as-is
    }
    if (autoChecksum.value && checksumMode.value !== 'none') {
      frame = applyChecksum(frame, checksumMode.value)
      rawHex.value = toHexOmitTrailingZeros(frame)
    }
    const cmd = frame[0] ?? 0
    return exchange(deviceId, frame, cmd)
  }

  function clearLog() {
    log.value = []
    clearResultDisplay()
    parsedText.value = ''
    error.value = ''
  }

  /** Save current editor hex (or a given frame) as a user preset for this protocol. */
  function addPresetFromHex(label: string, hexSource?: string): PresetCommand {
    const text = (hexSource ?? rawHex.value).trim()
    if (!text) throw new Error('请先在编辑区填入 Hex，再添加预设')
    const p = profile.value
    const frame = p.parseHex(text, bodyLen.value > 0 ? bodyLen.value : undefined)
    const stored = addUserPreset(p.id, {
      label,
      frame,
      bodyLen: bodyLen.value,
    })
    overlayTick.value += 1
    return {
      id: stored.id,
      label: stored.label,
      cmd: stored.cmd,
      build: () => frame,
    }
  }

  function deletePreset(presetId: string) {
    const builtInIds = new Set(profile.value.presets.map((p) => p.id))
    if (!findPreset(presetId) && !builtInIds.has(presetId)) {
      throw new Error('未知预设指令')
    }
    removeStoredPreset(protocolId.value, presetId, builtInIds)
    overlayTick.value += 1
  }

  return {
    protocols,
    protocolId,
    profile,
    presets,
    busy,
    error,
    requestHex,
    responseHex,
    requestDec,
    responseDec,
    parsedText,
    log,
    reportIdText,
    channel,
    timeoutMs,
    checksumMode,
    bodyLen,
    autoChecksum,
    rawHex,
    fillPreset,
    sendPreset,
    sendRaw,
    readHsKeymap,
    readSlkDefKey,
    clearLog,
    buildPresetFrame,
    setProtocol,
    applyDeviceVid,
    onDeviceChanged,
    addPresetFromHex,
    deletePreset,
  }
}
