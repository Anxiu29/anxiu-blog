/** @deprecated Prefer useProtocolCommands. Thin wrapper kept for compatibility. */
import { useProtocolCommands } from './useProtocolCommands'
import { ry5088Profile } from '../protocol/ry5088'
import { buildFrame as buildRyFrame, applyChecksum, parseHex, parseRy5088Response, toHex } from '../protocol/ryCommon'

export type { PresetCommand } from '../protocol/types'
export const PRESET_COMMANDS = ry5088Profile.presets

export function buildFrame(opts: { cmd: number; params?: number[]; data?: ArrayLike<number> }) {
  return buildRyFrame(opts.cmd, opts.params, opts.data)
}

export { applyChecksum, parseHex, toHex, parseRy5088Response as parseResponse }

export function useRy5088() {
  const api = useProtocolCommands()
  api.protocolId.value = 'ry5088'

  return {
    busy: api.busy,
    error: api.error,
    responseHex: api.responseHex,
    parsedText: api.parsedText,
    log: api.log,
    presets: PRESET_COMMANDS,
    sendPreset: api.sendPreset,
    sendRaw: async (deviceId: string, hexText: string, autoCs: boolean) => {
      api.rawHex.value = hexText
      api.autoChecksum.value = autoCs
      api.checksumMode.value = 'ry_cs7'
      return api.sendRaw(deviceId)
    },
    clearLog: api.clearLog,
  }
}
