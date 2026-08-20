import { parseHexBytes, parseReportIdText, formatReportIdText, toHexOmitTrailingZeros, toDecOmitTrailingZeros } from './types'
import { buildBeiYingFrame, parseBeiYingResponse, BODY_LEN } from './beiying'
import {
  buildHsFrame,
  buildHsGetBufferFrame,
  dumpHsKeymapBuffer,
  extractHsGetBufferPayload,
  formatHsLayersAsCopyableArrays,
  parseHsKeyBufferToLayers,
  parseHsResponse,
  FRAME_LEN as HS_FRAME_LEN,
  HS_CMD,
  HS_KEYMAP_TOTAL_BYTES,
  HS_READ_LEN_PER_PACKAGE,
} from './hs'
import {
  buildJpFrame,
  buildJpGetInfo,
  buildJpGetBufferFrame,
  buildJpHostFrame,
  buildJpRead,
  buildJpErase,
  parseJpResponse,
  FRAME_LEN as JP_FRAME_LEN,
  JP_CMD,
  JP_HOST_CMD,
} from './jp'
import {
  buildSlkCmd,
  buildSlkSync,
  computeSlkCrc,
  dumpSlkDefKeyMatrix,
  formatSlkDefKeyAsCopyableArrays,
  parseSlkDefKeyPayload,
  parseSlkFrame,
  parseSlkResponse,
  slkAssembleTargetBytes,
  FRAME_LEN as SLK_FRAME_LEN,
  SLK_CMD,
  SLK_HEAD,
  SLK_ORDER,
} from './sparklink'
import {
  buildRk9007Frame,
  buildRk9007OaFrame,
  buildRk9007OaLightBrightnessFrame,
  parseRk9007Response,
  RK9007_CMD,
  RK9007_CONFIG_LEN,
  RK9007_MATRIX_LEN,
  RK9007_OA_BODY_LEN,
  RK9007_OA_CMD,
} from './rk9007'
import {
  buildFrame,
  buildLedParamFrame,
  buildRyGetReportRateFrame,
  checksum,
  defaultSleepPayload,
  parseKb250718Response,
  parseRy5088Response,
  parseRyReportRateHz,
} from './ryCommon'
import { shouldProbeRyReportRate } from './ryReportRate'
import { getProtocol, listProtocols } from './registry'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function testOmitTrailingZeros() {
  const f = new Uint8Array(16)
  f[0] = 0x83
  f[1] = 0x04
  // bytes 2..15 are 0; keepHead=8 so omit from index 8..15 = 8 zeros
  const s = toHexOmitTrailingZeros(f, { keepHead: 8 })
  assert(s.includes('83 04'), s)
  assert(s.includes('省略 8 个 00'), s)
  // first 8 always present even if zero
  const z = new Uint8Array(12)
  const sz = toHexOmitTrailingZeros(z, { keepHead: 8 })
  assert(sz.startsWith('00 00 00 00 00 00 00 00'), sz)
  assert(sz.includes('省略 4 个 00'), sz)

  const d = toDecOmitTrailingZeros(Uint8Array.from([0x5c, 0x04, 0x12, 0xa6, 0, 0, 0xff, 0xff, 0, 0]), {
    keepHead: 8,
  })
  assert(d.startsWith('92 4 18 166 0 0 255 255'), d)
  assert(d.includes('省略 2 个 0'), d)

  const tail = new Uint8Array(16)
  tail[0] = 0x01
  tail[1] = 0x02
  tail[15] = 0x70
  const ts = toHexOmitTrailingZeros(tail, { keepHead: 8 })
  assert(ts.includes('省略'), ts)
  assert(ts.endsWith('70'), ts)
  assert(!ts.includes(' 48 '), ts)

  const parsed = parseHexBytes('01 01 02 29 02 01 05 05 FF 00 01 02 00 00 … (省略 48 个 00) 70')
  assert(parsed.length === 63, `omit expand len ${parsed.length}`)
  assert(parsed[parsed.length - 1] === 0x70, 'omit keeps tail 70')
  assert(!parsed.includes(0x48), 'omit must not parse 48 as hex')
  assert(parsed[0] === 0x01 && parsed[3] === 0x29, 'omit prefix')

  assert(parseReportIdText('') === undefined, 'empty RID auto')
  assert(parseReportIdText('10') === 0x0a, 'RID decimal 10')
  assert(parseReportIdText('0x0A') === 0x0a, 'RID 0x0A')
  assert(parseReportIdText('0A') === 0x0a, 'RID 0A')
  assert(parseReportIdText('9') === 9, 'RID 9')
  assert(formatReportIdText(10) === '0x0A', 'format RID')
}

