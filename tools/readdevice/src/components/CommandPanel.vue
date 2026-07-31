<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProtocolCommands } from '../composables/useProtocolCommands'
import { toHexOmitTrailingZeros } from '../protocol/registry'
import type { ChecksumMode } from '../protocol/types'
import type { HidChannel } from '../hid/types'

const props = defineProps<{
  deviceId: string
  deviceVid?: string
  disabled?: boolean
}>()

const {
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
} = useProtocolCommands()

const tab = ref<'preset' | 'raw'>('preset')
const presetId = ref('')
const showAddForm = ref(false)
const newPresetLabel = ref('')
const presetMsg = ref('')
const copyMsg = ref('')

watch(
  presets,
  (list) => {
    if (!list.find((p) => p.id === presetId.value)) {
      presetId.value = list[0]?.id ?? ''
    }
  },
  { immediate: true },
)

watch(
  () => props.deviceId,
  (id, prev) => {
    clearLog()
    // Device switched (or first select): allow VID auto-match again.
    if (id !== prev) onDeviceChanged(props.deviceVid)
  },
)

watch(
  () => props.deviceVid,
  (vid) => applyDeviceVid(vid),
  { immediate: true },
)

function onProtocolSelect(ev: Event) {
  const el = ev.target as HTMLSelectElement
  setProtocol(el.value)
}

const previewHex = computed(() => {
  if (!presetId.value) return ''
  try {
    return toHexOmitTrailingZeros(buildPresetFrame(presetId.value))
  } catch {
    return ''
  }
})

const canSend = computed(() => !!props.deviceId && !props.disabled && !busy.value)

const lenWarn = computed(() => {
  if (profile.value.id === 'custom') return ''
  const expected = bodyLen.value
  if (!expected || !rawHex.value.trim()) return ''
  try {
    const frame = profile.value.parseHex(rawHex.value, expected)
    if (frame.length !== expected) {
      return `当前长度 ${frame.length}，档案默认 ${expected}`
    }
  } catch {
    /* ignore while typing */
  }
  return ''
})

async function onSendPreset() {
  if (!canSend.value || !presetId.value) return
  try {
    await sendPreset(props.deviceId, presetId.value)
  } catch {
    /* error ref set */
  }
}

async function onReadHsKeymap() {
  if (!canSend.value) return
  copyMsg.value = ''
  try {
    if (protocolId.value === 'sparklink') {
      await readSlkDefKey(props.deviceId)
    } else {
      await readHsKeymap(props.deviceId)
    }
  } catch {
    /* error ref set */
  }
}

async function onCopyParsed() {
  const text = parsedText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copyMsg.value = '已复制到剪贴板'
  } catch {
    copyMsg.value = '复制失败，请手动全选解析区'
  }
}

async function onSendRaw() {
  if (!canSend.value) return
  try {
    await sendRaw(props.deviceId)
  } catch {
    /* error ref set */
  }
}

function onFillPreset() {
  if (!presetId.value) return
  fillPreset(presetId.value)
  tab.value = 'raw'
}

function onToggleAddForm() {
  showAddForm.value = !showAddForm.value
  presetMsg.value = ''
  if (showAddForm.value && !newPresetLabel.value.trim()) {
    const first = rawHex.value.trim().slice(0, 8).toUpperCase() || '自定义'
    newPresetLabel.value = `自定义 ${first}`
  }
}

function onAddPreset() {
  presetMsg.value = ''
  try {
    const created = addPresetFromHex(newPresetLabel.value.trim() || '自定义预设')
    presetId.value = created.id
    showAddForm.value = false
    newPresetLabel.value = ''
    tab.value = 'preset'
    presetMsg.value = `已添加：${created.label}`
  } catch (e) {
    presetMsg.value = String(e)
  }
}

function onDeletePreset() {
  if (!presetId.value) return
  const cur = presets.value.find((p) => p.id === presetId.value)
  const label = cur?.label ?? presetId.value
  if (!window.confirm(`确定删除预设「${label}」？`)) return
  try {
    deletePreset(presetId.value)
    presetMsg.value = `已删除：${label}`
  } catch (e) {
    presetMsg.value = String(e)
  }
}

const channelOptions: { value: HidChannel; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'feature', label: 'Feature' },
  { value: 'output', label: 'Output' },
]

const checksumOptions: { value: ChecksumMode; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'ry_cs7', label: 'RY CS@7' },
]
</script>

