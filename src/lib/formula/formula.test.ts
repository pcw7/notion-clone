/**
 * 수식 언어 — 토큰 · 문법 · 묶기 · 타입 · 계산 (DB 심화 2i-1조각 · F-03-12 · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 우선순위 · 결합 방향 — 곱셈이 먼저 · `^` 는 오른쪽부터 · `-2 ^ 2` 는 -4 · 삼항은 가장 약하다 · `a.f(b)` 는 `f(a, b)`
 *   ② ★ 틀린 식은 **위치와 함께** 거부 — 닫히지 않은 글 · 끝난 식 · 모르는 함수 · 없는 속성 · 타입 불일치 · 너무 깊음 · 너무 김
 *   ③ ★ 속성은 id 로 묶는다 — 저장된 식은 `⟦id⟧` · 이름을 바꿔도 보이는 식이 따라간다 · 원문(주석 · 줄바꿈)이 남는다 · 지워진 속성
 *   ④ ★ 빈 값 — 산술은 빈 값을 흘린다 · 0 으로 나누면 빈 값 · 크기 비교는 거짓 · 조건 자리는 거짓
 *      (if · and · or 가 필요한 쪽만 계산하는 것은 겉으로 드러나지 않는다 — 계산이 던지지 않으므로. 검사로 가를 수 없다)
 *   ⑤ 글 · 수 · 변환 함수
 *   ⑥ 날짜 — 날짜 글자 그대로 · 달 끝 · 시각을 지킨다 · 지금은 바깥에서 받는다
 *   ⑦ ★ `eval` · `Function` 을 쓰지 않는다(마스터 문서의 금지)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

import { compileFormula, displayFormula, evaluateFormula, MAX_FORMULA_LENGTH, type FormulaSchema, type FormulaValue } from './formula.ts'
import { MAX_DEPTH } from './parser.ts'
import type { FormulaType } from './values.ts'

const PROPS: { id: string; name: string; type: FormulaType }[] = [
  { id: 'pScore', name: '점수', type: 'number' },
  { id: 'pName', name: '이름', type: 'text' },
  { id: 'pDone', name: '완료', type: 'boolean' },
  { id: 'pDue', name: '마감', type: 'date' },
]
const schema = (props = PROPS): FormulaSchema => ({
  byName: (name) => {
    const p = props.find((x) => x.name === name)
    return p ? { id: p.id, type: p.type } : null
  },
  byId: (id) => {
    const p = props.find((x) => x.id === id)
    return p ? { name: p.name, type: p.type } : null
  },
})

const NOW = new Date('2026-03-15T08:30:00Z')
const ROW: Record<string, FormulaValue> = {
  pScore: { type: 'number', value: 42 },
  pName: { type: 'text', value: 'Alpha' },
  pDone: { type: 'boolean', value: true },
  pDue: { type: 'date', value: { start: '2026-01-31' } },
}

/** 식을 읽고 이 행에서 계산한다. 읽지 못하면 던진다. */
function run(source: string, row: Record<string, FormulaValue> = ROW): FormulaValue {
  const c = compileFormula(source, schema())
  if (!c.ok) throw new Error(`${source} → ${c.error.message} @${c.error.start}`)
  return evaluateFormula(c.value, (id) => row[id] ?? null, { now: NOW })
}
const value = (source: string, row?: Record<string, FormulaValue>) => {
  const v = run(source, row)
  return v === null ? null : v.type === 'date' ? v.value : v.value
}
const error = (source: string) => {
  const c = compileFormula(source, schema())
  assert.equal(c.ok, false, `${source} 는 거부되어야 한다`)
  return c.ok ? null : c.error
}