function testRyCs() {
  const frame = buildFrame(0x8f)
  assert(frame.length === 64, 'RY frame len')
  assert(frame[7] === 0x70, `CS expect 0x70 got 0x${frame[7].toString(16)}`)
  assert(checksum(frame.subarray(0, 7)) === 0x70, 'checksum fn')

  // params fill Byte1..6
  const rate = buildFrame(0x03, [0, 3])
  assert(rate[0] === 0x03 && rate[1] === 0 && rate[2] === 3, 'report params')
  assert(rate[7] === checksum(rate.subarray(0, 7)), 'report CS@7')

  // 灯效 CS@8
  const led = buildLedParamFrame(0x07, { effect: 0, speed: 2, bri: 3, r: 0xff, g: 0xff, b: 0xff })
  assert(led[7] === 0xff, 'LED B stays at byte7')
  assert(led[8] === checksum(led, 8), `LED CS@8 got 0x${led[8].toString(16)}`)

  // 睡眠默认负载小端
  const sleep = buildFrame(0x11, [], defaultSleepPayload())
  assert(sleep[8] === 0x78 && sleep[9] === 0x00, 'sleep1 BT=120')
  assert(sleep[12] === 0x08 && sleep[13] === 0x07, 'deep BT=1800')
}

function testRyPresets() {
  const ry = getProtocol('ry5088')
  const kb = getProtocol('kb250718')
  assert(ry.presets.length >= 20, `ry presets ${ry.presets.length}`)
  assert(kb.presets.length >= 20, `kb presets ${kb.presets.length}`)
  const ids = ry.presets.map((p) => p.id)
  assert(ids.includes('set_sleep_default'), 'has sleep set')
  assert(ids.includes('set_led_main'), 'has led set')
  assert(ids.includes('axis_actuation'), 'has axis read')
  assert(ids.includes('feature_list'), 'has feature list')

  const sleepPreset = ry.presets.find((p) => p.id === 'set_sleep_default')!
  const sleepFrame = sleepPreset.build!()
  assert(sleepFrame[0] === 0x11, 'sleep cmd')
  assert(sleepFrame[8] === 0x78 && sleepFrame[12] === 0x08, 'sleep defaults')

  // 实机样例：91 … 6E 2C 01 2C 01 B0 04 08 07
  const sample = new Uint8Array(64)
  sample.set([0x91, 0, 0, 0, 0, 0, 0, 0x6e, 0x2c, 0x01, 0x2c, 0x01, 0xb0, 0x04, 0x08, 0x07])
  const rySleep = parseRy5088Response(0x91, sample)
  assert(rySleep.includes('300s'), rySleep)
  assert(rySleep.includes('1200s'), rySleep)
  assert(rySleep.includes('1800s'), rySleep)
  const kbSleep = parseKb250718Response(0x91, sample)
  assert(kbSleep.includes('300s'), kbSleep)
}

function testRyReportRate() {
  const req = buildRyGetReportRateFrame()
  assert(req[0] === 0x83 && req.length === 64, '0x83 request frame')
  assert(req[7] === checksum(req.subarray(0, 7)), '0x83 CS')

  // 磁轴：Byte0=0x83, Byte2=3 → 1000Hz
  const he = new Uint8Array(64)
  he[0] = 0x83
  he[2] = 3
  assert(parseRyReportRateHz(he, 'he') === 1000, 'HE 1000')
  assert(parseRyReportRateHz(he, 'auto') === 1000, 'auto HE 1000')
  he[2] = 0
  assert(parseRyReportRateHz(he, 'auto') === 8000, 'auto HE 8000')
  assert(parseRy5088Response(0x83, he).includes('8000 Hz'), 'HE text')

  // 键盘：Byte0=00, Byte1=1 → 500Hz
  const kb = new Uint8Array(64)
  kb[1] = 1
  assert(parseRyReportRateHz(kb, 'std') === 500, 'STD 500')
  assert(parseRyReportRateHz(kb, 'auto') === 500, 'auto STD 500')
  assert(parseKb250718Response(0x83, kb).includes('500 Hz'), 'STD text')

  // 首字节是 Report ID 0，真正的 0x83 从 Byte1 开始
  const prefixed = new Uint8Array(64)
  prefixed[0] = 0
  prefixed[1] = 0x83
  prefixed[2] = 0
  prefixed[3] = 3
  assert(parseRyReportRateHz(prefixed, 'he') === 1000, 'prefixed HE 1000')
  assert(parseRyReportRateHz(prefixed, 'auto') === 1000, 'prefixed auto 1000')
  assert(parseRy5088Response(0x83, prefixed).includes('1000 Hz'), 'prefixed HE text')

  assert(shouldProbeRyReportRate('2E3C'), 'probe RY VID')
  assert(!shouldProbeRyReportRate('258A'), 'skip BeiYing VID')
  assert(!shouldProbeRyReportRate('1CA2'), 'skip SparkLink VID')
}

