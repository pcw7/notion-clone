/**
 * DB automation 의 글자 (5b-3a · F-08-09)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { actionSummary, disabledMessage, runRowLabel, runStatusLabel, stepLine, subjectParticle, triggerSummary } from './automation-messages.ts'

const names = {
  property: (id: string) => ({ qty: '수량', state: '상태' })[id] ?? null,
  condition: ({ propertyId }: { propertyId: string }) => `${propertyId} 칩`,
}

test('★ 주어 조사 — 받침이 있으면 이 · 없으면 가 · 한글이 아니면 이(가)', () => {
  assert.equal(subjectParticle('수량'), '이')
  assert.equal(subjectParticle('상태'), '가')
  assert.equal(subjectParticle('Score'), '이(가)')
  assert.equal(subjectParticle(''), '이(가)')
})

test('★ 트리거 요약 — 행 추가 · 속성 편집 · 조건은 칩 · 여럿이면 또는 · 사라진 속성', () => {
  assert.equal(triggerSummary([{ type: 'page_added' }], names), '새 항목이 추가되면')
  assert.equal(triggerSummary([{ type: 'property_edited', propertyId: 'qty', condition: null }], names), '‘수량’이 바뀌면')
  assert.equal(
    triggerSummary([{ type: 'property_edited', propertyId: 'state', condition: { operator: 'equals' } }, { type: 'page_added' }], names),
    '‘상태’가 바뀌면 (state 칩) 또는 새 항목이 추가되면',
  )
  assert.equal(triggerSummary([{ type: 'property_edited', propertyId: 'gone', condition: null }], names), '‘지워진 속성’이 바뀌면')
  assert.equal(triggerSummary([], names), '트리거가 없습니다')
})

test('액션 요약 — 종류마다 몇 개 · 모르는 액션 · 없음', () => {
  assert.equal(actionSummary([{ type: 'edit_property' }]), '값 바꾸기')
  assert.equal(actionSummary([{ type: 'edit_property' }, { type: 'add_page_to' }, { type: 'add_page_to' }]), '값 바꾸기 · 다른 표에 항목 추가 2')
  assert.equal(actionSummary([{ type: 'insert_blocks' }]), '알 수 없는 액션')
  assert.equal(actionSummary([]), '할 일이 없습니다')
})

test('★ 꺼진 까닭 — 셋 · 사람이 껐으면 없음', () => {
  assert.equal(disabledMessage(null), null)
  assert.match(disabledMessage('creator_left') ?? '', /떠나/)
  assert.match(disabledMessage('trigger_broken') ?? '', /속성이 지워져/)
  assert.match(disabledMessage('failures') ?? '', /세 번 이어서 실패/)
  assert.equal(disabledMessage('tired'), '꺼졌습니다.')
})

test('실행 기록 — 결과 · 단계 한 줄', () => {
  assert.equal(runStatusLabel('partial'), '일부 건너뜀')
  assert.equal(stepLine({ index: 0, type: 'edit_property', status: 'done' }), '1. 값 바꾸기 — 완료')
  assert.equal(stepLine({ index: 1, type: 'add_page_to', status: 'skipped', reason: 'forbidden' }), '2. 다른 표에 항목 추가 — 건너뜀(권한 없음)')
})

test('★ 트리거된 항목 — 제목 · 제목 없음 · 볼 수 없음 · 지워짐(키 없음 · id 없음)', () => {
  const titles = { a: '회의', b: '', c: null }
  assert.deepEqual(runRowLabel('a', titles), { text: '회의', linkable: true })
  assert.deepEqual(runRowLabel('b', titles), { text: '제목 없음', linkable: true })
  assert.deepEqual(runRowLabel('c', titles), { text: '볼 수 없는 항목', linkable: false })
  assert.deepEqual(runRowLabel('d', titles), { text: '지워진 항목', linkable: false })
  assert.deepEqual(runRowLabel(null, titles), { text: '지워진 항목', linkable: false })
})
