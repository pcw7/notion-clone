/**
 * ZIP 쓰기 — F-09-14 (DB 없음)
 *
 * 두 겹으로 읽는다.
 *
 *   ① **이 파일의 읽기 코드** — 헤더 필드를 하나하나 대조한다(로컬 헤더 = 중앙 디렉터리,
 *      위치가 이어지는가, CRC 가 맞는가). 무엇이 어긋났는지 정확히 말해 준다
 *   ② **우리가 짜지 않은 구현** — python `zipfile` · bsdtar · unzip(셋 다 CI 필수). ①은 쓰기와 같은
 *      오해를 공유할 수 있다. 다른 사람이 짠 구현이 같은 이름 · 같은 바이트를 읽어야 끝이다
 *
 * 이 파일이 지키는 것.
 *
 *   ① 한글 이름이 UTF-8 로 표시되어 깨지지 않는다
 *   ② 풀 때 대상 폴더 밖으로 나가는 경로(zip slip)와 서로를 덮는 경로를 거부한다
 *   ③ ZIP64 한계를 넘으면 잘라 쓰지 않고 멈춘다 — 멈춘 뒤에도 쓴 데까지는 올바른 ZIP 이다
 *   ④ 같은 입력이면 같은 바이트다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'

import {
  MAX_ZIP_ENTRIES,
  ZipError,
  createZipWriter,
  dosDateTime,
  type ZipEntryOptions,
  type ZipWriterOptions,
} from './zip.ts'
import {
  findBsdtar,
  findPython,
  hasUnzip,
  run,
  runPythonJson,
  unavailable,
} from '../testing/external-tools.ts'

// ── 도우미 ────────────────────────────────────────────────────────────

type Input = readonly [path: string, data: Uint8Array | string, options?: ZipEntryOptions]

const FIXED = new Date('2026-09-13T12:34:56Z')

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function build(inputs: readonly Input[], options: ZipWriterOptions = { modifiedAt: FIXED }): Uint8Array {
  const zip = createZipWriter(options)
  const chunks: Uint8Array[] = []
  for (const [path, data, entry] of inputs) chunks.push(...zip.add(path, data, entry))
  // `bytesWritten` 은 조립 단계가 예산을 셀 때 믿는 숫자다. 흘려보낸 바이트와 같아야 한다.
  assert.equal(zip.bytesWritten, chunks.reduce((n, c) => n + c.length, 0))
  chunks.push(zip.finish())
  return concat(chunks)
}

type ReadEntry = {
  readonly name: string
  readonly flags: number
  readonly method: number
  readonly time: number
  readonly date: number
  readonly data: Buffer
}

/** APPNOTE §4.3 대로 읽는다. 어긋나면 어느 필드인지 말하며 던진다. */
function readZip(zip: Uint8Array): ReadEntry[] {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = buf.length - 22
  assert.equal(buf.readUInt32LE(end), 0x06054b50, '끝 레코드 서명')
  const count = buf.readUInt16LE(end + 10)
  assert.equal(buf.readUInt16LE(end + 8), count, '이 디스크의 항목 수 = 전체 항목 수')
  const centralSize = buf.readUInt32LE(end + 12)
  const centralOffset = buf.readUInt32LE(end + 16)
  assert.equal(centralOffset + centralSize, end, '중앙 디렉터리 바로 뒤가 끝 레코드다')

  const entries: ReadEntry[] = []
  let at = centralOffset
  let expectedLocal = 0
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, `중앙 헤더 서명 #${i}`)
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const time = buf.readUInt16LE(at + 12)
    const date = buf.readUInt16LE(at + 14)
    const crc = buf.readUInt32LE(at + 16)
    const compressed = buf.readUInt32LE(at + 20)
    const size = buf.readUInt32LE(at + 24)
    const nameLength = buf.readUInt16LE(at + 28)
    const extraLength = buf.readUInt16LE(at + 30)
    const commentLength = buf.readUInt16LE(at + 32)
    const localOffset = buf.readUInt32LE(at + 42)
    const nameBytes = buf.subarray(at + 46, at + 46 + nameLength)

    assert.equal(localOffset, expectedLocal, `로컬 헤더가 앞 항목 바로 뒤에 온다 #${i}`)
    const l = localOffset
    assert.equal(buf.readUInt32LE(l), 0x04034b50, `로컬 헤더 서명 #${i}`)
    assert.equal(buf.readUInt16LE(l + 6), flags, `플래그 일치 #${i}`)
    assert.equal(buf.readUInt16LE(l + 8), method, `방식 일치 #${i}`)
    assert.equal(buf.readUInt32LE(l + 14), crc, `CRC 일치 #${i}`)
    assert.equal(buf.readUInt32LE(l + 18), compressed, `압축 크기 일치 #${i}`)
    assert.equal(buf.readUInt32LE(l + 22), size, `원래 크기 일치 #${i}`)
    assert.equal(buf.readUInt16LE(l + 26), nameLength, `이름 길이 일치 #${i}`)
    const localExtra = buf.readUInt16LE(l + 28)
    assert.ok(buf.subarray(l + 30, l + 30 + nameLength).equals(nameBytes), `이름 바이트 일치 #${i}`)

    const start = l + 30 + nameLength + localExtra
    const body = buf.subarray(start, start + compressed)
    assert.ok(method === 0 || method === 8, `방식은 저장 또는 deflate #${i}`)
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body)
    assert.equal(data.length, size, `풀린 크기 #${i}`)
    assert.equal(crc32(data), crc, `CRC 검증 #${i}`)

    entries.push({ name: nameBytes.toString('utf8'), flags, method, time, date, data })
    expectedLocal = start + compressed
    at += 46 + nameLength + extraLength + commentLength
  }
  assert.equal(expectedLocal, centralOffset, '마지막 항목 바로 뒤가 중앙 디렉터리다')
  return entries
}