function testGetInforOffsets() {
  const ry = new Uint8Array(64)
  ry[0] = 0x8f
  ry[1] = 0x12
  ry[2] = 0x34
  ry[3] = 0x56
  ry[4] = 0x78
  ry[5] = 6 // USB
  ry[6] = 0
  ry[7] = 0x0a
  ry[8] = 0x01
  const ryText = parseRy5088Response(0x8f, ry)
  assert(ryText.includes('12345678'), `RY id parse: ${ryText}`)
  assert(ryText.includes('USB'), `RY link: ${ryText}`)
  assert(ryText.includes('版本=010A'), `RY ver H then L hex: ${ryText}`)

  const kb = new Uint8Array(64)
  kb[0] = 0xaa
  kb[1] = 0xbb
  kb[2] = 0xcc
  kb[3] = 0xdd
  kb[4] = 6
  kb[5] = 0
  kb[6] = 0x0a
  kb[7] = 0x01
  const kbText = parseKb250718Response(0x8f, kb)
  assert(kbText.includes('AABBCCDD'), `KB id parse: ${kbText}`)
  assert(!kbText.includes('Cmd='), `KB should not echo cmd: ${kbText}`)
  assert(kbText.includes('版本=010A'), `KB ver H then L hex: ${kbText}`)
}

function testBeiYing() {
  // Example reset body: 11 00 00 01 00 01 00 00 …
  const frame = buildBeiYingFrame({
    cmd: 0x11,
    packs: 1,
    seq: 0,
    payload: [0x00],
  })
  assert(frame.length === BODY_LEN, 'BY body len')
  assert(frame[0] === 0x11, 'cmd')
  assert(frame[3] === 1, 'packs')
  assert(frame[4] === 0, 'seq')
  assert(frame[5] === 1 && frame[6] === 0, 'len=1')
  assert(frame[7] === 0x00, 'payload')

  const parsed = parseBeiYingResponse(0x11, frame)
  assert(parsed.includes('负载长度=1'), parsed)

  // Doc example: 09 83 04 01 01 00 F8 01 → body without Report ID
  const matrix = buildBeiYingFrame({
    cmd: 0x83,
    param: 0x04,
    board: 0x01,
    packs: 1,
    seq: 0,
    dataLen: 504,
  })
  assert(matrix[0] === 0x83, 'matrix cmd')
  assert(matrix[1] === 0x04, 'matrix param mac/normal')
  assert(matrix[2] === 0x01, 'matrix board')
  assert(matrix[5] === 0xf8 && matrix[6] === 0x01, 'matrix len 504')

  // Fill synthetic matrix: key i → [i&0xff, 0, 0, 0]; verify col-major grid
  const payload = new Uint8Array(504)
  for (let i = 0; i < 126; i++) payload[i * 4] = i & 0xff
  const rx = new Uint8Array(8 + 504)
  rx[0] = 0x09
  rx.set(matrix.subarray(0, 7), 1)
  rx.set(payload, 8)
  const matrixParsed = parseBeiYingResponse(0x83, rx)
  assert(matrixParsed.includes('表=Mac/Normal'), matrixParsed)
  assert(matrixParsed.includes('6行×21列'), matrixParsed)
  const gridLines = matrixParsed.split('\n').filter((l) => /^[0-9A-F-]{8}/.test(l))
  assert(gridLines.length === 6, `grid rows ${gridLines.length}`)
  const r0 = gridLines[0].split(/\s+/)
  assert(r0.length === 21, `grid cols ${r0.length}`)
  assert(r0[0] === '00000000', `k0=${r0[0]}`) // 第1键 r1c1
  assert(r0[1] === '06000000', `k7=${r0[1]}`) // 第7键 r1c2
  assert(gridLines[1].split(/\s+/)[0] === '01000000', '第2键 r2c1')

  const presets = getProtocol('beiying').presets
  assert(presets.length >= 15, `preset count ${presets.length}`)
  const ids = presets.map((p) => p.id)
  assert(ids.includes('read_matrix_mac_normal'), 'has matrix mac')
  assert(ids.includes('read_battery'), 'has battery')
  assert(ids.includes('read_board'), 'has board')
  assert(ids.includes('read_light_colors'), 'has light colors')
}

