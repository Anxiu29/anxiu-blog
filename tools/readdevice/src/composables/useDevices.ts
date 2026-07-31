import { onMounted, ref, watch } from 'vue'
import { getBackend, type DeviceDetail, type DeviceSummary, type RuntimeMode } from '../hid'

export type { DeviceDetail, DeviceSummary }

export function useDevices() {
  const backend = getBackend()
  const mode = ref<RuntimeMode>(backend.mode)
  const devices = ref<DeviceSummary[]>([])
  const selectedId = ref('')
  const detail = ref<DeviceDetail | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function refresh(preferId?: string) {
    loading.value = true
    error.value = ''
    try {
      const list = await backend.listDevices()
      devices.value = list
      const nextId =
        (preferId && list.find((d) => d.id === preferId)?.id) ||
        list.find((d) => d.id === selectedId.value)?.id ||
        list[0]?.id ||
        ''
      if (nextId === selectedId.value) {
        if (nextId) {
          detail.value = await backend.getDeviceDetail(nextId)
        } else {
          detail.value = null
        }
      } else {
        selectedId.value = nextId
        // watch(selectedId) will load detail
      }
    } catch (e) {
      error.value = String(e)
      devices.value = []
      detail.value = null
    } finally {
      loading.value = false
    }
  }

  function matchGrantedId(
    list: DeviceSummary[],
    granted: DeviceSummary[],
  ): string | undefined {
    for (const g of granted) {
      const byId = list.find((d) => d.id === g.id)
      if (byId) return byId.id
    }
    for (const g of granted) {
      const byVidPid = list.find((d) => d.vid === g.vid && d.pid === g.pid)
      if (byVidPid) return byVidPid.id
    }
    return undefined
  }

  async function requestAccess() {
    if (!backend.requestAccess) return
    loading.value = true
    error.value = ''
    try {
      const granted = await backend.requestAccess()
      // Prefer picker id first; rematch by VID/PID if listDevices deduped differently
      await refresh(granted[0]?.id)
      const matched = matchGrantedId(devices.value, granted)
      if (matched && matched !== selectedId.value) {
        selectedId.value = matched
      }
    } catch (e) {
      const msg = String(e)
      // User cancelled picker — not a hard error
      if (!/abort|cancel|notallowed/i.test(msg)) {
        error.value = msg
      }
    } finally {
      loading.value = false
    }
  }

  async function loadDetail(id: string) {
    if (!id) {
      detail.value = null
      return
    }
    loading.value = true
    error.value = ''
    try {
      detail.value = await backend.getDeviceDetail(id)
    } catch (e) {
      error.value = String(e)
      detail.value = null
    } finally {
      loading.value = false
    }
  }

  watch(selectedId, (id) => {
    void loadDetail(id)
  })

  onMounted(() => {
    if (mode.value === 'tauri') {
      void refresh()
    } else if (mode.value === 'webhid') {
      // Previously authorized devices only; new ones need 授权设备
      void refresh()
    }
  })

  return {
    mode,
    devices,
    selectedId,
    detail,
    loading,
    error,
    canRequestAccess: !!backend.requestAccess,
    refresh,
    requestAccess,
    loadDetail,
  }
}