const bytesOf = (data: Uint8Array | string): Buffer =>
  typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)

function expectCode(fn: () => unknown, code: ZipError['code']): void {
  assert.throws(fn, (e: unknown) => e instanceof ZipError && e.code === code)
}

// ── 구조 ──────────────────────────────────────────────────────────────

describe('구조', () => {
  test('넣은 이름 · 바이트가 순서대로 돌아온다 · 한글 이름에 UTF-8 플래그가 선다', () => {
    const inputs: Input[] = [
      ['페이지/하위 페이지.md', '# 하위\n\n본문\n'],
      ['사진.png', randomBytes(512), { compress: false }],
      ['빈 파일.txt', ''],
    ]
    const entries = readZip(build(inputs))
    assert.deepEqual(entries.map((e) => e.name), inputs.map(([path]) => path))
    for (const [i, entry] of entries.entries()) {
      assert.ok(entry.data.equals(bytesOf(inputs[i][1])), entry.name)
      assert.equal(entry.flags & 0x0800, 0x0800, `UTF-8 플래그: ${entry.name}`)
    }
  })

  test('줄어드는 것만 deflate 로 쓴다', () => {
    const [text, noise, forced, empty] = readZip(
      build([
        ['a.md', '반복되는 글자 '.repeat(2000)],
        ['b.bin', randomBytes(4096)],
        ['c.md', '반복되는 글자 '.repeat(2000), { compress: false }],
        ['d.txt', ''],
      ]),
    )
    assert.equal(text.method, 8)
    assert.equal(noise.method, 0, '줄지 않는 바이트는 저장으로')
    assert.equal(forced.method, 0, 'compress: false')
    assert.equal(empty.method, 0, '빈 파일')
  })

  test('DOS 시각은 UTC 로 적고 1980 년 이전은 1980-01-01 로 붙인다', () => {
    assert.deepEqual(dosDateTime(FIXED), {
      time: (12 << 11) | (34 << 5) | 28,
      date: ((2026 - 1980) << 9) | (9 << 5) | 13,
    })
    assert.deepEqual(dosDateTime(new Date('1970-01-01T00:00:00Z')), { time: 0, date: (1 << 5) | 1 })
    const [entry] = readZip(build([['a.txt', 'x']]))
    assert.deepEqual({ time: entry.time, date: entry.date }, dosDateTime(FIXED))
  })

  test('같은 입력이면 같은 바이트다', () => {
    const inputs: Input[] = [['a.md', '가나다'.repeat(100)], ['b/c.md', 'x']]
    assert.deepEqual(build(inputs), build(inputs))
    assert.notDeepEqual(build(inputs), build(inputs, { modifiedAt: new Date('2026-01-01T00:00:00Z') }))
  })

  test('빈 ZIP 도 올바른 ZIP 이다', () => {
    assert.deepEqual(readZip(build([])), [])
  })
})