function testRk9007() {
  const matrix = buildRk9007Frame({
    cmd: RK9007_CMD.GET_MATRIX,
    param: 0,
    dataLen: RK9007_MATRIX_LEN,
  })
  assert(matrix.length === 519, '9007 body 519')
  assert(matrix[0] === 0x81, 'matrix cmd 0x81')
  assert(matrix[1] === 0x00, 'win layer')
  assert(matrix[2] === 0x00, 'reserved 0')
  assert(matrix[3] === 1 && matrix[4] === 0, 'packs/seq')
  assert(matrix[5] === 0xf8 && matrix[6] === 0x01, 'len 504')

  const cfg = buildRk9007Frame({
    cmd: RK9007_CMD.GET_CONFIG,
    dataLen: RK9007_CONFIG_LEN,
  })
  assert(cfg[0] === 0x83 && cfg[5] === 0x29 && cfg[6] === 0, 'config len 41')

  const factory = buildRk9007Frame({ cmd: RK9007_CMD.FACTORY, dataLen: 1 })
  assert(factory[0] === 0x05 && factory[5] === 1, 'factory')

  const payload = new Uint8Array(RK9007_CONFIG_LEN)
  payload[0] = 1
  payload[1] = 3
  payload[35] = 1
  payload[36] = 25
  const rx = new Uint8Array(7 + RK9007_CONFIG_LEN)
  rx[0] = 0x83
  rx[3] = 1
  rx[5] = RK9007_CONFIG_LEN
  rx.set(payload, 7)
  const text = parseRk9007Response(0x83, rx)
  assert(text.includes('键模式=Mac'), text)
  assert(text.includes('版本=1.25'), text)

  const rk = getProtocol('rk9007')
  assert(rk.reportId === 0x09, '9007 report 0x09')
  assert(rk.bodyLen === 519, '9007 bodyLen')
  assert(rk.usagePageHint === 0xff00, '9007 FF00')
  const ids = rk.presets.map((p) => p.id)
  assert(ids.includes('read_matrix_win'), '9007 matrix')
  assert(ids.includes('read_config'), '9007 config')
  assert(ids.includes('read_led_colors'), '9007 led')
  assert(ids.includes('factory_reset'), '9007 factory')
  assert(ids.includes('write_config_default'), '9007 write cfg')
  assert(ids.includes('oa_light_cfg_pkt1'), '9007 oa light')
  assert(ids.includes('oa_set_brightness'), '9007 oa brightness')
  assert(ids.includes('oa_keys_pkt1'), '9007 oa keys')

  const oaPreset = rk.presets.find((p) => p.id === 'oa_light_cfg_pkt1')!
  assert(oaPreset.reportId === 0x0a && oaPreset.bodyLen === 64, 'oa wire override')

  const bri = buildRk9007OaLightBrightnessFrame(5)
  assert(bri.length === RK9007_OA_BODY_LEN, 'oa bri 64')
  assert(bri[0] === 0x01 && bri[1] === 1 && bri[2] === 2 && bri[3] === 0x29, 'oa bri hdr')
  assert(bri[4] === 0x02 && bri[6] === 5 && bri[7] === 5 && bri[8] === 0xff, 'oa bri payload')
  assert(bri[63] === 0x70, 'oa bri tail')
  const briText = parseRk9007Response(0x01, bri)
  assert(briText.includes('亮度=5'), briText)

  const dumped = toHexOmitTrailingZeros(bri, { keepHead: 8 })
  const round = parseHexBytes(dumped)
  assert(round.length === 64 && round[63] === 0x70, 'oa bri omit roundtrip')
  assert(round[7] === 5, 'oa bri byte7')

  const oa = buildRk9007OaFrame({
    cmd: RK9007_OA_CMD.LIGHT,
    seq: 1,
    packs: 2,
    dataLen: 0x29,
    data: new Uint8Array([1, 1, 5, 5]),
  })
  assert(oa.length === RK9007_OA_BODY_LEN, 'oa 64')
  assert(oa[0] === 0x01 && oa[1] === 1 && oa[2] === 2 && oa[3] === 0x29, 'oa light hdr')
  const oaText = parseRk9007Response(0x01, oa)
  assert(oaText.includes('通道=0x0A/64'), oaText)
  assert(oaText.includes('CMD=0x01'), oaText)
}