describe('① 우선순위 · 결합 방향', () => {
  test('★ 산술 · 거듭 · 앞의 - · 삼항 · 메서드', () => {
    assert.equal(value('1 + 2 * 3'), 7)
    assert.equal(value('(1 + 2) * 3'), 9)
    assert.equal(value('10 - 3 - 2'), 5, '왼쪽부터')
    assert.equal(value('2 ^ 3 ^ 2'), 512, '^ 는 오른쪽부터')
    assert.equal(value('-2 ^ 2'), -4, '^ 가 앞의 - 보다 세다')
    assert.equal(value('7 % 3'), 1)
    assert.equal(value('1 < 2 ? "작다" : "크다"'), '작다')
    assert.equal(value('false ? 1 : true ? 2 : 3'), 2, '삼항은 오른쪽부터')
    assert.equal(value('1 + 1 == 2 and not false'), true)
    assert.equal(value('true && false || true'), true, '&& 가 || 보다 세다')
    assert.equal(value('!true'), false)
    assert.equal(value('"abc".length()'), 3, 'a.f() 는 f(a)')
    assert.equal(value('prop("점수").round().format().length()'), 2)
    assert.equal(value('1.5e2 + .5'), 150.5)
  })

  test('주석 · 줄바꿈 · 글의 탈출', () => {
    assert.equal(value('/* 점수 두 배 */\nprop("점수") * 2 // 끝'), 84)
    assert.equal(value('"a\\"b\\\\c\\n".length()'), 6)
  })
})

describe('② 틀린 식은 위치와 함께', () => {
  test('★ 토큰 · 문법', () => {
    assert.deepEqual(error('"닫히지 않은'), { message: '글이 닫히지 않았습니다(`"`)', start: 0, end: 7 })
    const end = error('1 +')!
    assert.equal(end.start, 3, '식이 끝난 자리')
    assert.match(error('1 = 2')!.message, /==/)
    assert.match(error('(1 + 2')!.message, /\)/)
    assert.match(error('1 2')!.message, /끝나야/)
    assert.match(error('점수 + 1')!.message, /읽을 수 없는 글자/)
    assert.match(error('round')!.message, /함수/)
    assert.match(error('/* 열린 주석')!.message, /주석/)
  })

  test('★ 묶기 · 타입', () => {
    const missing = error('1 + prop("없는 속성")')!
    assert.deepEqual([missing.start, missing.end], [4, 17])
    assert.match(missing.message, /없는 속성/)
    const mixed = error('prop("이름") + 1')!
    assert.deepEqual([mixed.start, mixed.end], [0, 14], '틀린 연산의 자리')
    assert.match(mixed.message, /format/)
    assert.match(error('nope(1)')!.message, /모르는 함수/)
    assert.match(error('if(1, 2, 3)')!.message, /조건/)
    assert.match(error('if(true, 1, "a")')!.message, /타입이 같아야/)
    assert.match(error('round()')!.message, /1 ~ 2개/)
    assert.match(error('true > false')!.message, /참거짓/)
    assert.match(error('prop("마감") == 1')!.message, /같은 타입/)
    assert.match(error('prop(1)')!.message, /prop\("이름"\)/)
    assert.match(error('ifs(true, 1, false, 2)')!.message, /홀수/)
  })

  test('너무 깊거나 너무 길면 거부(파서가 스택을 넘지 않게)', () => {
    assert.match(error(`${'('.repeat(MAX_DEPTH + 1)}1${')'.repeat(MAX_DEPTH + 1)}`)!.message, /깊게/)
    assert.equal(value(`${'('.repeat(40)}1${')'.repeat(40)}`), 1)
    assert.match(error(`1${' + 1'.repeat(MAX_FORMULA_LENGTH / 4)}`)!.message, /너무 깁니다/)
    assert.match(error('   ')!.message, /비었습니다/)
  })
})

