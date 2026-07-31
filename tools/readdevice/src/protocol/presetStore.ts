import type { PresetCommand } from './types'
import { parseHexBytes, padToLength, toHex } from './types'

const STORAGE_KEY = 'readdevice.protocolPresets.v1'

export interface StoredUserPreset {
  id: string
  label: string
  /** First byte used for response parsing. */
  cmd: number
  /** Full frame hex (spaces optional). */
  hex: string
}

interface ProtocolPresetOverlay {
  custom: StoredUserPreset[]
  /** Built-in preset ids removed by the user. */
  removedIds: string[]
}

type StoreShape = Record<string, ProtocolPresetOverlay>

function emptyOverlay(): ProtocolPresetOverlay {
  return { custom: [], removedIds: [] }
}

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as StoreShape
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: StoreShape) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function loadOverlay(protocolId: string): ProtocolPresetOverlay {
  const store = readStore()
  const o = store[protocolId]
  if (!o) return emptyOverlay()
  return {
    custom: Array.isArray(o.custom) ? o.custom : [],
    removedIds: Array.isArray(o.removedIds) ? o.removedIds : [],
  }
}

function saveOverlay(protocolId: string, overlay: ProtocolPresetOverlay) {
  const store = readStore()
  store[protocolId] = overlay
  writeStore(store)
}

function frameFromStored(hex: string, bodyLen: number): Uint8Array {
  const bytes = parseHexBytes(hex)
  if (bodyLen > 0) return padToLength(bytes, bodyLen)
  return Uint8Array.from(bytes)
}

export function toPresetCommand(stored: StoredUserPreset, bodyLen: number): PresetCommand {
  return {
    id: stored.id,
    label: stored.label,
    cmd: stored.cmd & 0xff,
    build: () => frameFromStored(stored.hex, bodyLen),
  }
}

export function mergePresets(
  builtIn: PresetCommand[],
  overlay: ProtocolPresetOverlay,
  bodyLen: number,
): PresetCommand[] {
  const removed = new Set(overlay.removedIds)
  const base = builtIn.filter((p) => !removed.has(p.id))
  const custom = overlay.custom.map((c) => toPresetCommand(c, bodyLen))
  return [...base, ...custom]
}

export function isUserPreset(protocolId: string, presetId: string): boolean {
  return loadOverlay(protocolId).custom.some((c) => c.id === presetId)
}

export function addUserPreset(
  protocolId: string,
  input: { label: string; frame: ArrayLike<number>; bodyLen: number },
): StoredUserPreset {
  const bytes = Array.from(input.frame, (b) => b & 0xff)
  const stored: StoredUserPreset = {
    id: `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: input.label.trim() || `自定义 ${toHex(bytes.slice(0, 1))}`,
    cmd: bytes[0] ?? 0,
    hex: toHex(bytes),
  }
  const overlay = loadOverlay(protocolId)
  overlay.custom = [...overlay.custom, stored]
  saveOverlay(protocolId, overlay)
  return stored
}

/** Remove a preset: user custom deleted; built-in marked removed. */
export function removePreset(
  protocolId: string,
  presetId: string,
  builtInIds: Set<string>,
): void {
  const overlay = loadOverlay(protocolId)
  if (overlay.custom.some((c) => c.id === presetId)) {
    overlay.custom = overlay.custom.filter((c) => c.id !== presetId)
  } else if (builtInIds.has(presetId)) {
    if (!overlay.removedIds.includes(presetId)) {
      overlay.removedIds = [...overlay.removedIds, presetId]
    }
  }
  saveOverlay(protocolId, overlay)
}