async function testHs() {
  const frame = buildHsFrame({ cmd: HS_CMD.HW_INFO, type: 0x01 })
  assert(frame.length === HS_FRAME_LEN, 'HS frame len')
  assert(frame[0] === 0x83 && frame[1] === 0x01, 'HS version req')

  const rgbColor = buildHsFrame({
    cmd: HS_CMD.LIGHT_RGB_MAIN,
    type: 0x06,
    payload: [0x00, 0xff],
  })
  assert(rgbColor[0] === 0x85 && rgbColor[1] === 0x06, 'RGB set_color cmd')
  assert(rgbColor[2] === 0x00 && rgbColor[3] === 0xff, 'RGB HUE/SAT')

  const monoSide = buildHsFrame({ cmd: HS_CMD.LIGHT_MONO_SIDE, type: 0x01 })
  assert(monoSide[0] === 0x87, 'mono side CMD')

  // get_status: CMD + type + enable + mode + brightness + speed + HUE + SAT
  const statusRx = Uint8Array.from([0x85, 0x01, 1, 2, 0x80, 5, 0x10, 0xff])
  const statusText = parseHsResponse(0x85, statusRx)
  assert(statusText.includes('RGB主灯区'), statusText)
  assert(statusText.includes('使能=1'), statusText)
  assert(statusText.includes('HUE=16'), statusText)

  // version: LE dword 11 00 00 00 → low16 0x0011 = 0.0.11（实机 342D 回包）
  const verRx = Uint8Array.from([0x83, 0x01, 0x11, 0x00, 0x00, 0x00])
  const verText = parseHsResponse(0x83, verRx)
  assert(verText.includes('版本=0.0.11'), verText)

  const hs = getProtocol('hs')
  assert(hs.bodyLen === 32, 'HS bodyLen 32')
  assert(hs.channel === 'output', 'HS channel output')
  assert(hs.usagePageHint === 0xff00, 'HS usagePage FF00')
  assert(hs.vids?.includes('342D'), 'HS VID 342D')
  assert(hs.checksum === 'none', 'HS checksum none')
  const ids = hs.presets.map((p) => p.id)
  assert(ids.includes('get_version'), 'HS has version')
  assert(ids.includes('rgb_main_status'), 'HS has rgb status')
  assert(ids.includes('keymap_layers'), 'HS has keymap')
  assert(ids.includes('keymap_dump_all'), 'HS has keymap dump')
  assert(ids.includes('custom_rgb_status'), 'HS has custom rgb')

  const pkg0 = buildHsGetBufferFrame(0, HS_READ_LEN_PER_PACKAGE)
  assert(pkg0[0] === 0x82 && pkg0[1] === 0x01, 'get_buffer cmd')
  assert(pkg0[2] === 0 && pkg0[3] === 0 && pkg0[4] === 0x1c, 'get_buffer addr/len')

  // 模拟分包：填假数据并验证格式
  const fake = new Uint8Array(HS_KEYMAP_TOTAL_BYTES)
  fake[0] = 41
  fake[1] = 0 // key0 = 41
  fake[2] = 0x01
  fake[3] = 0x51 // key1 = 0x5101 = 20737
  const layers = parseHsKeyBufferToLayers(fake)
  assert(layers.length === 4 && layers[0].length === 126, 'layer shape')
  assert(layers[0][0] === 41 && layers[0][1] === 20737, 'LE keycodes')
  const text = formatHsLayersAsCopyableArrays(layers)
  assert(text.includes('层0:'), text)
  assert(text.includes('[\n  41,20737,'), text)

  const payload = extractHsGetBufferPayload(
    Uint8Array.from([0x82, 0x01, 0x29, 0x00, 0xaa]),
    2,
  )
  assert(payload[0] === 0x29 && payload[1] === 0x00, 'extract payload')

  let calls = 0
  await dumpHsKeymapBuffer(async (frame) => {
    calls += 1
    assert(frame[0] === 0x82 && frame[1] === 0x01, 'dump tx')
    const addr = frame[2]! | (frame[3]! << 8)
    const len = frame[4]!
    const rx = new Uint8Array(32)
    rx[0] = 0x82
    rx[1] = 0x01
    for (let i = 0; i < len; i++) rx[2 + i] = (addr + i) & 0xff
    return rx
  }, { gapMs: 0 })
  assert(calls === Math.ceil(HS_KEYMAP_TOTAL_BYTES / HS_READ_LEN_PER_PACKAGE), `dump pkgs ${calls}`)
}

