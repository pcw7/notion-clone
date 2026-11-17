/**
 * 공개 API 의 구조 쓰기 요청 — 읽기 · 계획 · 옵션 맞추기 (API-4b · F-09-01 · F-09-16 · 순수)
 *
 *   ★ 타입마다의 설정 — 읽기가 주는 모양을 그대로 받는다(왕복) · 받지 않는 열쇠는 노션의 `should be not present`
 *   ★ 지우기 · 이름 바꾸기 · 타입 바꾸기 · 설정 고치기 · 만들기의 갈림 · 차례(지우기 → 고치기 → 만들기 · relation → rollup → 수식)
 *   ★ 제목 — 지우기 · 바꾸기 · 둘째는 거부 · 새 소스에서는 함께 생긴 제목의 이름이 된다
 *   ★ 옵션 — id · 이름(대소문자 무시)으로 잡기 · 빠진 것은 지우기 · id 로 잡으면 이름도 바꾼다 · 상태의 범주 · 상한
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_SCHEMA_OPTIONS, parseSchemaProperties, planSchema, reconcileOptions, type CurrentProperty, type SchemaEntry } from './schema-request.ts'

const P = 'body.properties'

function entries(raw: unknown): SchemaEntry[] {
  const parsed = parseSchemaProperties(raw, P)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.value
}

function parseError(raw: unknown): string {
  const parsed = parseSchemaProperties(raw, P)
  assert.equal(parsed.ok, false, '거부되어야 한다')
  return parsed.ok ? '' : parsed.message
}

const CURRENT: CurrentProperty[] = [
  { id: 'TITLEID', name: '이름', type: 'title', description: null },
  { id: 'NUMID', name: '점수', type: 'number', description: null },
  { id: 'SELID', name: '종류', type: 'select', description: '분류' },
  { id: 'TXTID', name: '메모', type: 'rich_text', description: null },
]

describe('parseSchemaProperties — 타입마다의 설정', () => {
  test('★ 읽기가 주는 모양을 그대로 받는다(id · name · type · description · 설정)', () => {
    const got = entries({
      이름: { id: 'title', name: '이름', type: 'title', title: {} },
      점수: { id: 'NUMID', name: '점수', type: 'number', number: { format: 'number' } },
      종류: { id: 'SELID', name: '종류', type: 'select', description: '분류', select: { options: [{ id: 'o1', name: '버그', color: 'red' }] } },
      상태: {
        id: 'ST',
        name: '상태',
        type: 'status',
        status: { options: [{ id: 's1', name: '시작 전', color: 'gray' }], groups: [{ id: 'g1', name: 'To-do', color: 'gray', option_ids: ['s1'] }] },
      },
      관련: { id: 'R', name: '관련', type: 'relation', relation: { data_source_id: '0b9c1b7e-5d1c-4c63-9c4a-0d6a8f5f0e11', type: 'dual_property', dual_property: { synced_property_id: 'X', synced_property_name: '역' } } },
      합: { id: 'RU', name: '합', type: 'rollup', rollup: { relation_property_id: 'R', relation_property_name: '관련', rollup_property_id: 'title', rollup_property_name: '이름', function: 'count' } },
      두배: { id: 'F', name: '두배', type: 'formula', formula: { expression: 'prop("점수") * 2' } },
      번호: { id: 'U', name: '번호', type: 'unique_id', unique_id: { prefix: null } },
      버튼: { id: 'B', name: '버튼', type: 'button', button: {} },
    })
    assert.equal(got.length, 9)
    assert.deepEqual(got[1].request, { id: 'NUMID', name: '점수', config: { type: 'number' } })
    assert.deepEqual(got[2].request?.config, { type: 'select', options: [{ id: 'o1', name: '버그', color: 'red' }] })
    assert.deepEqual(got[3].request?.config, { type: 'status', options: [{ id: 's1', name: '시작 전', color: 'gray' }] }, '상태의 groups 는 받고 버린다')
    assert.deepEqual(got[4].request?.config, {
      type: 'relation',
      dataSourceId: '0b9c1b7e-5d1c-4c63-9c4a-0d6a8f5f0e11',
      dual: { syncedId: 'X', syncedName: '역' },
    })
    assert.deepEqual(got[5].request?.config, { type: 'rollup', relation: { id: 'R', name: '관련' }, target: { id: 'title', name: '이름' }, function: 'count' })
    assert.deepEqual(got[6].request?.config, { type: 'formula', expression: 'prop("점수") * 2' })
    assert.deepEqual(got[7].request?.config, { type: 'unique_id', prefix: null })
    assert.equal(got[0].path, 'body.properties.이름')
  })

  test('★ 지우기는 null · type 만 주면 빈 설정 · 단방향 relation', () => {
    const got = entries({ 메모: null, 새: { type: 'checkbox' }, 짝: { relation: { data_source_id: '0b9c1b7e5d1c4c639c4a0d6a8f5f0e11', single_property: {} } } })
    assert.equal(got[0].request, null)
    assert.deepEqual(got[1].request, { config: { type: 'checkbox' } })
    assert.deepEqual(got[2].request?.config, { type: 'relation', dataSourceId: '0b9c1b7e-5d1c-4c63-9c4a-0d6a8f5f0e11', dual: null })
  })

  test('★ 받지 않는 것 — 모르는 열쇠 · 두 타입 · 타입이 엇갈림 · 앱에 없는 타입 · 숫자 형식 · 옵션 설명 · 색 · 상한', () => {
    assert.match(parseError({ 점수: { number: {}, color: 'red' } }), /^body\.properties\.점수\.color should be not present, instead was `"red"`\.$/)
    assert.match(parseError({ 점수: { number: {}, rich_text: {} } }), /should have one property type, instead had "number" and "rich_text"/)
    assert.match(parseError({ 점수: { type: 'number', rich_text: {} } }), /type is "number" but the settings given are for "rich_text"/)
    assert.match(parseError({ 곳: { location: {} } }), /"location" property type is not supported by this app/)
    assert.match(parseError({ 곳: { type: 'nope' } }), /\.type should be a property type/)
    assert.match(parseError({ 점수: { number: { format: 'dollar' } } }), /number\.format `"dollar"` is not supported — numbers have no display format/)
    assert.match(parseError({ 메모: { rich_text: { x: 1 } } }), /rich_text\.x should be not present/)
    assert.match(parseError({ 종류: { select: { options: [{ name: 'a', description: '설명' }] } } }), /option descriptions are not supported/)
    assert.match(parseError({ 종류: { select: { options: [{ name: 'a', color: 'teal' }] } } }), /options\[0\]\.color should be one of "default"/)
    assert.match(parseError({ 종류: { select: { options: [{ color: 'red' }] } } }), /options\[0\] should have an id or a name/)
    assert.match(parseError({ 종류: { select: { options: [{ name: 'a', group: 'To-do' }] } } }), /options\[0\]\.group should be not present/)
    const many = Array.from({ length: MAX_SCHEMA_OPTIONS + 1 }, (_, i) => ({ name: `옵션 ${i}` }))
    assert.match(parseError({ 종류: { select: { options: many } } }), /should have at most 100 items, instead had 101/)
    assert.match(parseError({ 관련: { relation: { data_source_id: 'x' } } }), /relation\.data_source_id should be a valid uuid/)
    assert.match(parseError({ 관련: { relation: { database_id: 'x' } } }), /relation\.database_id should be not present/)
    assert.match(parseError({ 합: { rollup: { function: 'nope' } } }), /rollup\.function should be one of/)
    assert.match(parseError({ 점수: 3 }), /should be an object or `null`/)
    assert.match(parseError([]), /^body\.properties should be an object/)
  })
})

describe('planSchema — 갈림과 차례', () => {
  test('★ 지우기 · 이름 · 설명 · 타입 바꾸기 · 같은 타입의 설정 · 만들기(이름은 열쇠)', () => {
    const plan = planSchema(
      entries({
        두배: { formula: { expression: 'prop("점수")' } },
        메모: null,
        점수: { name: '총점' },
        종류: { multi_select: {} },
        이름: { description: '행의 이름' },
        새: { checkbox: {}, description: '확인' },
        관련: { relation: { data_source_id: '0b9c1b7e-5d1c-4c63-9c4a-0d6a8f5f0e11' } },
      }),
      CURRENT,
      'update',
    )
    assert.ok(plan.ok, plan.ok ? '' : plan.message)
    const steps = plan.value.map((s) => (s.kind === 'create' ? `create:${s.name}:${s.config.type}` : `${s.kind}:${s.property.name}${s.kind === 'edit' ? `:${s.name ?? ''}:${s.convertTo ?? ''}:${s.description ?? ''}` : ''}`))
    assert.deepEqual(steps, [
      'delete:메모',
      'edit:점수:총점::',
      'edit:종류::multi_select:',
      'edit:이름:::행의 이름',
      'create:새:checkbox',
      'create:관련:relation',
      'create:두배:formula',
    ])
  })

  test('★ 같은 값이면 아무 일도 없다(읽기를 그대로 돌려보낸 경우) · id 로 찾는다 · 제목은 title 로', () => {
    const plan = planSchema(
      entries({ 이름: { id: 'title', name: '이름', type: 'title', title: {} }, NUMID: { name: '점수', number: { format: 'number' } }, 종류: { description: '분류' } }),
      CURRENT,
      'update',
    )
    assert.ok(plan.ok)
    for (const step of plan.value) {
      assert.equal(step.kind, 'edit')
      if (step.kind === 'edit') assert.deepEqual([step.name, step.description, step.convertTo], [undefined, undefined, undefined])
    }
    const renamed = planSchema(entries({ title: { name: '제목' } }), CURRENT, 'update')
    assert.ok(renamed.ok && renamed.value[0].kind === 'edit' && renamed.value[0].property.id === 'TITLEID' && renamed.value[0].name === '제목')
  })

  test('★ 거부 — 제목 지우기 · 바꾸기 · 둘째 제목 · 바꿀 수 없는 변환 · 없는 것 지우기 · 타입 없는 새 이름 · 버튼 만들기 · 두 번', () => {
    const reject = (raw: unknown, re: RegExp, mode: 'create' | 'update' = 'update') => {
      const plan = planSchema(entries(raw), CURRENT, mode)
      assert.equal(plan.ok, false)
      if (!plan.ok) assert.match(plan.message, re)
    }
    reject({ 이름: null }, /title property cannot be deleted/)
    reject({ title: { rich_text: {} } }, /title property cannot be converted/)
    reject({ 점수: { title: {} } }, /cannot become title/)
    reject({ 둘째: { title: {} } }, /exactly one title property/)
    reject({ 점수: { people: {} } }, /a number property cannot be converted to people/)
    reject({ 메모: { formula: { expression: '1' } } }, /cannot be converted to formula/)
    reject({ 없음: null }, /^없음 is not a property that exists\.$/)
    reject({ 없음: { name: '새 이름' } }, /없음 is not a property that exists\. To create it, give its type/)
    reject({ 버튼: { button: {} } }, /button properties cannot be created through the API/)
    reject({ 점수: { name: 'a' }, NUMID: { name: 'b' } }, /are the same property "점수"/)
    reject({ 점수: { id: 'SELID', name: 'x' } }, /\.id `"SELID"` does not match the property "점수"/)
    reject({ 새: { relation: {} } }, /relation\.data_source_id should be defined/)
    reject({ 새: { formula: {} } }, /formula\.expression should be defined/)
    reject({ 새: { rollup: { function: 'count' } } }, /rollup should give relation_property_id/)
  })

  test('★ 새 소스 — 요청의 제목 타입 속성은 함께 생긴 제목의 이름이 된다(키가 이름) · 둘이면 거부', () => {
    const fresh: CurrentProperty[] = [{ id: 'T0', name: '이름', type: 'title', description: null }]
    const plan = planSchema(entries({ 할일: { title: {} }, 기한: { date: {} } }), fresh, 'create')
    assert.ok(plan.ok)
    assert.deepEqual(plan.value.map((s) => [s.kind, s.kind === 'create' ? s.name : s.kind === 'edit' ? s.name : '']), [['edit', '할일'], ['create', '기한']])
    const two = planSchema(entries({ 가: { title: {} }, 나: { title: {} } }), fresh, 'create')
    assert.equal(two.ok, false)
  })
})

describe('reconcileOptions — 남길 목록', () => {
  const current = [
    { id: 'a', name: '버그', color: 'red' as const },
    { id: 'b', name: '기능', color: 'blue' as const },
    { id: 'c', name: '문서', color: 'gray' as const },
  ]
  const at = `${P}.종류.select.options`

  test('★ id · 이름(대소문자 · 공백 무시)으로 잡기 · 빠진 것은 지우기 · 새 이름은 더하기 · id 로 잡으면 이름 · 색도', () => {
    const plan = reconcileOptions(current, [{ id: 'a', name: '결함', color: 'orange' }, { name: ' 기능 ' }, { name: '새 것', color: 'green' }], 'select', at, { matchIds: true })
    assert.ok(plan.ok, plan.ok ? '' : plan.message)
    assert.deepEqual(plan.value, {
      deletes: ['c'],
      updates: [{ id: 'a', name: '결함', color: 'orange' }],
      adds: [{ name: '새 것', color: 'green' }],
    })
  })

  test('★ 같은 목록이면 아무것도 없다(왕복)', () => {
    const plan = reconcileOptions(current, current.map((o) => ({ ...o })), 'select', at, { matchIds: true })
    assert.ok(plan.ok)
    assert.deepEqual(plan.value, { deletes: [], updates: [], adds: [] })
  })

  test('★ 만들 때는 id 를 보지 않는다 · 없는 id 는 거부 · 같은 옵션 두 번 · 같은 이름 둘', () => {
    const fresh = reconcileOptions([], [{ id: 'zzz', name: '하나' }], 'select', at, { matchIds: false })
    assert.ok(fresh.ok && fresh.value.adds[0].name === '하나')
    const missing = reconcileOptions(current, [{ id: 'zzz' }], 'select', at, { matchIds: true })
    assert.ok(!missing.ok && /options\[0\]\.id `"zzz"` is not an option of this property/.test(missing.message))
    const twice = reconcileOptions(current, [{ id: 'a' }, { name: '버그' }], 'select', at, { matchIds: true })
    assert.ok(!twice.ok && /already given/.test(twice.message))
    const clash = reconcileOptions(current, [{ id: 'a', name: '기능' }, { id: 'b' }], 'select', at, { matchIds: true })
    assert.ok(!clash.ok && /two options named "기능"/.test(clash.message))
  })

  test('★ 상태의 범주 — 노션의 이름 · kind · 범주 id · 모르는 범주는 거부 · 새 옵션의 범주', () => {
    const status = [
      { id: 's1', name: '시작 전', color: 'gray' as const, group: 'todo' as const },
      { id: 's2', name: '진행 중', color: 'blue' as const, group: 'in_progress' as const },
    ]
    const groups = new Map([['G3', 'complete' as const]])
    const plan = reconcileOptions(status, [{ id: 's1', group: 'In progress' }, { id: 's2', group: 'G3' }, { name: '보류', group: 'todo' }], 'status', at, { matchIds: true, groups })
    assert.ok(plan.ok, plan.ok ? '' : plan.message)
    assert.deepEqual(plan.value.updates, [{ id: 's1', group: 'in_progress' }, { id: 's2', group: 'complete' }])
    assert.deepEqual(plan.value.adds, [{ name: '보류', group: 'todo' }])
    const bad = reconcileOptions(status, [{ name: 'x', group: 'Later' }], 'status', at, { matchIds: true, groups })
    assert.ok(!bad.ok && /group should be "To-do", "In progress" or "Complete"/.test(bad.message))
  })
})
