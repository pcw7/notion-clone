/**
 * 데이터베이스 → CSV — F-09-14 (DB 없음)
 *
 * 따옴표 규칙은 손으로 적은 기대 문자열만으로는 부족하다. python `csv` 모듈(우리가 짜지 않은
 * 구현)이 같은 칸으로 읽는지 본다 — CI 에서는 python 이 필수다.
 *
 * 이 파일이 지키는 것.
 *
 *   ① **읽으면 같은 칸이 돌아온다** — 쉼표 · 따옴표 · 줄바꿈 · 앞뒤 공백 · 한글 · 이모지
 *   ② **Excel 이 수식으로 실행하지 않는다** — 사용자가 쓴 글자만 막고, 숫자 열은 건드리지 않는다
 *   ③ **표 화면과 같은 값이다** — select 이름 · 지워진 옵션 · 계약을 어긴 옛 셀
 *   ④ **비어 있어도 파일이다** — 헤더만 있는 CSV, `null` 이라는 글자는 없다
 *   ⑤ **수식 열**(10n-35) — 결과 타입대로 같은 칸의 모양 · 값이 없으면 빈 칸 · 글 결과만 수식 막기
 *   ⑥ **relation 열**(10n-36) — 제목을 `, ` 로 · 빈 제목은 "제목 없음" · 볼 수 없는 개수 · 캐시 봉투는 읽지 않는다 · 수식 막기
 *   ⑦ **rollup 열**(10n-37) — 화면과 같은 모양 · 없음은 빈 칸 · 원본 보기는 대상 칸의 글자 · 볼 수 없는 개수 · 너무 많음 · 글 값만 수식 막기
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { textRun } from '../contracts/rich-text.ts'
import { findPython, runPythonJson, unavailable } from '../testing/external-tools.ts'
import { cellPlainText, tableToCsv, type CsvColumn, type CsvRow } from './csv.ts'

const OPTIONS = [
  { id: 'opt-doing', name: '진행 중', color: 'blue' as const },
  { id: 'opt-formula', name: '=위험한 이름', color: 'red' as const },
]

const COLUMNS: CsvColumn[] = [
  { propertyId: 'p-title', name: '이름', type: 'title' },
  { propertyId: 'p-num', name: '수량', type: 'number' },
  { propertyId: 'p-select', name: '상태', type: 'select', options: OPTIONS },
  { propertyId: 'p-check', name: '완료', type: 'checkbox' },
  { propertyId: 'p-date', name: '날짜', type: 'date' },
  { propertyId: 'p-text', name: '메모', type: 'rich_text' },
]

const title = (s: string) => ({ type: 'title', title: s === '' ? [] : [textRun(s)] })
const text = (s: string) => ({ type: 'rich_text', rich_text: s === '' ? [] : [textRun(s)] })

function row(cells: Record<string, unknown>): CsvRow {
  return { cells }
}

describe('모양', () => {
  test('BOM · 헤더 · CRLF · 타입별 글자', () => {
    const { csv, guardedFormulas } = tableToCsv(COLUMNS, [
      row({
        'p-title': title('사과'),
        'p-num': { type: 'number', number: 3.5 },
        'p-select': { type: 'select', select: { id: 'opt-doing' } },
        'p-check': { type: 'checkbox', checkbox: true },
        'p-date': { type: 'date', date: { start: '2026-09-13' } },
        'p-text': text('맛있다'),
      }),
      row({
        'p-title': title('배'),
        'p-date': { type: 'date', date: { start: '2026-09-13T09:00:00+09:00', end: '2026-09-20' } },
      }),
    ])
    assert.equal(
      csv,
      '\uFEFF이름,수량,상태,완료,날짜,메모\r\n' +
        '사과,3.5,진행 중,Yes,2026-09-13,맛있다\r\n' +
        '배,,,No,2026-09-13T09:00:00+09:00 → 2026-09-20,\r\n',
    )
    assert.equal(guardedFormulas, 0)
  })

  test('④ 행이 없으면 헤더만 있는 파일이다', () => {
    assert.equal(tableToCsv(COLUMNS, []).csv, '\uFEFF이름,수량,상태,완료,날짜,메모\r\n')
  })

  test('④ 빈 칸은 빈 필드다 — null 이라는 글자가 없다 · 체크박스의 빈 값은 No 다', () => {
    const { csv } = tableToCsv(COLUMNS, [row({})])
    assert.equal(csv.split('\r\n')[1], ',,,No,,')
    assert.ok(!/null|undefined/.test(csv), csv)
  })
})

describe('③ 표 화면과 같은 값이다', () => {
  test('select 는 옵션 id 를 이름으로 바꾸고, 지워진 옵션은 빈 칸이다', () => {
    const { csv } = tableToCsv(
      [COLUMNS[2]],
      [row({ 'p-select': { type: 'select', select: { id: 'opt-doing' } } }), row({ 'p-select': { type: 'select', select: { id: 'opt-gone' } } })],
    )
    assert.deepEqual(csv.split('\r\n').slice(1, 3), ['진행 중', ''])
  })

  test('계약을 어긴 옛 셀은 빈 칸으로 읽는다 — 표 화면의 readCell 과 같다', () => {
    const { csv } = tableToCsv(
      [COLUMNS[5], COLUMNS[1]],
      [row({ 'p-text': { type: 'number', number: 7 }, 'p-num': { type: 'number', number: 'seven' } })],
    )
    assert.equal(csv.split('\r\n')[1], ',')
  })
})

describe('② 수식 주입 — 사용자가 쓴 글자만 막는다', () => {
  test("= + - @ 탭으로 시작하는 글자 · select 이름 · 열 이름에 ' 를 붙이고 센다", () => {
    const columns: CsvColumn[] = [
      { propertyId: 'a', name: '=열 이름', type: 'title' },
      { propertyId: 'b', name: '메모', type: 'rich_text' },
      { propertyId: 'c', name: '상태', type: 'select', options: OPTIONS },
      { propertyId: 'd', name: '수량', type: 'number' },
    ]
    const { csv, guardedFormulas } = tableToCsv(columns, [
      row({ a: title('=HYPERLINK("http://x","클릭")'), b: text('+82 10'), c: { type: 'select', select: { id: 'opt-formula' } }, d: { type: 'number', number: -5 } }),
      row({ a: title('@SUM(A1)'), b: text('\t탭'), d: { type: 'number', number: 0 } }),
      row({ a: title('평범'), b: text('-5도') }),
    ])
    const lines = csv.slice(1).split('\r\n')
    assert.equal(lines[0], "'=열 이름,메모,상태,수량")
    assert.equal(lines[1], `"'=HYPERLINK(""http://x"",""클릭"")",'+82 10,'=위험한 이름,-5`)
    assert.equal(lines[2], "'@SUM(A1),'\t탭,,0")
    assert.equal(lines[3], "평범,'-5도,,")
    assert.equal(guardedFormulas, 7)
  })
})

describe('① 우리가 짜지 않은 구현(python csv)이 같은 칸으로 읽는다', () => {
  let dir = ''
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'csv-test-'))
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('쉼표 · 따옴표 · 줄바꿈 · 앞뒤 공백 · 한글 · 이모지', (t) => {
    const python = findPython()
    if (python === null) return t.skip(unavailable('python'))

    const tricky = [
      '쉼표, 있음',
      '따옴표 " 하나와 "" 둘',
      '줄\n바꿈',
      '윈도\r\n줄바꿈',
      '  앞뒤 공백  ',
      '😀 이모지',
      '"따옴표로 시작',
      '',
    ]
    const columns: CsvColumn[] = [
      { propertyId: 'a', name: '제목, 쉼표', type: 'title' },
      { propertyId: 'b', name: '메모 "따옴표"', type: 'rich_text' },
    ]
    const rows = tricky.map((s) => row({ a: title(s), b: text(`${s}!`) }))
    const { csv } = tableToCsv(columns, rows)

    const file = join(dir, 'table.csv')
    writeFileSync(file, csv, 'utf8')
    const parsed = runPythonJson(
      python,
      [
        'import sys, csv, json',
        "with open(sys.argv[1], encoding='utf-8-sig', newline='') as f:",
        '    print(json.dumps(list(csv.reader(f))))',
      ].join('\n'),
      [file],
    )

    assert.deepEqual(parsed, [
      ['제목, 쉼표', '메모 "따옴표"'],
      ...tricky.map((s) => [s, `${s}!`]),
    ])
  })
})

describe('⑤ 수식 열 (10n-35)', () => {
  const F: CsvColumn = { propertyId: 'p-f', name: '계산', type: 'formula' }

  test('★ 결과 타입대로 — 수 · 글 · 참거짓(Yes/No) · 날짜(범위는 →)', () => {
    assert.equal(cellPlainText(F, { type: 'number', value: 150 }), '150')
    assert.equal(cellPlainText(F, { type: 'number', value: -5 }), '-5')
    assert.equal(cellPlainText(F, { type: 'text', value: '가나' }), '가나')
    assert.equal(cellPlainText(F, { type: 'boolean', value: true }), 'Yes')
    assert.equal(cellPlainText(F, { type: 'boolean', value: false }), 'No')
    assert.equal(cellPlainText(F, { type: 'date', value: { start: '2026-10-24' } }), '2026-10-24')
    assert.equal(cellPlainText(F, { type: 'date', value: { start: '2026-10-24', end: '2026-10-31' } }), '2026-10-24 → 2026-10-31')
  })

  test('★ 값이 없으면 빈 칸 — 거짓(No)과 가른다 · 모양이 아니면 빈 칸', () => {
    assert.equal(cellPlainText(F, null), '')
    assert.equal(cellPlainText(F, undefined), '')
    assert.equal(cellPlainText(F, { type: 'number', number: 3 }), '', '셀 봉투는 수식 값이 아니다')
    assert.equal(cellPlainText(F, { type: 'boolean', value: 'yes' }), '')
    assert.equal(cellPlainText(F, 'x'), '')
  })

  test('★ 글 결과만 수식 막기 — 수 결과의 -5 는 숫자로 남는다', () => {
    const { csv, guardedFormulas } = tableToCsv([F], [
      row({ 'p-f': { type: 'text', value: '=HYPERLINK("x")' } }),
      row({ 'p-f': { type: 'number', value: -5 } }),
      row({ 'p-f': { type: 'text', value: '평범' } }),
    ])
    assert.equal(guardedFormulas, 1)
    assert.equal(csv, '\uFEFF계산\r\n"\'=HYPERLINK(""x"")"\r\n-5\r\n평범\r\n')
  })
})

describe('⑥ relation 열 (10n-36)', () => {
  const R: CsvColumn = { propertyId: 'p-r', name: '작업들', type: 'relation' }
  const rel = (titles: string[], hidden = 0) => ({ type: 'relation_titles', titles, hidden })

  test('★ 제목을 칩 순서로 잇는다 · 빈 제목은 넘겨받은 이름 · 볼 수 없는 것은 개수만', () => {
    assert.equal(cellPlainText(R, rel(['가', '나'])), '가, 나')
    assert.equal(cellPlainText(R, rel(['가', ''])), '가, 제목 없음')
    assert.equal(cellPlainText(R, rel(['가', ''], 0), 'Untitled'), '가, Untitled', '부르는 쪽의 이름')
    assert.equal(cellPlainText(R, rel(['가'], 2)), '가 (볼 수 없는 항목 2개)')
    assert.equal(cellPlainText(R, rel([], 1)), '(볼 수 없는 항목 1개)')
    assert.equal(cellPlainText(R, rel([])), '')
  })

  test('★ 캐시의 relation 봉투는 읽지 않는다 — 걸러지지 않은 id 다', () => {
    assert.equal(cellPlainText(R, { type: 'relation', relation: [{ id: 'x' }], count: 1 }), '')
    assert.equal(cellPlainText(R, undefined), '')
  })

  test('제목은 사람이 쓴 글자 — 수식 막기', () => {
    const { csv, guardedFormulas } = tableToCsv([R], [row({ 'p-r': rel(['=위험', '안전']) })])
    assert.equal(guardedFormulas, 1)
    assert.equal(csv, '\uFEFF작업들\r\n"\'=위험, 안전"\r\n')
  })
})

describe('⑦ rollup 열 (10n-37)', () => {
  const U: CsvColumn = { propertyId: 'p-u', name: '합', type: 'rollup' }
  const rolled = (result: unknown, hidden = 0, targetType = 'number', targetOptions: unknown[] = []) =>
    ({ type: 'rollup_export', cell: { state: 'ok', result, hidden }, targetType, targetOptions })

  test('★ 화면과 같은 모양 — 수 · 비율 · 날짜(적힌 시작) · 날짜 범위(N일)', () => {
    assert.equal(cellPlainText(U, rolled({ kind: 'number', number: 6 })), '6')
    assert.equal(cellPlainText(U, rolled({ kind: 'number', number: 0 })), '0', '0 은 값이다')
    assert.equal(cellPlainText(U, rolled({ kind: 'percent', percent: 0.6667 })), '66.7%')
    assert.equal(cellPlainText(U, rolled({ kind: 'date', date: '2026-10-24' })), '2026-10-24')
    assert.equal(cellPlainText(U, rolled({ kind: 'days', days: 20 })), '20일')
  })

  test('★ 없음은 빈 칸 · 볼 수 없는 것은 뒤에 개수 · 너무 많으면 그렇다고 · 모양이 아니면 빈 칸', () => {
    assert.equal(cellPlainText(U, rolled({ kind: 'number', number: null })), '')
    assert.equal(cellPlainText(U, rolled({ kind: 'number', number: 6 }, 2)), '6 (볼 수 없는 항목 2개)')
    assert.equal(cellPlainText(U, rolled({ kind: 'percent', percent: null }, 1)), '(볼 수 없는 항목 1개)')
    assert.equal(cellPlainText(U, { type: 'rollup_export', cell: { state: 'too_many' }, targetType: 'number', targetOptions: [] }), '(연결이 너무 많아 계산하지 않음)')
    assert.equal(cellPlainText(U, undefined), '')
    assert.equal(cellPlainText(U, { type: 'number', number: 6 }), '')
  })

  test('★ 원본 보기 — 대상 칸의 글자를 , 로 · 옵션은 이름 · 넘치면 +N', () => {
    const values = [{ type: 'select', select: { id: 'opt-doing' } }, { type: 'select', select: { id: 'gone' } }]
    assert.equal(cellPlainText(U, rolled({ kind: 'values', values, count: 2 }, 0, 'select', OPTIONS)), '진행 중', '지워진 옵션은 빈 칸이라 빠진다')
    assert.equal(cellPlainText(U, rolled({ kind: 'values', values: [{ type: 'checkbox', checkbox: false }], count: 30 }, 0, 'checkbox')), 'No +29')
  })

  test('★ 글 값의 원본 보기만 수식 막기 — 수는 그대로', () => {
    const { csv, guardedFormulas } = tableToCsv([U], [
      row({ 'p-u': rolled({ kind: 'values', values: [text('=위험')], count: 1 }, 0, 'rich_text') }),
      row({ 'p-u': rolled({ kind: 'number', number: -5 }) }),
    ])
    assert.equal(guardedFormulas, 1)
    assert.equal(csv, "\uFEFF합\r\n'=위험\r\n-5\r\n")
  })
})