async function testJp() {
  const info = buildJpGetInfo(0)
  assert(info.length === JP_FRAME_LEN, 'JP frame len')
  assert(info[0] === 0x01 && info[1] === 0x00, 'JP get_info')

  // 文档示例：01 00 0D 03 B5 09 00 30 00 80 00 00 00 10 00 00
  const rx = Uint8Array.from([
    0x01, 0x00, 0x0d, 0x03, 0xb5, 0x09, 0x00, 0x30, 0x00, 0x80, 0x00, 0x00, 0x00, 0x10, 0x00,
    0x00,
  ])
  const text = parseJpResponse(0x01, rx)
  assert(text.includes('GET_INFO'), text)
  assert(text.includes('ChipID=0x300009B5'), text)
  assert(text.includes('Flash=32768B'), text)
  assert(text.includes('SRAM=4096B'), text)

  const erase = buildJpErase(0x00, 0x08001000, 2)
  assert(erase[0] === 0x5e && erase[1] === 0x00, 'erase cmd')
  assert(erase[4] === 0x00 && erase[5] === 0x10 && erase[6] === 0x00 && erase[7] === 0x08, 'erase addr')
  assert(erase[8] === 0x02, 'erase pages')

  const read = buildJpRead(0x08000000, 16)
  assert(read[0] === JP_CMD.READ, 'read cmd')
  assert(read[8] === 16 && read[9] === 0, 'read len')

  const chip = buildJpErase(0xf0)
  assert(chip[1] === 0xf0, 'chip erase')

  const short = buildJpFrame({ cmd: 0x01, payload: [0] })
  assert(short.length === 64 && short[0] === 0x01, 'pad 64')

  // 上位机 64B get_buffer / 版本解析
  const gb = buildJpGetBufferFrame(0, 0x1c)
  assert(gb.length === 64 && gb[0] === 0x82 && gb[1] === 0x01 && gb[4] === 0x1c, 'JP host get_buffer')
  const verText = parseJpResponse(0x83, Uint8Array.from([0x83, 0x01, 0x03, 0x12, 0x00, 0x00]))
  assert(verText.includes('get_version') || verText.includes('版本'), verText)
  const rgb = buildJpHostFrame(JP_HOST_CMD.LIGHT_RGB_MAIN, 0x06, [0, 0xff])
  assert(rgb[0] === 0x85 && rgb[1] === 0x06 && rgb[3] === 0xff, 'JP host rgb color')

  const jp = getProtocol('jp')
  assert(jp.bodyLen === 64, 'JP bodyLen')
  assert(jp.channel === 'auto', 'JP channel auto')
  assert(jp.checksum === 'none', 'JP checksum')
  assert(jp.vids?.includes('0603'), 'JP VID 0603')
  const ids = jp.presets.map((p) => p.id)
  assert(ids.includes('get_info_boot'), 'JP has get_info')
  assert(ids.includes('host_get_version'), 'JP has host version')
  assert(ids.includes('keymap_dump_all'), 'JP has keymap dump')
  assert(ids.includes('read_flash'), 'JP has read')
  assert(ids.includes('erase_chip'), 'JP has erase')
}

