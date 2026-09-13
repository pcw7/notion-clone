/**
 * 익스포트 파일 이름 — F-09-14 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **세 운영체제와 압축 해제 도구가 받는 이름** — Windows 금지 글자 · 장치 이름 · 끝의 점,
 *      bsdtar 가 풀지 못하는 이모지
 *   ② **겹치면 겹친 항목 전부에 id** — 순서가 바뀌어도 같은 이름
 *   ③ **겹침은 풀리는 파일 시스템처럼 본다** — 대소문자 · NFC · 폴더와 파일
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { MAX_NAME_LENGTH, encodeHrefSegment, resolveNames, safeFileName, type NameRequest } from './names.ts'

const FALLBACK = '제목 없음'

describe('① safeFileName — 세 운영체제와 압축 해제 도구가 받는 이름', () => {
  test('Windows 가 거부하는 글자는 _ 로', () => {
    assert.equal(safeFileName('a<b>c:d"e/f\\g|h?i*j', FALLBACK), 'a_b_c_d_e_f_g_h_i_j')
  })

  test('줄바꿈 · 탭 · 제어 문자는 공백으로 몰고 앞뒤를 자른다', () => {
    const bell = String.fromCharCode(7)
    assert.equal(safeFileName(`  첫 줄\n둘째\t줄${bell}끝  `, FALLBACK), '첫 줄 둘째 줄 끝')
  })

  test('★ 이모지(BMP 밖)와 그것을 잇는 글자를 뺀다 — bsdtar 가 풀지 못한다', () => {
    assert.equal(safeFileName('📝 회의록', FALLBACK), '회의록')
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)
    assert.equal(safeFileName(`${family} 가족`, FALLBACK), '가족')
    // BMP 안의 하트(U+2764)는 남기고, 뒤에 붙은 변형 선택자(U+FE0F)만 뺀다.
    const heart = String.fromCodePoint(0x2764)
    assert.equal(safeFileName(`좋아요 ${heart}${String.fromCodePoint(0xfe0f)}`, FALLBACK), `좋아요 ${heart}`)
    // bsdtar 가 푸는 것은 건드리지 않는다(실측한 이름들).
    assert.equal(safeFileName('é 악센트 · 가운뎃점 #%', FALLBACK), 'é 악센트 · 가운뎃점 #%')
  })

  test('남는 글자가 없으면 대체 이름', () => {
    for (const title of ['', '   ', '🎉🎉', '...', ' . ']) assert.equal(safeFileName(title, FALLBACK), FALLBACK, title)
  })

  test('끝의 점 · 공백은 떼고 앞의 점은 _ 로', () => {
    assert.equal(safeFileName('v1.0.', FALLBACK), 'v1.0')
    assert.equal(safeFileName('.env', FALLBACK), '_env')
    assert.equal(safeFileName('끝 . ', FALLBACK), '끝')
  })

  test('Windows 장치 이름은 확장자가 붙어도 이름 바로 뒤에 _', () => {
    assert.equal(safeFileName('CON', FALLBACK), 'CON_')
    assert.equal(safeFileName('con.txt', FALLBACK), 'con_.txt')
    assert.equal(safeFileName('Lpt9', FALLBACK), 'Lpt9_')
    assert.equal(safeFileName('console', FALLBACK), 'console')
    assert.equal(safeFileName('COM10', FALLBACK), 'COM10')
  })

  test('60글자에서 자르고 잘린 끝의 공백을 뗀다', () => {
    assert.equal(MAX_NAME_LENGTH, 60)
    assert.equal(safeFileName(`${'가'.repeat(59)} ${'나'.repeat(10)}`, FALLBACK), '가'.repeat(59))
    assert.equal(Array.from(safeFileName('글'.repeat(500), FALLBACK)).length, 60)
  })

  test('NFD 로 쓴 한글은 NFC 로', () => {
    assert.equal(safeFileName(String.fromCharCode(0x1100, 0x1161), FALLBACK), '가')
  })
})

// ── ② · ③ 겹침 ────────────────────────────────────────────────────────

const page = (base: string, id = randomUUID()): NameRequest => ({ key: id, id, base, extensions: ['.md', ''] })
const hex = (id: string, length: number): string => id.replace(/-/g, '').slice(0, length)

describe('② resolveNames — 겹치면 겹친 항목 전부에 id', () => {
  test('겹치지 않으면 그대로다', () => {
    const a = page('가')
    const b = page('나')
    assert.deepEqual(resolveNames([a, b]), new Map([[a.key, '가'], [b.key, '나']]))
  })

  test('★ 겹친 항목 전부에 id 8자리 — 먼저 온 쪽이 이름을 갖지 않고, 순서를 바꿔도 같다', () => {
    const a = page('회의록')
    const b = page('회의록')
    const c = page('다른 페이지')
    const names = resolveNames([a, b, c])
    assert.equal(names.get(a.key), `회의록 ${hex(a.id, 8)}`)
    assert.equal(names.get(b.key), `회의록 ${hex(b.id, 8)}`)
    assert.equal(names.get(c.key), '다른 페이지')
    assert.deepEqual(resolveNames([c, b, a]), names)
  })

  test('8자리 접미사가 다른 제목과 새로 겹치면 둘 다 한 단계 더 오른다', () => {
    const a = page('회의록')
    const b = page('회의록')
    const c = page(`회의록 ${hex(a.id, 8)}`)
    const names = resolveNames([a, b, c])
    assert.equal(names.get(a.key), `회의록 ${hex(a.id, 32)}`)
    assert.equal(names.get(b.key), `회의록 ${hex(b.id, 8)}`)
    assert.equal(names.get(c.key), `회의록 ${hex(a.id, 8)} ${hex(c.id, 8)}`)
  })

  test('id 앞 8자리까지 같으면 32자리', () => {
    const a = page('같음', 'abcdef01-0000-4000-8000-000000000001')
    const b = page('같음', 'abcdef01-0000-4000-8000-000000000002')
    const names = resolveNames([a, b])
    assert.equal(names.get(a.key), '같음 abcdef01000040008000000000000001')
    assert.equal(names.get(b.key), '같음 abcdef01000040008000000000000002')
  })

  test('같은 id 가 두 번 들어와 끝까지 겹치면 던진다', () => {
    const id = randomUUID()
    assert.throws(() => resolveNames([{ key: 'x', id, base: 'a', extensions: ['.md'] }, { key: 'y', id, base: 'a', extensions: ['.md'] }]))
  })
})

describe('③ 겹침은 풀리는 파일 시스템처럼 본다', () => {
  test('대소문자 · NFC 만 다른 이름', () => {
    const upper = page('Report')
    const lower = page('report')
    const names = resolveNames([upper, lower])
    assert.notEqual(names.get(upper.key), 'Report')
    assert.notEqual(names.get(lower.key), 'report')

    const nfc = page('가')
    const nfd = page(String.fromCharCode(0x1100, 0x1161))
    assert.equal(resolveNames([nfc, nfd]).get(nfc.key), `가 ${hex(nfc.id, 8)}`)
  })

  test('★ 페이지의 폴더와 첨부 파일이 같은 자리', () => {
    const p = page('a.png')
    const fileId = randomUUID()
    const file: NameRequest = { key: fileId, id: fileId, base: 'a', extensions: ['.png'] }
    const names = resolveNames([p, file])
    assert.equal(names.get(p.key), `a.png ${hex(p.id, 8)}`)
    assert.equal(names.get(file.key), `a ${hex(fileId, 8)}`)
  })

  test('페이지와 데이터베이스가 같은 이름 — 둘 다 폴더를 차지한다', () => {
    const p = page('자료')
    const dbId = randomUUID()
    const db: NameRequest = { key: dbId, id: dbId, base: '자료', extensions: ['.csv', ''] }
    const names = resolveNames([p, db])
    assert.equal(names.get(p.key), `자료 ${hex(p.id, 8)}`)
    assert.equal(names.get(db.key), `자료 ${hex(dbId, 8)}`)
  })

  test('예약된 이름과 겹치면 붙인다 — 최상위의 보고서 파일', () => {
    const p = page('_export_report.json')
    const other = page('_export_report')
    const names = resolveNames([p, other], ['_export_report.json'])
    assert.equal(names.get(p.key), `_export_report.json ${hex(p.id, 8)}`)
    assert.equal(names.get(other.key), '_export_report', '.md 와 폴더 _export_report 는 보고서와 겹치지 않는다')
  })
})

test('encodeHrefSegment — 주소 문법 글자만', () => {
  assert.equal(encodeHrefSegment('100% #1 ?(괄호)'), '100%25 %231 %3F(괄호)')
})