// ── ② 경로 ────────────────────────────────────────────────────────────

describe('② 경로 — 풀 때 밖으로 나가거나 서로를 덮는 경로를 거부한다', () => {
  const UNSAFE = [
    '',
    '/etc/passwd',
    '../밖',
    'a/../../밖',
    '..',
    '.',
    'a/./b',
    'a\\b',
    'a//b',
    '폴더/',
    'C:/Windows/x',
    '파일.md:숨은스트림',
    'a\u0000b',
    '줄\n바꿈',
  ]
  for (const path of UNSAFE) {
    test(`거부: ${JSON.stringify(path)}`, () => {
      expectCode(() => createZipWriter().add(path, 'x'), 'unsafe_path')
    })
  }

  test('★ 대소문자 · 유니코드 정규화만 다른 두 경로', () => {
    const zip = createZipWriter()
    zip.add('문서/Page.md', 'x')
    expectCode(() => zip.add('문서/page.md', 'y'), 'duplicate_path')
    zip.add('가.md', 'x') // NFC
    expectCode(() => zip.add('\u1100\u1161.md', 'y'), 'duplicate_path') // NFD 로 쓴 같은 글자
  })

  test('★ 같은 이름의 파일과 폴더 — 어느 순서로 넣어도', () => {
    const fileFirst = createZipWriter()
    fileFirst.add('페이지', 'x')
    expectCode(() => fileFirst.add('페이지/하위.md', 'y'), 'duplicate_path')

    const folderFirst = createZipWriter()
    folderFirst.add('페이지/하위.md', 'y')
    expectCode(() => folderFirst.add('페이지', 'x'), 'duplicate_path')
    expectCode(() => folderFirst.add('페이지', 'x'), 'duplicate_path')
    // 폴더 안에 여러 파일은 괜찮다.
    folderFirst.add('페이지/다른.md', 'z')
  })

  test('거부한 항목은 흔적을 남기지 않는다 — 계속 쓸 수 있다', () => {
    const zip = createZipWriter({ modifiedAt: FIXED })
    const chunks = [...zip.add('a.md', 'x')]
    expectCode(() => zip.add('A.md', 'y'), 'duplicate_path')
    expectCode(() => zip.add('../b', 'y'), 'unsafe_path')
    chunks.push(...zip.add('b.md', 'z'), zip.finish())
    assert.deepEqual(readZip(concat(chunks)).map((e) => e.name), ['a.md', 'b.md'])
  })
})

// ── ③ 한계 ────────────────────────────────────────────────────────────

describe('③ 한계 — 넘으면 잘라 쓰지 않고 멈춘다', () => {
  test('항목 65,534개까지 쓰고 그다음은 거부한다(0xFFFF 는 ZIP64 표지)', () => {
    assert.equal(MAX_ZIP_ENTRIES, 0xfffe)
    const zip = createZipWriter({ modifiedAt: FIXED })
    const chunks: Uint8Array[] = []
    for (let i = 0; i < MAX_ZIP_ENTRIES; i += 1) chunks.push(...zip.add(`f/${i}`, '', { compress: false }))
    expectCode(() => zip.add('하나 더', ''), 'too_many_entries')
    chunks.push(zip.finish())
    assert.equal(readZip(concat(chunks)).length, MAX_ZIP_ENTRIES)
  })

  test('바이트 상한은 끝 레코드까지 센다 — 넘기는 항목은 거부하고, 쓴 데까지는 올바르다', () => {
    const payload = randomBytes(100)
    // 항목 하나(로컬 30+5+100 · 중앙 46+5) + 끝 레코드 22 = 208
    const exact = createZipWriter({ modifiedAt: FIXED, maxBytes: 208 })
    const chunks = [...exact.add('a.bin', payload, { compress: false })]
    expectCode(() => exact.add('b.bin', payload, { compress: false }), 'too_large')
    chunks.push(exact.finish())
    const bytes = concat(chunks)
    assert.equal(bytes.length, 208)
    assert.equal(readZip(bytes).length, 1)

    expectCode(
      () => createZipWriter({ maxBytes: 207 }).add('a.bin', payload, { compress: false }),
      'too_large',
    )
  })

  test('끝낸 뒤에는 쓸 수 없다', () => {
    const zip = createZipWriter()
    zip.finish()
    expectCode(() => zip.add('a', 'x'), 'finished')
    expectCode(() => zip.finish(), 'finished')
  })
})

