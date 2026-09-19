/**
 * 프로퍼티 값 계약 — W8-a (F-03-03 · F-03-04 · F-03-06)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **사이드카가 실제로 채워진다.** 비면 "저장은 됐는데 필터·정렬에 안 걸리는"
 *      상태가 되고, 그것이 사용자가 가장 알아채기 어려운 실패다
 *   ② **select 의 사이드카는 옵션 id 다.** 이름을 넣으면 옵션 rename 이 깨진다
 *   ③ **checkbox 에 null 이 없다.** 있으면 "체크 안 함"과 "값 없음"이 둘이 된다
 *   ④ 빈 값은 `text_value = NULL` 이다 — 부분 인덱스가 빈 셀로 차지 않게
 *   ⑤ 쓰기 검증은 **관대하지 않다.** 모양이 틀리면 거부한다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  MVP_PROPERTY_TYPES,
  DEFAULT_PROPERTY_TYPE,
  deriveSidecars,
  emptyValue,
  insertOption,
  isEmptyValue,
  isGroupableType,
  isMvpPropertyType,
  isOptionType,
  optionIdOf,
  optionValue,
  validateCellValue,
  type CellValue,
  type SelectOption,
} from './property-types.ts'
import { textRun } from '../contracts/rich-text.ts'

const valid = (type: Parameters<typeof validateCellValue>[0], v: unknown): boolean =>
  validateCellValue(type, v).length === 0

describe('레지스트리', () => {
  test('MVP 6종 + status (마스터 W8-a "프로퍼티 5종" + 필수 title · 보드 4c-1 이 status 를 더했다)', () => {
    assert.deepEqual([...MVP_PROPERTY_TYPES], [
      'title', 'rich_text', 'number', 'select', 'status', 'checkbox', 'date',
    ])
  })

  test('기본 타입은 rich_text — 어떤 값이든 받아 적을 수 있는 타입이 가장 덜 틀린다', () => {
    assert.equal(DEFAULT_PROPERTY_TYPE, 'rich_text')
  })

  test('스키마 ENUM 에는 있지만 MVP 가 아닌 타입은 거른다', () => {
    assert.equal(isMvpPropertyType('multi_select'), false)
    assert.equal(isMvpPropertyType('formula'), false)
    assert.equal(isMvpPropertyType('nonsense'), false)
    assert.equal(isMvpPropertyType('number'), true)
  })
})

describe('emptyValue · isEmptyValue', () => {
  test('★ checkbox 의 빈 값은 false 다 (null 이 아니다)', () => {
    assert.deepEqual(emptyValue('checkbox'), { type: 'checkbox', checkbox: false })
  })

  test('모든 타입의 빈 값이 자기 계약을 통과한다', () => {
    for (const type of MVP_PROPERTY_TYPES) {
      const v = emptyValue(type)
      assert.equal(valid(type, v), 0 === validateCellValue(type, v).length)
      assert.deepEqual(validateCellValue(type, v), [], `${type} 의 빈 값이 거부됐다`)
    }
  })

  test('빈 값은 비어 있다고 판정된다 — checkbox 만 예외', () => {
    for (const type of MVP_PROPERTY_TYPES) {
      const expected = type !== 'checkbox'
      assert.equal(isEmptyValue(emptyValue(type)), expected, `${type}`)
    }
  })

  test('★ checkbox false 는 "비어 있음"이 아니다 — 값이다', () => {
    assert.equal(isEmptyValue({ type: 'checkbox', checkbox: false }), false)
  })

  test('공백만 있는 제목은 비어 있지 않다 — 사용자가 넣은 공백이다', () => {
    assert.equal(isEmptyValue({ type: 'title', title: [textRun(' ')] }), false)
  })
})

describe('★ 사이드카 파생', () => {
  test('title · rich_text → text_value (평문)', () => {
    assert.equal(deriveSidecars({ type: 'title', title: [textRun('첫 행')] }).text, '첫 행')
    assert.equal(
      deriveSidecars({ type: 'rich_text', rich_text: [textRun('본문'), textRun(' 이어짐')] }).text,
      '본문 이어짐',
    )
  })

  test('number → num_value', () => {
    assert.equal(deriveSidecars({ type: 'number', number: 42 }).num, 42)
    assert.equal(deriveSidecars({ type: 'number', number: -3.5 }).num, -3.5)
    assert.equal(deriveSidecars({ type: 'number', number: null }).num, null)
  })

  test('checkbox → bool_value', () => {
    assert.equal(deriveSidecars({ type: 'checkbox', checkbox: true }).bool, true)
    // ★ false 도 **채운다**. null 로 두면 `equals false` 필터가 부분 인덱스를
    //   벗어나고, "체크 안 함"을 찾을 수 없게 된다.
    assert.equal(deriveSidecars({ type: 'checkbox', checkbox: false }).bool, false)
  })

  test('★ select → 옵션 id. 이름이 아니다 (F-03-04 의 rename 자동 전파)', () => {
    const s = deriveSidecars({ type: 'select', select: { id: 'opt_abc' } })
    assert.equal(s.text, 'opt_abc')
    assert.equal(deriveSidecars({ type: 'select', select: null }).text, null)
  })

  test('date → date_start · date_end', () => {
    const s = deriveSidecars({
      type: 'date',
      date: { start: '2026-01-10', end: '2026-01-20' },
    })
    assert.equal(s.dateStart?.toISOString().slice(0, 10), '2026-01-10')
    assert.equal(s.dateEnd?.toISOString().slice(0, 10), '2026-01-20')
  })

  test('단일 날짜면 date_end 는 null 이다', () => {
    const s = deriveSidecars({ type: 'date', date: { start: '2026-01-10' } })
    assert.ok(s.dateStart !== null)
    assert.equal(s.dateEnd, null)
  })

  test('★ 빈 텍스트는 NULL 이다 — 부분 인덱스가 빈 셀로 차지 않게', () => {
    assert.equal(deriveSidecars({ type: 'title', title: [] }).text, null)
    assert.equal(deriveSidecars({ type: 'rich_text', rich_text: [textRun('')] }).text, null)
  })

  test('★ 한 셀은 사이드카 하나만 채운다 — 인덱스가 그것을 전제한다', () => {
    const cases: CellValue[] = [
      { type: 'title', title: [textRun('가')] },
      { type: 'number', number: 1 },
      { type: 'checkbox', checkbox: true },
      { type: 'date', date: { start: '2026-01-01' } },
      { type: 'select', select: { id: 'o' } },
    ]
    for (const v of cases) {
      const s = deriveSidecars(v)
      const filled = [s.num, s.text, s.bool, s.dateStart].filter((x) => x !== null).length
      assert.equal(filled, 1, `${v.type} 이 사이드카 ${filled}개를 채웠다`)
    }
  })
})

describe('검증 — 쓰기 경로는 관대하지 않다', () => {
  test('봉투의 type 이 프로퍼티 타입과 달라서는 안 된다', () => {
    assert.equal(valid('number', { type: 'rich_text', rich_text: [] }), false)
    assert.equal(valid('number', { number: 1 }), false)
  })

  test('객체가 아니면 거부', () => {
    for (const bad of [null, 42, 'text', [], undefined]) {
      assert.equal(valid('number', bad), false, String(bad))
    }
  })

  describe('number', () => {
    test('숫자와 null 은 통과', () => {
      assert.ok(valid('number', { type: 'number', number: 0 }))
      assert.ok(valid('number', { type: 'number', number: null }))
    })

    test('★ NaN · Infinity 는 거부 — numeric 사이드카에 넣으면 정렬이 깨진다', () => {
      assert.equal(valid('number', { type: 'number', number: Number.NaN }), false)
      assert.equal(valid('number', { type: 'number', number: Number.POSITIVE_INFINITY }), false)
    })

    test('문자열 숫자는 거부 — 파싱은 화면의 일이다', () => {
      assert.equal(valid('number', { type: 'number', number: '42' }), false)
    })
  })

  describe('checkbox', () => {
    test('boolean 만 통과', () => {
      assert.ok(valid('checkbox', { type: 'checkbox', checkbox: true }))
      assert.ok(valid('checkbox', { type: 'checkbox', checkbox: false }))
    })

    test('★ null 은 거부 — "체크 안 함"과 "값 없음"을 둘로 만들지 않는다', () => {
      assert.equal(valid('checkbox', { type: 'checkbox', checkbox: null }), false)
    })
  })

  describe('select', () => {
    test('옵션 참조와 null 은 통과', () => {
      assert.ok(valid('select', { type: 'select', select: { id: 'opt_a' } }))
      assert.ok(valid('select', { type: 'select', select: null }))
    })

    test('id 없는 참조는 거부', () => {
      assert.equal(valid('select', { type: 'select', select: {} }), false)
      assert.equal(valid('select', { type: 'select', select: { id: '' } }), false)
      assert.equal(valid('select', { type: 'select', select: { name: '진행중' } }), false)
    })

    test('배열은 거부 — multi_select 는 MVP 밖이다', () => {
      assert.equal(valid('select', { type: 'select', select: [{ id: 'a' }] }), false)
    })
  })

  describe('date', () => {
    test('ISO 날짜와 날짜시각이 통과', () => {
      assert.ok(valid('date', { type: 'date', date: { start: '2026-01-10' } }))
      assert.ok(valid('date', { type: 'date', date: { start: '2026-01-10T09:30' } }))
      assert.ok(valid('date', { type: 'date', date: { start: '2026-01-10T09:30:00Z' } }))
      assert.ok(valid('date', { type: 'date', date: { start: '2026-01-10T09:30:00+09:00' } }))
      assert.ok(valid('date', { type: 'date', date: null }))
    })

    test('타임존 이름이 통과', () => {
      assert.ok(
        valid('date', { type: 'date', date: { start: '2026-01-10', time_zone: 'Asia/Seoul' } }),
      )
      assert.ok(valid('date', { type: 'date', date: { start: '2026-01-10', time_zone: null } }))
    })

    test('모양이 아닌 날짜는 거부', () => {
      assert.equal(valid('date', { type: 'date', date: { start: '2026/01/10' } }), false)
      assert.equal(valid('date', { type: 'date', date: { start: '어제' } }), false)
      assert.equal(valid('date', { type: 'date', date: {} }), false)
    })

    test('★ 존재하지 않는 날짜는 거부 — 모양만 맞는 것으로는 부족하다', () => {
      // 실측: `new Date('2026-02-30')` 은 Invalid 가 아니라 **2026-03-02 로 굴러간다.**
      // 그대로 두면 사용자가 입력한 날짜와 저장되는 날짜가 달라진다.
      assert.equal(valid('date', { type: 'date', date: { start: '2026-02-30' } }), false)
      assert.equal(valid('date', { type: 'date', date: { start: '2026-04-31' } }), false)
      // 이 둘은 `new Date` 도 Invalid 로 본다(범위 밖). 둘 다 막혀야 한다.
      assert.equal(valid('date', { type: 'date', date: { start: '2026-13-01' } }), false)
      assert.equal(valid('date', { type: 'date', date: { start: '2026-01-32' } }), false)
    })

    test('★ 윤년 경계 — 2024-02-29 는 있고 2026-02-29 는 없다', () => {
      assert.ok(valid('date', { type: 'date', date: { start: '2024-02-29' } }))
      assert.equal(valid('date', { type: 'date', date: { start: '2026-02-29' } }), false)
    })

    test('굴러간 날짜가 사이드카에도 들어가지 않는다', () => {
      // 검증을 통과한 값만 파생하지만, 파생 함수 자체도 같은 규칙을 쓴다.
      assert.equal(deriveSidecars({ type: 'date', date: { start: '2026-02-30' } }).dateStart, null)
    })

    test('★ 끝이 시작보다 앞서면 거부 — DB CHECK 전에 필드별 오류를 준다', () => {
      const issues = validateCellValue('date', {
        type: 'date',
        date: { start: '2026-02-01', end: '2026-01-01' },
      })
      assert.equal(issues.length, 1)
      assert.match(issues[0].message, /끝이 시작보다/)
    })

    test('같은 날은 허용 — 하루짜리 기간이다', () => {
      assert.ok(valid('date', { type: 'date', date: { start: '2026-01-10', end: '2026-01-10' } }))
    })
  })

  describe('title · rich_text', () => {
    test('RichText 배열이 통과', () => {
      assert.ok(valid('title', { type: 'title', title: [textRun('제목')] }))
      assert.ok(valid('title', { type: 'title', title: [] }))
    })

    test('배열이 아니면 거부', () => {
      assert.equal(valid('title', { type: 'title', title: '제목' }), false)
      assert.equal(valid('title', { type: 'title', title: null }), false)
    })

    test('RichText 계약 위반은 그대로 전달된다 — 규칙을 두 벌로 만들지 않는다', () => {
      const issues = validateCellValue('rich_text', {
        type: 'rich_text',
        rich_text: [{ type: 'text' }],
      })
      assert.ok(issues.length > 0)
      assert.match(issues[0].path, /^value\.rich_text/)
    })
  })
})

describe('status — 그룹이 강제되는 select (보드 4c-1 · F-03-05)', () => {
  test('★ 봉투의 키가 타입 이름이다 — status 칸에 select 봉투는 거부, 그 반대도', () => {
    assert.ok(valid('status', { type: 'status', status: { id: 'opt' } }))
    assert.ok(valid('status', { type: 'status', status: null }))
    assert.ok(!valid('status', { type: 'select', select: { id: 'opt' } }))
    assert.ok(!valid('select', { type: 'status', status: { id: 'opt' } }))
    assert.ok(!valid('status', { type: 'status', status: { id: '' } }))
    assert.ok(!valid('status', { type: 'status', status: 'opt' }))
  })

  test('★ 사이드카는 select 와 같은 축(옵션 id) — 필터 · 보드의 그룹 키가 한 규칙을 본다', () => {
    assert.equal(deriveSidecars({ type: 'status', status: { id: 'opt' } }).text, 'opt')
    assert.equal(deriveSidecars({ type: 'status', status: null }).text, null)
    assert.deepEqual(deriveSidecars({ type: 'status', status: { id: 'opt' } }), deriveSidecars({ type: 'select', select: { id: 'opt' } }))
  })

  test('빈 값 · 옵션 타입 · 그룹으로 묶을 수 있는 타입', () => {
    assert.deepEqual(emptyValue('status'), { type: 'status', status: null })
    assert.ok(isEmptyValue({ type: 'status', status: null }))
    assert.ok(!isEmptyValue({ type: 'status', status: { id: 'opt' } }))
    assert.ok(isOptionType('select') && isOptionType('status') && !isOptionType('checkbox'))
    assert.ok(isGroupableType('status'))
  })

  test('optionIdOf · optionValue — 봉투의 키를 아는 곳은 여기 하나다', () => {
    assert.deepEqual(optionValue('status', 'opt'), { type: 'status', status: { id: 'opt' } })
    assert.deepEqual(optionValue('select', 'opt'), { type: 'select', select: { id: 'opt' } })
    assert.deepEqual(optionValue('status', null), { type: 'status', status: null })
    assert.equal(optionIdOf(optionValue('status', 'opt')), 'opt')
    assert.equal(optionIdOf(optionValue('select', null)), null)
    assert.equal(optionIdOf({ type: 'checkbox', checkbox: true }), null)
  })

  describe('insertOption — 새 옵션은 서버가 읽어 주는 자리에 선다', () => {
    const o = (id: string, group?: SelectOption['group']): SelectOption => ({ id, name: id, color: 'default', ...(group ? { group } : {}) })
    const status = [o('시작 전', 'todo'), o('진행 중', 'in_progress'), o('완료', 'complete')]
    const ids = (list: readonly SelectOption[]) => list.map((x) => x.id)

    test('★ 자기 그룹의 끝 — "할 일"에 만든 옵션이 완료 뒤에 서지 않는다', () => {
      assert.deepEqual(ids(insertOption(status, o('보류', 'todo'))), ['시작 전', '보류', '진행 중', '완료'])
      assert.deepEqual(ids(insertOption(status, o('검토 중', 'in_progress'))), ['시작 전', '진행 중', '검토 중', '완료'])
      assert.deepEqual(ids(insertOption(status, o('취소', 'complete'))), ['시작 전', '진행 중', '완료', '취소'])
    })

    test('select 옵션은 맨 뒤 · 이미 있는 id 는 그대로', () => {
      const select = [o('a'), o('b')]
      assert.deepEqual(ids(insertOption(select, o('c'))), ['a', 'b', 'c'])
      assert.deepEqual(ids(insertOption(status, o('완료', 'complete'))), ['시작 전', '진행 중', '완료'])
    })

    test('원래 배열을 바꾸지 않는다', () => {
      const before = JSON.stringify(status)
      insertOption(status, o('보류', 'todo'))
      assert.equal(JSON.stringify(status), before)
    })
  })
})