<template>
  <section class="cmd" v-if="deviceId">
    <div class="cmd-header">
      <h2>多协议指令收发</h2>
      <div class="tabs">
        <button
          type="button"
          class="tab"
          :class="{ active: tab === 'preset' }"
          @click="tab = 'preset'"
        >
          预设填包
        </button>
        <button
          type="button"
          class="tab"
          :class="{ active: tab === 'raw' }"
          @click="tab = 'raw'"
        >
          编辑发送
        </button>
      </div>
    </div>

    <div class="transport">
      <label>
        协议
        <select :value="protocolId" :disabled="busy" @change="onProtocolSelect">
          <option v-for="p in protocols" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <label>
        Report ID
        <input
          v-model="reportIdText"
          type="text"
          placeholder="自动"
          :disabled="busy"
          class="narrow"
        />
      </label>
      <label>
        通道
        <select v-model="channel" :disabled="busy">
          <option v-for="c in channelOptions" :key="c.value" :value="c.value">
            {{ c.label }}
          </option>
        </select>
      </label>
      <label>
        超时(ms)
        <input v-model.number="timeoutMs" type="number" min="10" max="5000" :disabled="busy" class="narrow" />
      </label>
      <label>
        帧长
        <input
          v-model.number="bodyLen"
          type="number"
          :min="profile.id === 'custom' ? 0 : 1"
          max="4096"
          :disabled="busy"
          class="narrow"
          :title="profile.id === 'custom' ? '0 = 不定长，不补齐' : undefined"
        />
      </label>
      <label>
        校验
        <select v-model="checksumMode" :disabled="busy">
          <option v-for="c in checksumOptions" :key="c.value" :value="c.value">
            {{ c.label }}
          </option>
        </select>
      </label>
    </div>

    <div v-if="tab === 'preset'" class="body">
      <div class="row">
        <select v-model="presetId" :disabled="busy || presets.length === 0">
          <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <button type="button" class="secondary" @click="onFillPreset" :disabled="busy || !presetId">
          填入编辑区
        </button>
        <button type="button" @click="onSendPreset" :disabled="!canSend || !presetId">发送</button>
        <button
          v-if="protocolId === 'hs' || protocolId === 'jp' || protocolId === 'sparklink'"
          type="button"
          class="secondary"
          @click="onReadHsKeymap"
          :disabled="!canSend"
          :title="
            protocolId === 'sparklink'
              ? '三次 DEFKEY 读 6×21 默认键值，输出可复制数组'
              : '分包发送 82 01 get_buffer，解析为每层可复制数组'
          "
        >
          读取全盘按键
        </button>
        <button type="button" class="secondary" @click="onToggleAddForm" :disabled="busy">
          {{ showAddForm ? '取消添加' : '添加预设' }}
        </button>
        <button
          type="button"
          class="danger"
          @click="onDeletePreset"
          :disabled="busy || !presetId"
        >
          删除
        </button>
      </div>
      <div v-if="showAddForm" class="add-form">
        <label>
          名称
          <input v-model="newPresetLabel" type="text" placeholder="预设名称" :disabled="busy" />
        </label>
        <p class="hint">将使用「编辑发送」区当前 Hex 保存为预设（按协议持久化到本机）</p>
        <button type="button" @click="onAddPreset" :disabled="busy || !rawHex.trim()">
          确认添加
        </button>
      </div>
      <p v-if="presetMsg" class="hint">{{ presetMsg }}</p>
      <p class="preview">
        <span class="label">组帧预览（可再改）</span>
        <code>{{ previewHex || '（无预设）' }}</code>
      </p>
    </div>

    <div v-else class="body">
      <label class="hex-label">
        报文体 Hex（不含 Report ID；空格/逗号分隔）
        <textarea
          v-model="rawHex"
          rows="5"
          spellcheck="false"
          :placeholder="`例: 帧长 ${bodyLen || '自定义'} 字节`"
          :disabled="busy"
        />
      </label>
      <p v-if="lenWarn" class="warn">{{ lenWarn }}</p>
      <div class="row">
        <label v-if="checksumMode !== 'none'" class="check">
          <input v-model="autoChecksum" type="checkbox" :disabled="busy" />
          发送前自动校验
        </label>
        <button type="button" class="secondary" @click="onToggleAddForm" :disabled="busy || !rawHex.trim()">
          存为预设
        </button>
        <button type="button" @click="onSendRaw" :disabled="!canSend || !rawHex.trim()">
          发送并接收
        </button>
      </div>
      <div v-if="showAddForm" class="add-form">
        <label>
          名称
          <input v-model="newPresetLabel" type="text" placeholder="预设名称" :disabled="busy" />
        </label>
        <button type="button" @click="onAddPreset" :disabled="busy || !rawHex.trim()">
          确认添加
        </button>
      </div>
      <p v-if="presetMsg" class="hint">{{ presetMsg }}</p>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="busy" class="status">收发中…</p>

    <div v-if="requestHex || responseHex" class="result">
      <div class="field" v-if="requestHex">
        <span class="label">TX Hex（末尾 00 已省略）</span>
        <code class="mono">{{ requestHex }}</code>
      </div>
      <div class="field" v-if="responseHex">
        <span class="label">RX Hex（末尾 00 已省略）</span>
        <code class="mono scroll">{{ responseHex }}</code>
      </div>
      <div
        class="field"
        v-if="protocolId === 'sparklink' && (requestDec || responseDec)"
      >
        <span class="label">十进制（末尾 0 已省略）</span>
        <div class="dec-block">
          <div v-if="requestDec" class="dec-row">
            <span class="dec-tag">TX</span>
            <code class="mono">{{ requestDec }}</code>
          </div>
          <div v-if="responseDec" class="dec-row">
            <span class="dec-tag">RX</span>
            <code class="mono scroll">{{ responseDec }}</code>
          </div>
        </div>
      </div>
      <div class="field" v-if="parsedText">
        <div class="label-row">
          <span class="label">解析</span>
          <button type="button" class="link" @click="onCopyParsed">复制</button>
          <span v-if="copyMsg" class="hint-inline">{{ copyMsg }}</span>
        </div>
        <pre class="parsed">{{ parsedText }}</pre>
      </div>
    </div>

    <div v-if="log.length" class="log">
      <div class="log-head">
        <span class="label">收发日志</span>
        <button type="button" class="link" @click="clearLog">清空</button>
      </div>
      <ul>
        <li v-for="(item, i) in log" :key="i">
          <span class="time">{{ item.time }}</span>
          <span class="dir" :class="item.direction.toLowerCase()">{{ item.direction }}</span>
          <code>{{ item.hex }}</code>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.cmd {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid #e2e8f0;
}