describe('③ 속성은 id 로 묶는다', () => {
  test('★ 저장된 식 · 이름 바꾸기 · 원문이 남는다 · 기대는 속성', () => {
    const source = '/* 합 */ prop("점수") +\n  prop("점수") * 2'
    const c = compileFormula(source, schema())
    assert.ok(c.ok)
    if (!c.ok) return
    assert.equal(c.value.stored, '/* 합 */ ⟦pScore⟧ +\n  ⟦pScore⟧ * 2', '속성 자리만 바뀐다')
    assert.deepEqual(c.value.dependsOn, ['pScore'])
    assert.equal(c.value.resultType, 'number')
    assert.equal(displayFormula(c.value.stored, (id) => (id === 'pScore' ? '총점' : null)), '/* 합 */ prop("총점") +\n  prop("총점") * 2', '이름을 바꾸면 따라간다')
    // 저장된 식은 이름 없이도 다시 읽힌다
    const again = compileFormula(c.value.stored, schema())
    assert.ok(again.ok && again.value.stored === c.value.stored)
  })

  test('지워진 속성 — 보일 때는 표시가 · 다시 읽으면 오류', () => {
    const stored = '⟦pGone⟧ + 1'
    assert.equal(displayFormula(stored, () => null), 'prop("(지워진 속성)") + 1')
    assert.match((compileFormula(stored, schema()) as { error: { message: string } }).error.message, /지워졌거나/)
  })

  test('이름의 따옴표 · 역슬래시를 탈출해 되돌린다', () => {
    const props = [{ id: 'pQ', name: '그 "말" \\ 끝', type: 'text' as const }]
    const c = compileFormula('prop("그 \\"말\\" \\\\ 끝")', schema(props))
    assert.ok(c.ok)
    if (!c.ok) return
    const shown = displayFormula(c.value.stored, () => props[0]!.name)
    assert.ok(compileFormula(shown, schema(props)).ok, '보이는 식을 그대로 다시 저장할 수 있다')
  })
})

describe('④ 빈 값', () => {
  const empty = { pScore: null, pName: null, pDone: null, pDue: null }
  test('★ 산술은 빈 값을 흘린다 · 0 으로 나누면 빈 값 · 크기 비교는 거짓 · 같음은 빈 값끼리만', () => {
    assert.equal(run('prop("점수") + 1', empty), null)
    assert.equal(run('1 / 0'), null)
    assert.equal(run('5 % 0'), null)
    assert.equal(value('prop("점수") > 1', empty), false)
    assert.equal(value('prop("점수") < 1', empty), false)
    assert.equal(value('prop("이름") == ""', empty), false, '빈 값은 빈 글이 아니다')
    assert.equal(value('empty(prop("이름"))', empty), true)
    assert.equal(value('empty("")'), true)
    assert.equal(value('empty(0)'), true)
    assert.equal(value('format(prop("점수"))', empty), '')
  })

  test('★ 조건 자리의 빈 값은 거짓 · and · or 는 함수로도 부른다', () => {
    assert.equal(value('if(prop("완료"), "끝", "아직")', empty), '아직')
    assert.equal(value('prop("완료") ? 1 : 2', empty), 2)
    assert.equal(value('not prop("완료")', empty), true)
    assert.equal(value('or(true, 1 / 0 > 0)'), true)
    assert.equal(value('and(true, true, false)'), false, 'and · or 는 함수로도 부른다')
    assert.match(error('and true')!.message, /앞에 값/)
    assert.equal(value('ifs(false, 1, prop("완료"), 2, 3)', empty), 3)
    assert.equal(value('min(prop("점수"), 5, 3)', empty), 3, 'min · max · sum 은 빈 값을 건너뛴다')
    assert.equal(run('sum(prop("점수"))', empty), null, '하나도 없으면 빈 값')
  })
})

