/**
 * 셀 값 ↔ 화면 — W8-b (F-03-16, DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **읽기는 관대하다.** 계약을 어긴 옛 셀 하나가 표를 깨지 않는다
 *   ② **쓰기는 서버와 같은 함수로 검사한다.** 화면이 받아준 입력이 저장에서 거부되지 않는다
 *   ③ **열었다 닫기만 한 텍스트 칸은 서식을 잃지 않는다**
 *   ④ **날짜는 적힌 그대로 보여준다** — 보는 사람의 시간대로 하루 밀리지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import {
  cellText,
  defaultColumnWidth,
  draftOf,
  formatDate,
  parseDraft,
  readCell,
  sameValue,
} from './cell-format.ts'
import { MVP_PROPERTY_TYPES, validateCellValue, type CellValue } from './property-types.ts'

const valueOf = (r: ReturnType<typeof parseDraft>): CellValue => {
  assert.equal(r.ok, true, r.ok ? '' : r.message)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

describe('readCell — 읽기는 관대하다', () => {
  test('없는 칸은 타입별 빈 값이다', () => {
    assert.deepEqual(readCell('number', undefined), { type: 'number', number: null })
    assert.deepEqual(readCell('title', null), { type: 'title', title: [] })
  })

  test('★ checkbox 의 빈 값은 null 이 아니라 false 다', () => {
    assert.deepEqual(readCell('checkbox', undefined), { type: 'checkbox', checkbox: false })
  })

  test('★ 봉투의 타입이 다른 옛 칸은 빈 값으로 읽는다 — 표가 그려져야 한다', () => {
    // 타입 변환(F-03-09) 이전에 rich_text 였던 칸이 number 컬럼에 남은 경우.
    const stale = { type: 'rich_text', rich_text: [textRun('옛 값')] }
    assert.deepEqual(readCell('number', stale), { type: 'number', number: null })
  })

  test('계약을 지키는 값은 그대로다', () => {
    const v = { type: 'date', date: { start: '2026-09-13' } }
    assert.deepEqual(readCell('date', v), v)
  })
})

describe('cellText', () => {
  const options = [
    { id: 'o1', name: '할 일', color: 'gray' as const },
    { id: 'o2', name: '완료', color: 'green' as const },
  ]

  test('select 는 옵션 id 로 이름을 찾는다', () => {
    assert.equal(cellText({ type: 'select', select: { id: 'o2' } }, options), '완료')
  })

  test('★ 없는 옵션 id 는 빈 칸이다 — id 를 그리지 않는다 (F-03-04 옵션 삭제)', () => {
    assert.equal(cellText({ type: 'select', select: { id: 'gone' } }, options), '')
  })

  test('숫자 · 텍스트 · 빈 값', () => {
    assert.equal(cellText({ type: 'number', number: 12.5 }), '12.5')
    assert.equal(cellText({ type: 'number', number: null }), '')
    assert.equal(cellText({ type: 'rich_text', rich_text: [textRun('가'), textRun('나')] }), '가나')
  })

  test('checkbox 는 읽을 수 있는 이름을 준다 (화면은 체크박스로 그린다)', () => {
    assert.equal(cellText({ type: 'checkbox', checkbox: true }), '체크됨')
    assert.equal(cellText({ type: 'checkbox', checkbox: false }), '체크 안 됨')
  })
})

describe('formatDate', () => {
  test('날짜 하나', () => {
    assert.equal(formatDate({ start: '2026-09-03' }), '2026년 9월 3일')
  })

  test('시각이 적혀 있으면 붙인다', () => {
    assert.equal(formatDate({ start: '2026-09-03T09:05:00Z' }), '2026년 9월 3일 09:05')
  })

  test('범위는 → 로 잇는다', () => {
    assert.equal(formatDate({ start: '2026-09-01', end: '2026-09-10' }), '2026년 9월 1일 → 2026년 9월 10일')
  })

  test('★ 적힌 날짜 그대로다 — 시간대로 옮기지 않는다', () => {
    // Date 로 바꿔 UTC 로 그리면 9월 13일 14:30 이 되고, 날짜만 보면 하루가 밀리는
    // 시간대가 생긴다.
    assert.equal(formatDate({ start: '2026-09-13T23:30:00+09:00' }), '2026년 9월 13일 23:30')
  })
})

describe('parseDraft — 텍스트', () => {
  test('글자를 한 run 으로 만든다', () => {
    const v = valueOf(parseDraft('title', '첫 행', { type: 'title', title: [] }))
    assert.equal(cellText(v), '첫 행')
    assert.equal(v.type, 'title')
  })

  test('★ 글자가 그대로면 이전 값을 그대로 돌려준다 — 서식을 잃지 않는다', () => {
    const bold: CellValue = { type: 'rich_text', rich_text: [textRun('굵게', { bold: true })] }
    const v = valueOf(parseDraft('rich_text', draftOf(bold), bold))
    assert.equal(v, bold, '같은 객체여야 한다')
  })

  test('비우면 빈 배열이다', () => {
    const v = valueOf(parseDraft('rich_text', '', { type: 'rich_text', rich_text: [textRun('x')] }))
    assert.deepEqual(v, { type: 'rich_text', rich_text: [] })
  })

  test('줄바꿈은 공백으로 접는다', () => {
    const v = valueOf(parseDraft('title', '가\n나', { type: 'title', title: [] }))
    assert.equal(cellText(v), '가 나')
  })

  test('2000자를 넘으면 거부한다', () => {
    const r = parseDraft('title', 'a'.repeat(2001), { type: 'title', title: [] })
    assert.equal(r.ok, false)
  })
})

describe('parseDraft — 숫자', () => {
  const empty: CellValue = { type: 'number', number: null }

  test('소수 · 음수 · 지수 · 천 단위 쉼표', () => {
    assert.deepEqual(valueOf(parseDraft('number', '12.5', empty)), { type: 'number', number: 12.5 })
    assert.deepEqual(valueOf(parseDraft('number', '-3', empty)), { type: 'number', number: -3 })
    assert.deepEqual(valueOf(parseDraft('number', '1e3', empty)), { type: 'number', number: 1000 })
    assert.deepEqual(valueOf(parseDraft('number', ' 1,234 ', empty)), { type: 'number', number: 1234 })
  })

  test('비우면 null 이다 — Number("") 는 0 이지만 빈 칸은 0 이 아니다', () => {
    assert.deepEqual(valueOf(parseDraft('number', '  ', { type: 'number', number: 5 })), empty)
  })

  test('★ 사람이 뜻하지 않은 모양은 거부한다', () => {
    for (const bad of ['abc', '0x10', 'Infinity', '1e400', '1.2.3', '--1']) {
      assert.equal(parseDraft('number', bad, empty).ok, false, bad)
    }
  })
})

describe('parseDraft — 날짜', () => {
  const empty: CellValue = { type: 'date', date: null }

  test('날짜를 받고, 비우면 null 이다', () => {
    assert.deepEqual(valueOf(parseDraft('date', '2026-09-13', empty)), {
      type: 'date',
      date: { start: '2026-09-13' },
    })
    assert.deepEqual(valueOf(parseDraft('date', '', { type: 'date', date: { start: '2026-01-01' } })), empty)
  })

  test('★ 달력에 없는 날은 서버와 같은 함수가 거부한다', () => {
    const r = parseDraft('date', '2026-02-30', empty)
    assert.equal(r.ok, false)
  })

  test('끝 날짜를 잇고, 새 시작이 끝보다 뒤면 끝을 버린다', () => {
    const range: CellValue = { type: 'date', date: { start: '2026-09-01', end: '2026-09-10' } }
    assert.deepEqual(valueOf(parseDraft('date', '2026-09-05', range)), {
      type: 'date',
      date: { start: '2026-09-05', end: '2026-09-10' },
    })
    assert.deepEqual(valueOf(parseDraft('date', '2026-09-20', range)), {
      type: 'date',
      date: { start: '2026-09-20' },
    })
  })
})

describe('★ parseDraft 가 만든 값은 전부 서버 계약을 지킨다', () => {
  test('통과한 값을 validateCellValue 에 다시 넣어도 통과한다', () => {
    const cases: [Parameters<typeof parseDraft>[0], string, CellValue][] = [
      ['title', '제목', { type: 'title', title: [] }],
      ['rich_text', '메모', { type: 'rich_text', rich_text: [] }],
      ['number', '42', { type: 'number', number: null }],
      ['date', '2026-12-31', { type: 'date', date: null }],
    ]
    for (const [type, draft, prev] of cases) {
      const v = valueOf(parseDraft(type, draft, prev))
      assert.deepEqual(validateCellValue(type, v), [], `${type} ${draft}`)
    }
  })

  test('select · checkbox 는 입력칸으로 고치지 않는다', () => {
    assert.equal(parseDraft('select', 'x', { type: 'select', select: null }).ok, false)
    assert.equal(parseDraft('checkbox', 'x', { type: 'checkbox', checkbox: false }).ok, false)
  })
})

describe('sameValue', () => {
  test('★ 키 순서가 달라도 같다 — 서버 값은 jsonb 를 거쳐 순서가 바뀐다', () => {
    const a = { type: 'date', date: { start: '2026-09-01', end: '2026-09-02' } } as CellValue
    const b = JSON.parse('{"date":{"end":"2026-09-02","start":"2026-09-01"},"type":"date"}') as CellValue
    assert.equal(sameValue(a, b), true)
  })

  test('end: null 과 end 없음은 같다', () => {
    assert.equal(
      sameValue({ type: 'date', date: { start: '2026-09-01', end: null } }, { type: 'date', date: { start: '2026-09-01' } }),
      true,
    )
  })

  test('값이 다르면 다르다', () => {
    assert.equal(sameValue({ type: 'number', number: 1 }, { type: 'number', number: 2 }), false)
    assert.equal(sameValue({ type: 'checkbox', checkbox: true }, { type: 'checkbox', checkbox: false }), false)
  })
})

describe('defaultColumnWidth', () => {
  test('모든 MVP 타입에 양수 폭이 있고 제목이 가장 넓다', () => {
    const widths = MVP_PROPERTY_TYPES.map(defaultColumnWidth)
    assert.ok(widths.every((w) => w > 0))
    assert.equal(Math.max(...widths), defaultColumnWidth('title'))
  })
})