// ── ① · ④ 우리가 짜지 않은 구현 ──────────────────────────────────────

describe('우리가 짜지 않은 구현이 같은 이름 · 같은 바이트로 읽는다', () => {
  const inputs: Input[] = [
    ['페이지 제목/하위 페이지.md', '# 하위 페이지\n\n본문 **굵게** 한글\n'.repeat(200)],
    ['페이지 제목/사진 1.png', randomBytes(3000), { compress: false }],
    ['페이지 제목.md', '# 페이지 제목\n\n[하위](페이지%20제목/하위%20페이지.md)\n'],
    ['데이터베이스.csv', '\uFEFF이름,수량\r\n사과,3\r\n'],
    ['빈 파일.txt', ''],
    ['😀 이모지 #%.md', '이모지'],
    ['_export_report.json', JSON.stringify({ version: 1 })],
  ]
  // bsdtar(libarchive 3.8.8 · Windows)는 **BMP 밖 글자(이모지)가 든 이름**을 풀지 못한다 —
  // "Archive entry has empty or unreadable filename". 이름을 하나씩 떼어 실측했다: 한글 · `#%` ·
  // `é` · `·` 는 풀리고 `😀` 만 막힌다. 같은 ZIP 을 .NET(Expand-Archive)과 python 은 그대로 푼다.
  // ZIP 이 틀린 것이 아니라 그 도구의 이름 변환 한계라서, bsdtar 에는 그 항목을 뺀 ZIP 을 준다.
  // 이 한계는 파일 배치(2b)가 이모지 제목을 파일 이름으로 쓸 때 부딪힌다(HANDOFF §2).
  const bmpOnly = inputs.filter(([path]) => !/[\u{10000}-\u{10FFFF}]/u.test(path))
  let dir = ''
  let file = ''
  let bmpFile = ''

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'zip-test-'))
    file = join(dir, 'export.zip')
    writeFileSync(file, build(inputs))
    bmpFile = join(dir, 'export-bmp.zip')
    writeFileSync(bmpFile, build(bmpOnly))
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('python zipfile — 무결성 · 이름 · UTF-8 플래그 · 내용', (t) => {
    const python = findPython()
    if (python === null) return t.skip(unavailable('python'))

    const result = runPythonJson(
      python,
      [
        'import sys, json, zipfile, hashlib',
        'z = zipfile.ZipFile(sys.argv[1])',
        'entries = [{"name": i.filename, "utf8": bool(i.flag_bits & 0x800),',
        '            "sha256": hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]',
        'print(json.dumps({"bad": z.testzip(), "entries": entries}))',
      ].join('\n'),
      [file],
    ) as { bad: string | null; entries: Array<{ name: string; utf8: boolean; sha256: string }> }

    assert.equal(result.bad, null, 'testzip 이 CRC 오류를 찾지 않았다')
    assert.deepEqual(
      result.entries,
      inputs.map(([path, data]) => ({
        name: path,
        utf8: true,
        sha256: createHash('sha256').update(bytesOf(data)).digest('hex'),
      })),
    )
  })

  test('bsdtar 로 풀면 같은 파일이 같은 자리에 생긴다 (이모지 이름 제외 — 위 주석)', (t) => {
    const bsdtar = findBsdtar()
    if (bsdtar === null) return t.skip(unavailable('bsdtar'))
    assert.equal(bmpOnly.length, inputs.length - 1, '뺀 것은 이모지 항목 하나뿐이다')
    const out = join(dir, 'bsdtar')
    mkdirSync(out)
    const result = run(bsdtar, ['-xf', bmpFile, '-C', out])
    assert.equal(result.status, 0, result.stderr)
    for (const [path, data] of bmpOnly) {
      assert.ok(readFileSync(join(out, ...path.split('/'))).equals(bytesOf(data)), path)
    }
  })

  test('unzip -t 가 무결하다고 한다', (t) => {
    if (!hasUnzip()) return t.skip(unavailable('unzip'))
    const result = run('unzip', ['-t', file])
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  })
})
