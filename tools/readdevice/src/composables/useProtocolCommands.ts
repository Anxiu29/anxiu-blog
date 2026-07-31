import { computed, ref, watch } from 'vue'
import { getBackend } from '../hid'
import type { HidChannel } from '../hid/types'
import { applyCustomChecksum } from '../protocol/custom'
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

  /** Auto-select protocol when device VID matches a profile (e.g. 258A → 贝盈). */
  function applyDeviceVid(vid: string | null | undefined) {
    const matched = resolveProtocolByVid(vid)
    if (matched && matched.id !== protocolId.value) {
      protocolId.value = matched.id
    }
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

  function fillPreset(presetId: string) {
    const frame = buildPresetFrame(presetId)
    rawHex.value = toHexOmitTrailingZeros(frame)
  }

  async function exchange(deviceId: string, frame: Uint8Array, cmdForParse: number) {
    if (!deviceId) throw new Error('请先选择设备')
    busy.value = true
    error.value = ''
    requestHex.value = ''
    responseHex.value = ''
    parsedText.value = ''
    try {
      const tx = toHexOmitTrailingZeros(frame)
      requestHex.value = tx
      pushLog('TX', tx)
      const reportId = parseReportId()
      const response = await backend.exchangeReport(deviceId, frame, {
        timeoutMs: timeoutMs.value,
        reportId,
        channel: channel.value,
        usagePageHint: profile.value.usagePageHint,
      })
      const rx = toHexOmitTrailingZeros(response)
      responseHex.value = rx
      pushLog('RX', rx)
      parsedText.value = profile.value.parseResponse(cmdForParse, response)
      return response
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      busy.value = false
    }
  }

  async function sendPreset(deviceId: string, presetId: string) {
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
    requestHex.value = ''
    responseHex.value = ''
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
    clearLog,
    buildPresetFrame,
    applyDeviceVid,
    addPresetFromHex,
    deletePreset,
  }
}