async function testSparklink() {
  const sync = buildSlkSync()
  assert(sync.length === SLK_FRAME_LEN, 'SLK frame len')
  assert(sync[0] === SLK_HEAD && sync[2] === SLK_CMD.SYNC, 'SLK sync head/cmd')
  assert(sync[1] === 6, 'SLK sync len=6')
  // crc = 0x35+0x5c+6+0x01+0xff = 0x197 → 0x97
  assert(sync[3] === 0x97, `SLK sync crc got 0x${sync[3]!.toString(16)}`)
  assert(computeSlkCrc(6, 0x01, [1, 2, 3, 4, 0xff, 0xff]) === 0x97, 'SLK crc fn')

  const ver = buildSlkCmd(SLK_ORDER.PROTOCOL_VERSION)
  assert(ver[0] === SLK_HEAD && ver[2] === SLK_CMD.CMD, 'SLK cmd')
  assert(ver[1] === 3 && ver[4] === 0x01, 'SLK version payload')
  assert(ver[3] === computeSlkCrc(3, 0, [0x01, 0xff, 0xff]), 'SLK version crc')

  const parsed = parseSlkFrame(sync)
  assert(parsed && parsed.cmdReq === SLK_CMD.SYNC && parsed.crcOk, 'parse sync')

  // 模拟应答：cmd|0x80
  const rx = new Uint8Array(64)
  rx.set([0x5c, 0x04, 0x81, 0, 0xaa, 0xbb, 0xcc, 0xdd])
  rx[3] = computeSlkCrc(4, 0x81, [0xaa, 0xbb, 0xcc, 0xdd])
  const text = parseSlkResponse(0x01, rx)
  assert(text.includes('SYNC'), text)
  assert(text.includes('crc='), text)
  assert(text.includes('OK'), text)

  // 多包未收齐：不应误报「校验失败」
  const shortRm = new Uint8Array(64)
  shortRm.set([0x5c, 0x82, 0x92, 0xa4, 0x04])
  const shortText = parseSlkResponse(0x12, shortRm)
  assert(shortText.includes('数据未收齐'), shortText)
  assert(!shortText.includes('校验失败'), shortText)

  // 收齐后：末字节 0xFF → CRC 0xA4
  const fullRm = new Uint8Array(4 + 0x82)
  fullRm[0] = 0x5c
  fullRm[1] = 0x82
  fullRm[2] = 0x92
  fullRm[3] = 0xa4
  fullRm[4] = 0x04
  fullRm[4 + 0x82 - 1] = 0xff
  assert(computeSlkCrc(0x82, 0x92, fullRm.slice(4)) === 0xa4, 'rm6x21 crc')
  const fullParsed = parseSlkFrame(fullRm)
  assert(fullParsed && fullParsed.complete && fullParsed.crcOk, 'rm6x21 complete crc ok')
  assert(slkAssembleTargetBytes(shortRm) === 4 + 0x82, 'assemble target')

  const slk = getProtocol('sparklink')
  assert(slk.bodyLen === 64, 'SLK bodyLen')
  assert(slk.channel === 'output', 'SLK channel output')
  assert(slk.usagePageHint === 0xffb0, 'SLK usagePage FFB0')
  assert(slk.vids?.includes('1CA2'), 'SLK VID 1CA2')
  assert(slk.checksum === 'none', 'SLK checksum')
  const ids = slk.presets.map((p) => p.id)
  assert(ids.includes('sync'), 'SLK has sync')
  assert(ids.includes('protocol_version'), 'SLK has version')
  assert(ids.includes('defkey_dump_all'), 'SLK has defkey dump')
  assert(ids.includes('defkey_r01'), 'SLK has defkey row01')
  assert(ids.includes('key_fn0'), 'SLK has KEY FN0')
  assert(ids.includes('rm6x21_fn3'), 'SLK has RM6X21 FN3')
  assert(!ids.includes('rm6x21_fn0'), 'SLK no misleading FN0 RM6X21')

  const keyFn0 = slk.presets.find((p) => p.id === 'key_fn0')!.build!()
  assert(keyFn0[2] === SLK_CMD.KEY && keyFn0[4] === 0x00 && keyFn0[5] === 0xff, 'KEY FN0 payload')
  assert(keyFn0[6] === 0x00 && keyFn0[7] === 0xff, 'KEY FN0 layout/new')

  const defR01 = slk.presets.find((p) => p.id === 'defkey_r01')!.build!()
  assert(defR01[2] === SLK_CMD.DEFKEY && defR01[5] === 0 && defR01[6] === 1, 'DEFKEY r01')

  const defPayload = Uint8Array.from([
    0x00, 0x00, 0x29, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45,
    0x00, 0x46, 0x49, 0x4d, 0x4a, 0x00, 0x00, 0x00, 0x01, 0x35, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23,
    0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e, 0x2a, 0x4c, 0x00, 0x00, 0x53, 0x54, 0x55, 0x56,
  ])
  const def = parseSlkDefKeyPayload(defPayload)
  assert(def && def.rows[0]!.keys[0] === 0x29, 'defkey Esc')

  let calls = 0
  const dump = await dumpSlkDefKeyMatrix(
    async (frame) => {
      calls += 1
      assert(frame[0] === 0x5c && frame[2] === SLK_CMD.DEFKEY, 'defkey tx')
      const r1 = frame[5]!
      const r2 = frame[6]!
      const payload = new Uint8Array(45)
      payload[0] = 0
      payload[1] = r1
      payload[2] = 0x10 + r1
      payload[1 + 1 + 21] = r2
      payload[1 + 1 + 21 + 1] = 0x20 + r2
      const rx = new Uint8Array(64)
      rx[0] = 0x5c
      rx[1] = 45
      rx[2] = 0xab
      rx.set(payload, 4)
      rx[3] = computeSlkCrc(45, 0xab, payload)
      return rx
    },
    { gapMs: 0 },
  )
  assert(calls === 3, `defkey pkgs ${calls}`)
  assert(dump.matrix[0]![0] === 0x10 && dump.matrix[1]![0] === 0x21, 'defkey matrix fill')
  assert(dump.text.includes('默认键值:'), dump.text)
  assert(dump.text.includes('[\n  10,'), dump.text)
  const fmt = formatSlkDefKeyAsCopyableArrays([
    [0x29, 0x3a],
    [0x35, 0x1e],
    [],
    [],
    [],
    [],
  ])
  assert(fmt.includes('29,3A,'), fmt)
}

