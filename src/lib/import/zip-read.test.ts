/**
 * ZIP 읽기 — 잔여 묶음 8m-2a (순수)
 *
 *   ① 우리 내보내기의 ZIP(저장 · deflate · UTF-8 이름)을 그대로 읽는다 · 폴더 · 찌꺼기(`__MACOSX` · `.DS_Store`)는 지나간다
 *   ② 항목 하나의 문제는 그 항목만 건너뛰고 적는다 — 안전하지 않은 경로 · 암호 · 모르는 압축 · 깨진 데이터(CRC)
 *   ③ 이름 — UTF-8 표시가 없어도 UTF-8 이면 UTF-8, 아니면 CP949 · 역슬래시는 구분자
 *   ④ 통째로 거부 — ZIP 이 아니다 · 항목 수 상한 · 선언된 풀린 크기의 합 상한(폭탄) · 헤더가 거짓말해도 선언 크기 이상은 풀지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateRawSync } from 'node:zlib'

import { createZipWriter } from '../export/zip.ts'
import { readZip } from './zip-read.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

function ours(files: readonly [string, string][]): Uint8Array {
  const zip = createZipWriter()
  const parts: Uint8Array[] = []
  for (const [path, text] of files) parts.push(...zip.add(path, text))
  parts.push(zip.finish())
  return Buffer.concat(parts)
}

type Raw = { name: Uint8Array; data: Uint8Array; flags?: number; method?: number; crc?: number; size?: number }

/** 손으로 만든 ZIP — 플래그 · 이름 바이트 · CRC · 선언 크기를 마음대로. 데이터는 넘긴 그대로(압축은 부르는 쪽이). */
function raw(entries: readonly Raw[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const flags = e.flags ?? 0
    const method = e.method ?? 0
    const crc = e.crc ?? crc32(e.data)
    const size = e.size ?? e.data.byteLength
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(e.data.byteLength, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(e.name.byteLength, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(e.data.byteLength, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(e.name.byteLength, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, Buffer.from(e.name), Buffer.from(e.data))
    centrals.push(central, Buffer.from(e.name))
    offset += 30 + e.name.byteLength + e.data.byteLength
  }
  const centralBytes = Buffer.concat(centrals)
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(entries.length, 8)
  endRecord.writeUInt16LE(entries.length, 10)
  endRecord.writeUInt32LE(centralBytes.byteLength, 12)
  endRecord.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, endRecord])
}

const textOf = (result: ReturnType<typeof readZip>) =>
  result.ok ? result.entries.map((e) => [e.path, dec.decode(e.bytes)]) : result.reason

test('★ ① 우리 내보내기의 ZIP 을 읽는다 · 폴더와 찌꺼기는 지나간다', () => {
  const long = '긴 본문 '.repeat(500)
  const zip = ours([['회의록.md', '# 회의록'], ['회의록/하위.md', long], ['__MACOSX/._회의록.md', 'junk'], ['회의록/.DS_Store', 'junk']])
  const result = readZip(zip)
  assert.deepEqual(textOf(result), [['회의록.md', '# 회의록'], ['회의록/하위.md', long]])
  assert.ok(result.ok && result.skipped.length === 0)
})

test('★ ② 항목 하나의 문제는 그것만 건너뛰고 적는다', () => {
  const good = enc.encode('ok')
  const zip = raw([
    { name: enc.encode('../밖.md'), data: good },
    { name: enc.encode('C:/드라이브.md'), data: good },
    { name: enc.encode('잠김.md'), data: good, flags: 1 },
    { name: enc.encode('이상한압축.md'), data: good, method: 12 },
    { name: enc.encode('깨짐.md'), data: good, crc: 12345 },
    { name: enc.encode('멀쩡.md'), data: good },
  ])
  const result = readZip(zip)
  assert.ok(result.ok)
  assert.deepEqual(result.entries.map((e) => e.path), ['멀쩡.md'])
  assert.deepEqual(
    result.skipped.map((s) => [s.path, s.reason]),
    [['../밖.md', 'unsafe_path'], ['C:/드라이브.md', 'unsafe_path'], ['잠김.md', 'encrypted'], ['이상한압축.md', 'unsupported_compression'], ['깨짐.md', 'corrupt']],
  )
})

test('★ ③ 이름 — UTF-8 표시가 없어도 UTF-8 · 아니면 CP949 · 역슬래시는 구분자', () => {
  const cp949 = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74]) // "한글.txt" (CP949)
  const zip = raw([
    { name: enc.encode('표시없음.md'), data: enc.encode('a') },
    { name: cp949, data: enc.encode('b') },
    { name: enc.encode('폴더\\안.md'), data: enc.encode('c') },
  ])
  assert.deepEqual(textOf(readZip(zip)), [['표시없음.md', 'a'], ['한글.txt', 'b'], ['폴더/안.md', 'c']])
})

test('★ ④ 통째로 거부 — ZIP 이 아니다 · 항목 수 · 풀린 크기의 합 · 거짓말하는 헤더', () => {
  assert.deepEqual(readZip(enc.encode('not a zip at all, just text....')), { ok: false, reason: 'not_zip' })
  const three = ours([['a.md', 'a'], ['b.md', 'b'], ['c.md', 'c']])
  assert.deepEqual(readZip(three, { maxEntries: 2, maxTotalBytes: 1e9 }), { ok: false, reason: 'too_many_entries' })
  assert.deepEqual(readZip(three, { maxEntries: 10, maxTotalBytes: 2 }), { ok: false, reason: 'too_large' })

  // 10 MB 의 0 을 100 바이트라고 선언 — 선언 크기를 넘는 출력은 풀지 않는다
  const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024))
  const lying = raw([{ name: enc.encode('폭탄.md'), data: bomb, method: 8, size: 100, crc: 0 }])
  const result = readZip(lying)
  assert.ok(result.ok)
  assert.deepEqual(result.skipped.map((s) => s.reason), ['corrupt'])
})