describe('⑤ 글 · 수 · 변환', () => {
  test('글', () => {
    assert.equal(value('prop("이름") + "!"'), 'Alpha!')
    assert.equal(value('lower(prop("이름"))'), 'alpha')
    assert.equal(value('upper("한글 abc")'), '한글 ABC')
    assert.equal(value('trim("  x  ")'), 'x')
    assert.equal(value('contains(prop("이름"), "ph")'), true)
    assert.equal(value('substring("가나다라", 1, 3)'), '나다')
    assert.equal(value('substring("가나다라", 2)'), '다라')
    assert.equal(value('"ab".repeat(3)'), 'ababab')
    assert.equal((value('"x".repeat(1000000)') as string).length, 10_000, '글의 상한')
    assert.equal(value('length("한글")'), 2)
  })

  test('수 · 변환', () => {
    assert.equal(value('round(3.14159, 2)'), 3.14)
    assert.equal(value('round(2.5)'), 3)
    assert.equal(value('max(1, 9, 4)'), 9)
    assert.equal(value('mean(1, 2, 3)'), 2)
    assert.equal(value('abs(-3) + floor(2.7) + ceil(2.1)'), 8)
    assert.equal(run('sqrt(-1)'), null, '무한 · 수 아님은 빈 값')
    assert.equal(value('toNumber("1,234.5")'), 1234.5)
    assert.equal(run('toNumber("12abc")'), null)
    assert.equal(value('toNumber(true)'), 1)
    assert.equal(value('format(42) + "점"'), '42점')
    assert.equal(value('format(prop("완료"))'), 'true')
    assert.equal(value('equal(1, 1) and unequal("a", "b")'), true)
  })
})

describe('⑥ 날짜', () => {
  test('날짜 글자 그대로 — 해 · 달 · 날 · 시 · 분', () => {
    assert.equal(value('year(prop("마감"))'), 2026)
    assert.equal(value('month(prop("마감"))'), 1)
    assert.equal(value('date(prop("마감"))'), 31)
    const timed = { ...ROW, pDue: { type: 'date' as const, value: { start: '2026-03-01T23:30:00+09:00' } } }
    assert.equal(value('date(prop("마감"))', timed), 1, '시간대로 옮기지 않는다 — 사람이 고른 그 날')
    assert.equal(value('hour(prop("마감"))', timed), 23)
    assert.equal(value('formatDate(prop("마감"), "YYYY년 MM월 DD일 HH:mm")', timed), '2026년 03월 01일 23:30')
  })

  test('★ 더하기 · 빼기 · 사이 — 달 끝 · 날짜만은 날짜만 · 시각을 지킨다', () => {
    assert.deepEqual(value('dateAdd(prop("마감"), 1, "months")'), { start: '2026-02-28' }, '1월 31일 + 1달 = 2월 마지막 날')
    assert.deepEqual(value('dateAdd(prop("마감"), 1, "days")'), { start: '2026-02-01' })
    assert.deepEqual(value('dateSubtract(prop("마감"), 1, "years")'), { start: '2025-01-31' })
    const timed = { ...ROW, pDue: { type: 'date' as const, value: { start: '2026-03-01T09:00:00Z' } } }
    assert.deepEqual(value('dateAdd(prop("마감"), 2, "hours")', timed), { start: '2026-03-01T11:00:00.000Z' })
    assert.equal(value('dateBetween(parseDate("2026-03-10"), parseDate("2026-03-01"), "days")'), 9)
    assert.equal(value('dateBetween(parseDate("2026-03-10"), parseDate("2026-01-31"), "months")'), 1)
    assert.equal(run('dateAdd(prop("마감"), 1, "fortnights")'), null, '모르는 단위는 빈 값')
  })

  test('지금 · 오늘은 바깥에서 받는다 · 글을 날짜로', () => {
    assert.deepEqual(value('now()'), { start: '2026-03-15T08:30:00.000Z' })
    assert.deepEqual(value('today()'), { start: '2026-03-15' })
    assert.equal(value('dateBetween(today(), prop("마감"), "days")'), 43)
    assert.equal(run('parseDate("2026-02-30")'), null, '달력에 없는 날')
    assert.equal(value('prop("마감") < today()'), true, '날짜끼리 크기 비교')
  })
})

describe('⑦ eval · Function 금지', () => {
  test('★ 수식 모듈의 어느 파일에도 eval · Function 생성이 없다', () => {
    const dir = new URL('./', import.meta.url)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = readFileSync(new URL(file, dir), 'utf8')
      assert.ok(!/\beval\s*\(/.test(src), `${file} 에 eval(`)
      assert.ok(!/new\s+Function\b|\bFunction\s*\(/.test(src), `${file} 에 Function`)
    }
  })
})