function testRegistry() {
  const ids = listProtocols().map((p) => p.id)
  assert(ids.includes('ry5088'), 'has ry5088')
  assert(ids.includes('kb250718'), 'has kb250718')
  assert(ids.includes('beiying'), 'has beiying')
  assert(ids.includes('rk9007'), 'has rk9007')
  assert(!ids.includes('rk9007oa'), 'no separate rk9007oa')
  assert(ids.includes('hs'), 'has hs')
  assert(ids.includes('jp'), 'has jp')
  assert(ids.includes('sparklink'), 'has sparklink')
  assert(ids.includes('custom'), 'has custom')
  assert(getProtocol('beiying').reportId === 0x09, 'BY report id default')
  assert(getProtocol('beiying').bodyLen === 519, 'BY body len')
  assert(getProtocol('beiying').vids?.includes('258A'), 'BY VID 258A')
  assert(getProtocol('rk9007').label.includes('9007'), '9007 label')
  assert(getProtocol('rk9007').presets.some((p) => p.id.startsWith('oa_')), '9007 has oa presets')
  assert(getProtocol('hs').label.includes('航晟'), 'HS label')
  assert(getProtocol('jp').label.includes('巨朋'), 'JP label')
  assert(getProtocol('jp').vids?.includes('0603'), 'JP VID in registry')
  assert(getProtocol('sparklink').label.includes('星闪'), 'SLK label')
  assert(getProtocol('sparklink').usagePageHint === 0xffb0, 'SLK FFB0 in registry')
  assert(getProtocol('sparklink').vids?.includes('1CA2'), 'SLK VID in registry')

  const custom = getProtocol('custom')
  assert(custom.reportId === 0, 'custom default report id 0')
  const short = custom.parseHex('8F 00', 0)
  assert(short.length === 2 && short[0] === 0x8f, 'custom variable length')
  const padded = custom.parseHex('8F', 64)
  assert(padded.length === 64 && padded[0] === 0x8f, 'custom pad to bodyLen')
}

async function main() {
  testOmitTrailingZeros()
  testRyCs()
  testRyReportRate()
  testGetInforOffsets()
  testRyPresets()
  testBeiYing()
  testRk9007()
  await testHs()
  await testJp()
  await testSparklink()
  testRegistry()
  console.log('protocol selftest OK')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