.cmd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}

h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
}

.tabs {
  display: flex;
  gap: 0.35rem;
}

.tab {
  padding: 0.35rem 0.75rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  cursor: pointer;
  font-size: 0.85rem;
}

.tab.active {
  background: #1565c0;
  border-color: #1565c0;
  color: #fff;
}

.transport {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.75rem;
  margin-bottom: 0.85rem;
  padding: 0.65rem 0.75rem;
  background: #f8fafc;
  border-radius: 8px;
}

.transport label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
  color: #64748b;
}

.transport select,
.transport input {
  min-width: 88px;
  padding: 0.35rem 0.45rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  font-size: 0.85rem;
  color: #0f172a;
}

.transport input.narrow {
  width: 72px;
  min-width: 72px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

select {
  min-width: 220px;
  flex: 1;
  padding: 0.45rem 0.6rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
}

button {
  padding: 0.45rem 0.9rem;
  border: none;
  border-radius: 6px;
  background: #1565c0;
  color: #fff;
  cursor: pointer;
}

button.secondary {
  background: #fff;
  color: #1565c0;
  border: 1px solid #1565c0;
}

button.danger {
  background: #fff;
  color: #b91c1c;
  border: 1px solid #fca5a5;
}

button:disabled,
select:disabled,
textarea:disabled,
input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.add-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.75rem;
  align-items: flex-end;
  padding: 0.65rem 0.75rem;
  background: #f8fafc;
  border-radius: 8px;
}

.add-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
  color: #64748b;
  flex: 1;
  min-width: 180px;
}

.add-form input {
  padding: 0.4rem 0.55rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.85rem;
  color: #0f172a;
}

.hint {
  margin: 0;
  font-size: 0.78rem;
  color: #64748b;
  flex-basis: 100%;
}

button.link {
  background: transparent;
  color: #1565c0;
  padding: 0;
  border: none;
  font-size: 0.8rem;
}

.preview,
.hex-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #64748b;
}

.preview code,
.mono {
  display: block;
  padding: 0.55rem 0.7rem;
  background: #f4f6f8;
  border-radius: 8px;
  color: #0f172a;
  font-size: 0.78rem;
  word-break: break-all;
  line-height: 1.45;
}

.mono.scroll {
  max-height: 160px;
  overflow: auto;
}

.dec-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.55rem 0.7rem;
  background: #f4f6f8;
  border-radius: 8px;
}

.dec-row {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
}

.dec-tag {
  flex: 0 0 auto;
  margin-top: 0.1rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  min-width: 1.6rem;
}

.dec-block .mono {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
  border-radius: 0;
}

textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.7rem;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  resize: vertical;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #334155;
  margin-right: auto;
}

.warn {
  margin: 0;
  font-size: 0.8rem;
  color: #b45309;
}

.error {
  color: #b91c1c;
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
}

.status {
  color: #64748b;
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
}

.result {
  margin-top: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.label {
  font-size: 0.75rem;
  color: #6b7280;
}

.label-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.hint-inline {
  font-size: 0.75rem;
  color: #0f766e;
}

.parsed {
  margin: 0;
  padding: 0.55rem 0.7rem;
  background: #eff6ff;
  border-radius: 8px;
  color: #1e3a5f;
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre;
  overflow-x: auto;
  max-height: 420px;
  overflow-y: auto;
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
  user-select: text;
}

.log {
  margin-top: 0.9rem;
}

.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.4rem;
}

.log ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 180px;
  overflow: auto;
}

.log li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 0.45rem;
  align-items: start;
  font-size: 0.75rem;
}

.time {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.dir {
  font-weight: 700;
  min-width: 1.5rem;
}

.dir.tx {
  color: #1565c0;
}

.dir.rx {
  color: #0f766e;
}

.log code {
  word-break: break-all;
  color: #334155;
}
</style>
