<script setup lang="ts">
import type { DeviceDetail } from '../composables/useDevices'

defineProps<{
  detail: DeviceDetail | null
  webLimited?: boolean
}>()

function formatRate(hz: number | null | undefined) {
  if (hz == null) return '无法读取'
  // 协议档位多为整数；USB bInterval 推算可能带小数
  return Number.isInteger(hz) ? `${hz} Hz` : `${hz.toFixed(1)} Hz`
}

function fallback(text: string | null | undefined, empty = '—') {
  if (text == null || text === '') return empty
  return text
}
</script>

<template>
  <div class="panel" v-if="detail">
    <div class="grid">
      <div class="field">
        <span class="label">VID</span>
        <span class="value">{{ detail.vid }}</span>
      </div>
      <div class="field">
        <span class="label">PID</span>
        <span class="value">{{ detail.pid }}</span>
      </div>
      <div v-if="!webLimited" class="field">
        <span class="label">版本号</span>
        <span class="value">{{ fallback(detail.version) }}</span>
      </div>
      <div v-if="!webLimited" class="field">
        <span class="label">厂商描述符</span>
        <span class="value">{{ fallback(detail.manufacturer) }}</span>
      </div>
      <div class="field">
        <span class="label">产品描述符</span>
        <span class="value">{{ detail.product || '—' }}</span>
      </div>
      <div v-if="!webLimited || detail.pollingRateHz != null" class="field">
        <span class="label">回报率</span>
        <span class="value" :class="detail.pollingRateHz == null ? 'muted' : 'accent'">
          {{ formatRate(detail.pollingRateHz) }}
        </span>
      </div>
      <div v-if="!webLimited" class="field">
        <span class="label">USB Version</span>
        <span class="value" :class="{ muted: !detail.usbVersion }">
          {{ fallback(detail.usbVersion, '无法读取') }}
        </span>
      </div>
      <div v-if="!webLimited" class="field">
        <span class="label">Speed</span>
        <span class="value" :class="{ muted: !detail.speed }">
          {{ fallback(detail.speed, '无法读取') }}
        </span>
      </div>
    </div>
  </div>
  <div class="empty" v-else>选择设备以查看详情</div>
</template>

<style scoped>
.panel {
  margin-top: 1rem;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1.5rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.65rem 0.8rem;
  background: #f4f6f8;
  border-radius: 8px;
}

.label {
  font-size: 0.75rem;
  color: #6b7280;
}

.value {
  font-size: 1rem;
  font-weight: 600;
  color: #111827;
  word-break: break-all;
}

.value.accent {
  color: #1565c0;
}

.value.muted {
  color: #94a3b8;
  font-weight: 500;
}

.empty {
  margin-top: 2rem;
  text-align: center;
  color: #9ca3af;
}
</style>
