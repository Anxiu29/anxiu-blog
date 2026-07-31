<script setup lang="ts">
import CommandPanel from './components/CommandPanel.vue'
import DevicePanel from './components/DevicePanel.vue'
import { useDevices } from './composables/useDevices'

const {
  mode,
  devices,
  selectedId,
  detail,
  loading,
  error,
  canRequestAccess,
  refresh,
  requestAccess,
} = useDevices()

const modeLabel: Record<string, string> = {
  tauri: '桌面端（完整信息）',
  webhid: '网页端 WebHID（VID/PID/产品名）',
  unsupported: '不支持',
}
</script>

<template>
  <div class="app">
    <header class="header">
      <div>
        <a class="back" href="/">← 返回安秀博客</a>
        <h1>HID 查询工具</h1>
        <p class="mode">{{ modeLabel[mode] }}</p>
      </div>
      <div class="actions">
        <select v-model="selectedId" :disabled="loading || devices.length === 0">
          <option disabled value="">{{ devices.length ? '选择设备' : '未发现已授权设备' }}</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
        <button
          v-if="canRequestAccess"
          type="button"
          class="secondary"
          @click="requestAccess"
          :disabled="loading"
        >
          授权设备
        </button>
        <button type="button" @click="refresh" :disabled="loading">刷新</button>
      </div>
    </header>

    <p v-if="mode === 'webhid'" class="hint">
      网页端需「授权设备」。
    </p>
    <p v-else-if="mode === 'unsupported'" class="hint">
      请使用 Chrome / Edge 打开本页，或运行 <code>npm run tauri -- dev</code> 启动桌面版。
    </p>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="status">读取中…</p>

    <DevicePanel :detail="detail" :web-limited="mode === 'webhid'" />

    <CommandPanel
      :device-id="selectedId"
      :device-vid="detail?.vid ?? devices.find((d) => d.id === selectedId)?.vid"
      :disabled="loading || mode === 'unsupported'"
    />
  </div>
</template>

<style scoped>
.app {
  max-width: 820px;
  margin: 0 auto;
  padding: 1.25rem 1.5rem 2rem;
  text-align: left;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.back {
  display: inline-block;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  color: #1565c0;
  text-decoration: none;
}

.back:hover {
  text-decoration: underline;
}

h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
}

.mode {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #64748b;
}

.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

select {
  min-width: 220px;
  max-width: 360px;
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

button:disabled,
select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hint {
  margin-top: 0.85rem;
  padding: 0.65rem 0.8rem;
  background: #eff6ff;
  color: #1e3a5f;
  border-radius: 8px;
  font-size: 0.875rem;
}

.hint code {
  font-size: 0.8rem;
}

.error {
  color: #b91c1c;
  margin-top: 1rem;
}

.status {
  color: #64748b;
  margin-top: 1rem;
}
</style>
