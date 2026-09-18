import { computed, ref, watch } from 'vue'
import { getBackend } from '../hid'
import type { HidChannel } from '../hid/types'
import { applyCustomChecksum } from '../protocol/custom'
import { dumpHsKeymapBuffer } from '../protocol/hs'
import { buildJpGetBufferFrame } from '../protocol/jp'
import { dumpSlkDefKeyMatrix } from '../protocol/sparklink'
import { applyTlwChecksum, dumpTlwSnapshot, tlwExpectPrefix } from '../protocol/tlw'
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
  toHex,
  toHexOmitTrailingZeros,
  toDecOmitTrailingZeros,
  formatReportIdText,
  parseReportIdText,
  resolveWireField,
} from '../protocol/registry'
import type { ChecksumMode, PresetCommand, ProtocolProfile } from '../protocol/types'
import { padToLength, parseHexBytes } from '../protocol/types'
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
  if (mode === 'tlw_cs') return applyTlwChecksum(frame)
  if (mode === 'none') return new Uint8Array(frame)
  return applyCustomChecksum(frame, mode)
}

function forceOutputProtocol(id: string): boolean {
  return id === 'sparklink' || id === 'tlw'
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
  /** User typed Report ID; do not reset to protocol default on preset send/select. */
  const reportIdDirty = ref(false)
  /** User typed 帧长; same as reportIdDirty. */
  const bodyLenDirty = ref(false)
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
    reportIdDirty.value = false
    bodyLenDirty.value = false
    bodyLen.value = p.bodyLen
    reportIdText.value = p.reportId == null ? '' : formatReportIdText(p.reportId)
    channel.value = p.channel
    timeoutMs.value = p.timeoutMs
    checksumMode.value = p.checksum
    autoChecksum.value = p.checksum !== 'none'
    const merged = mergePresets(p.presets, loadOverlay(p.id), p.bodyLen)
    const first = merged[0]
    if (first) {
      const frame = first.build ? first.build() : p.buildFrame(first.cmd, first.params)
      rawHex.value = toHex(frame)
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
    return parseReportIdText(reportIdText.value)
  }

  function findPreset(presetId: string): PresetCommand | undefined {
    return presets.value.find((x) => x.id === presetId)
  }

  function markReportIdUserEdited() {
    reportIdDirty.value = true
  }

  function markBodyLenUserEdited() {
    bodyLenDirty.value = true
  }

  /** Apply per-preset reportId / bodyLen (e.g. RK9007 0x0A 小包). Keeps user edits. */
  function applyPresetWire(presetId: string) {
    const preset = findPreset(presetId)
    if (!preset) return
    const rid = resolveWireField(preset.reportId, profile.value.reportId, reportIdDirty.value)
    if (rid.apply) {
      reportIdText.value = rid.value == null ? '' : formatReportIdText(rid.value)
    }
    const len = resolveWireField(preset.bodyLen, profile.value.bodyLen, bodyLenDirty.value)
    if (len.apply) {
      bodyLen.value = len.value
    }
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
    applyPresetWire(presetId)
    const frame = buildPresetFrame(presetId)
    rawHex.value = toHex(frame)
  }

  async function exchange(
    deviceId: string,
    frame: Uint8Array,
    cmdForParse: number,
    options?: { honorUi?: boolean },
  ) {
    if (!deviceId) throw new Error('请先选择设备')
    busy.value = true
    error.value = ''
    clearResultDisplay()
    parsedText.value = ''
    try {
      setRequestDisplay(frame)
      const reportId = parseReportId()
      const honorUi = options?.honorUi === true
      const ch = honorUi
        ? channel.value
        : forceOutputProtocol(protocolId.value)
          ? 'output'
          : channel.value
      if (!honorUi && forceOutputProtocol(protocolId.value)) channel.value = 'output'
      const ridNote =
        reportId == null ? 'RID=auto' : `RID=${formatReportIdText(reportId)}`
      pushLog('TX', requestHex.value, `${ridNote} ${ch} ${frame.length}B`)
      const response = await backend.exchangeReport(deviceId, frame, {
        timeoutMs:
          forceOutputProtocol(protocolId.value)
            ? Math.max(timeoutMs.value, 1200)
            : timeoutMs.value,
        reportId,
        channel: ch,
        usagePageHint: profile.value.usagePageHint,
        expectPrefix: protocolId.value === 'tlw' ? tlwExpectPrefix(frame) : undefined,
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

  /** TLW：实机命令分包读基本信息 / 功能区 / 按键 / 电量。 */
  async function readTlwSnapshot(deviceId: string) {
    if (!deviceId) throw new Error('请先选择设备')
    if (protocolId.value !== 'tlw') throw new Error('请先切换到 TLW 网页AP 协议')
    channel.value = 'output'
    busy.value = true
    error.value = ''
    parsedText.value = ''
    try {
      const result = await dumpTlwSnapshot(
        (frame, expectPrefix) =>
          exchangeOnce(deviceId, frame, {
            expectPrefix,
            timeoutMs: Math.max(timeoutMs.value, 800),
            channel: 'output',
          }),
        {
          gapMs: 20,
          onProgress: ({ step, index, total }) => {
            parsedText.value = `读取 TLW… ${index + 1}/${total}（${step}）`
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
    if (presetId === 'tlw_dump_all') {
      return readTlwSnapshot(deviceId)
    }
    const preset = findPreset(presetId)
    if (!preset) throw new Error('未知预设指令')
    applyPresetWire(presetId)
    let frame = buildPresetFrame(presetId)
    if (autoChecksum.value) {
      frame = applyChecksum(frame, checksumMode.value)
    }
    rawHex.value = toHex(frame)
    return exchange(deviceId, frame, preset.cmd)
  }

  /** Parse editor hex as-is. Report ID / 帧长 / 通道以界面当前值为准，不按协议改写. */
  function parseRawEditorBytes(text: string): { bytes: number[]; len: number } {
    const bytes = parseHexBytes(text)
    const len = bodyLen.value
    if (len > 0 && bytes.length > len) {
      throw new Error(`最多 ${len} 字节，当前 ${bytes.length}。请改「帧长」或删掉多余字节。`)
    }
    return { bytes, len }
  }

  async function sendRaw(deviceId: string) {
    const { bytes, len } = parseRawEditorBytes(rawHex.value)
    let frame = len > 0 ? padToLength(bytes, len) : Uint8Array.from(bytes)
    if (autoChecksum.value && checksumMode.value !== 'none') {
      frame = applyChecksum(frame, checksumMode.value)
      rawHex.value = toHex(frame)
    }
    const cmd = frame[0] ?? 0
    return exchange(deviceId, frame, cmd, { honorUi: true })
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
    const { bytes, len } = parseRawEditorBytes(text)
    const frame = len > 0 ? padToLength(bytes, len) : Uint8Array.from(bytes)
    const stored = addUserPreset(p.id, {
      label,
      frame,
      bodyLen: len,
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
    applyPresetWire,
    markReportIdUserEdited,
    markBodyLenUserEdited,
    sendPreset,
    sendRaw,
    readHsKeymap,
    readSlkDefKey,
    readTlwSnapshot,
    clearLog,
    buildPresetFrame,
    setProtocol,
    applyDeviceVid,
    onDeviceChanged,
    addPresetFromHex,
    deletePreset,
  }
}
