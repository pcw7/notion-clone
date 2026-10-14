/**
 * 폼의 조건부 보이기 — 판정 (인접 제품 7b-5a · F-13-03 · 순수)
 *
 * 이 파일이 지키는 것(정본 §3.6 끝 [보강] 폼 ⑬).
 *
 *   ① 연산자는 근거의 타입이 정한다 — 선택은 옵션 · 체크박스는 체크 · 나머지는 답이 있는지 · 옵션이 있어야 하는 것은 같다 · 같지 않다
 *   ② 답이 있는가 · 조건이 맞는가 — 글은 공백만이면 없다 · 숫자는 수도 · 체크는 true · 'true' · 'on'
 *   ③ ★ 보이는 질문 — 순서대로 · 숨은 근거의 답은 없는 것(그 뒤도 숨는다) · 끊어진 조건(근거가 앞에 없다)은 보인다
 *   ④ ★ 끊어질 조건을 지운다 — 근거를 빼거나 뒤로 옮긴 목록에서 그 조건만 null(나머지 칸 · 다른 조건은 그대로)
 *   ⑤ 조건이 근거에 맞는가(7b-5b) — 연산자가 근거의 지금 타입의 것 · 옵션이 살아 있다 · 지우기가 맞지 않는 것도 지운다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { conditionHolds, isAnswered, needsOption, operatorsFor, pruneShowWhen, showWhenFits, visibleQuestionIds, type ShowWhen } from './form-logic.ts'

test('① 연산자는 근거의 타입이 정한다', () => {
  assert.deepEqual(operatorsFor('select'), ['equals', 'not_equals', 'is_empty', 'is_not_empty'])
  assert.deepEqual(operatorsFor('checkbox'), ['is_checked', 'is_not_checked'])
  for (const type of ['title', 'rich_text', 'number', 'date'] as const) assert.deepEqual(operatorsFor(type), ['is_empty', 'is_not_empty'], type)
  assert.deepEqual(
    (['equals', 'not_equals', 'is_checked', 'is_not_checked', 'is_empty', 'is_not_empty'] as const).filter(needsOption),
    ['equals', 'not_equals'],
  )
})

test('② 답이 있는가 · 조건이 맞는가', () => {
  assert.equal(isAnswered('rich_text', '   '), false, '공백만이면 없다')
  assert.equal(isAnswered('rich_text', ' 네 '), true)
  assert.equal(isAnswered('number', 0), true, '0 도 답이다')
  assert.equal(isAnswered('number', ''), false)
  assert.equal(isAnswered('checkbox', 'on'), true)
  assert.equal(isAnswered('checkbox', false), false)
  assert.equal(isAnswered('date', undefined), false)
  const eq: ShowWhen = { propertyId: 'k', operator: 'equals', optionId: 'a' }
  assert.equal(conditionHolds(eq, 'select', 'a'), true)
  assert.equal(conditionHolds(eq, 'select', 'b'), false)
  assert.equal(conditionHolds({ ...eq, operator: 'not_equals' }, 'select', undefined), true, '답이 없으면 같지 않다')
  assert.equal(conditionHolds({ propertyId: 'c', operator: 'is_checked', optionId: null }, 'checkbox', 'true'), true)
  assert.equal(conditionHolds({ propertyId: 'c', operator: 'is_not_checked', optionId: null }, 'checkbox', true), false)
  assert.equal(conditionHolds({ propertyId: 'm', operator: 'is_not_empty', optionId: null }, 'rich_text', ' x '), true)
})

test('③ ★ 보이는 질문 — 순서대로 · 숨은 근거의 답은 없는 것 · 끊어진 조건은 보인다', () => {
  const qs = [
    { propertyId: 'kind', type: 'select' as const, showWhen: null },
    { propertyId: 'memo', type: 'rich_text' as const, showWhen: { propertyId: 'kind', operator: 'equals' as const, optionId: 'a' } },
    { propertyId: 'age', type: 'number' as const, showWhen: { propertyId: 'memo', operator: 'is_not_empty' as const, optionId: null } },
    // 근거가 뒤에 있다 — 끊어진 조건이라 보인다
    { propertyId: 'early', type: 'date' as const, showWhen: { propertyId: 'late', operator: 'is_empty' as const, optionId: null } },
    { propertyId: 'late', type: 'date' as const, showWhen: null },
    // 근거가 폼에 없다 — 보인다
    { propertyId: 'orphan', type: 'title' as const, showWhen: { propertyId: 'gone', operator: 'is_not_empty' as const, optionId: null } },
  ]
  assert.deepEqual([...visibleQuestionIds(qs, { kind: 'a', memo: '안녕', age: '3' })], ['kind', 'memo', 'age', 'early', 'late', 'orphan'])
  assert.deepEqual(
    [...visibleQuestionIds(qs, { kind: 'b', memo: '안녕', age: '3' })],
    ['kind', 'early', 'late', 'orphan'],
    '근거가 숨으면 그 답은 없는 것 — memo 에 글이 와도 age 도 숨는다',
  )
  assert.deepEqual([...visibleQuestionIds(qs, { kind: 'a' })], ['kind', 'memo', 'early', 'late', 'orphan'], 'memo 가 비면 age 가 숨는다')
  assert.deepEqual([...visibleQuestionIds(qs, Object.create({ kind: 'a' }) as Record<string, unknown>)], ['kind', 'early', 'late', 'orphan'], '원형의 칸은 답이 아니다')
})

test('④ ★ 끊어질 조건을 지운다 — 근거를 빼거나 뒤로 옮긴 목록에서 그 조건만', () => {
  const onKind: ShowWhen = { propertyId: 'kind', operator: 'equals', optionId: 'a' }
  const onMemo: ShowWhen = { propertyId: 'memo', operator: 'is_not_empty', optionId: null }
  const list = [
    { propertyId: 'kind', label: '분류', showWhen: null },
    { propertyId: 'memo', label: '메모', showWhen: onKind },
    { propertyId: 'age', label: '나이', showWhen: onMemo },
  ]
  assert.deepEqual(pruneShowWhen(list), list, '그대로면 그대로')
  assert.deepEqual(
    pruneShowWhen(list.filter((q) => q.propertyId !== 'kind')).map((q) => [q.propertyId, q.label, q.showWhen]),
    [['memo', '메모', null], ['age', '나이', onMemo]],
    '근거를 빼면 그 조건만 — 다른 칸은 그대로',
  )
  assert.deepEqual(
    pruneShowWhen([list[1]!, list[0]!, list[2]!]).map((q) => q.showWhen),
    [null, null, onMemo],
    '근거보다 위로 옮기면 지운다',
  )
})

test('⑤ 조건이 근거에 맞는가 — 타입 · 옵션 · 지우기가 맞지 않는 것도', () => {
  const eq: ShowWhen = { propertyId: 'kind', operator: 'equals', optionId: 'a' }
  assert.equal(showWhenFits(eq, { type: 'select', options: [{ id: 'a' }] }), true)
  assert.equal(showWhenFits(eq, { type: 'select', options: [{ id: 'b' }] }), false, '옵션이 지워졌다')
  assert.equal(showWhenFits(eq, { type: 'rich_text', options: [] }), false, '근거가 글로 바뀌었다')
  assert.equal(showWhenFits({ propertyId: 'kind', operator: 'is_empty', optionId: null }, { type: 'rich_text', options: [] }), true, '비었다는 글에도 맞는다')
  // 옵션과 상관없이 연산자가 그 타입의 것이 아니면 맞지 않는다
  assert.equal(showWhenFits({ propertyId: 'kind', operator: 'is_checked', optionId: null }, { type: 'select', options: [{ id: 'a' }] }), false, '선택에 체크')
  assert.equal(showWhenFits({ propertyId: 'kind', operator: 'is_empty', optionId: null }, { type: 'checkbox', options: [] }), false, '체크박스에 비었다')
  const list = [
    { propertyId: 'kind', showWhen: null },
    { propertyId: 'memo', showWhen: eq },
  ]
  assert.deepEqual(pruneShowWhen(list, () => false).map((q) => q.showWhen), [null, null], '맞지 않으면 지운다')
  assert.deepEqual(pruneShowWhen(list, () => true).map((q) => q.showWhen), [null, eq])
})
