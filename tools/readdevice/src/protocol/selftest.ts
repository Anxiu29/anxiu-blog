import { toHexOmitTrailingZeros } from './types'
import { buildBeiYingFrame, parseBeiYingResponse, BODY_LEN } from './beiying'
import { buildFrame, checksum, parseKb250718Response, parseRy5088Response } from './ryCommon'
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
}

function testRyCs() {
  const frame = buildFrame(0x8f)
  assert(frame.length === 64, 'RY frame len')
  assert(frame[7] === 0x70, `CS expect 0x70 got 0x${frame[7].toString(16)}`)
  assert(checksum(frame.subarray(0, 7)) === 0x70, 'checksum fn')
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

function testRegistry() {
  const ids = listProtocols().map((p) => p.id)
  assert(ids.includes('ry5088'), 'has ry5088')
  assert(ids.includes('kb250718'), 'has kb250718')
  assert(ids.includes('beiying'), 'has beiying')
  assert(ids.includes('custom'), 'has custom')
  assert(getProtocol('beiying').reportId === 0x09, 'BY report id default')
  assert(getProtocol('beiying').bodyLen === 519, 'BY body len')
  assert(getProtocol('beiying').vids?.includes('258A'), 'BY VID 258A')
}

testOmitTrailingZeros()
testRyCs()
testGetInforOffsets()
testBeiYing()
testRegistry()
console.log('protocol selftest OK')
