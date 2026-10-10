/**
 * 자동화 액션의 모양 (5a-1 · 5c-1 · F-08-07 · F-08-13 · 순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACTION_TYPES, IMPLEMENTED_ACTIONS, MAX_ACTIONS, MAX_CELLS_PER_ACTION, parseActions, parseStoredActions } from './actions.ts'

const edit = (cells: unknown[]) => ({ type: 'edit_property', config: { v: 1, cells } })
const cell = (propertyId: string) => ({ propertyId, value: { type: 'number', number: 1 } })

test('★ edit_property 의 모양 — 판 · 셀 목록 · 같은 속성 두 번은 안 된다', () => {
  const ok = parseActions([edit([cell('a'), cell('b')])])
  assert.ok(ok.ok)
  assert.deepEqual(ok.actions, [{ type: 'edit_property', config: { v: 1, cells: [cell('a'), cell('b')] } }])
  assert.deepEqual(parseActions([edit([cell('a'), cell('a')])]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([{ type: 'edit_property', config: { v: 2, cells: [cell('a')] } }]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([edit([{ propertyId: 'a' }])]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([edit([])]), { ok: false, problem: 'empty_cells', index: 0 })
})

test('★ add_page_to 의 모양 — 대상 표 · 템플릿(없으면 null) · 셀은 비어도 된다', () => {
  const ds = '11111111-2222-3333-4444-555555555555'
  const tpl = '66666666-7777-8888-9999-000000000000'
  assert.deepEqual(parseActions([{ type: 'add_page_to', config: { v: 1, dataSourceId: ds, cells: [] } }]), {
    ok: true,
    actions: [{ type: 'add_page_to', config: { v: 1, dataSourceId: ds, cells: [], templateId: null } }],
  })
  const withTemplate = parseActions([{ type: 'add_page_to', config: { v: 1, dataSourceId: ds, cells: [cell('a')], templateId: tpl } }])
  assert.ok(withTemplate.ok && withTemplate.actions[0].type === 'add_page_to' && withTemplate.actions[0].config.templateId === tpl)
  for (const config of [{ v: 1, cells: [] }, { v: 1, dataSourceId: '표', cells: [] }, { v: 1, dataSourceId: ds, cells: [], templateId: 7 }]) {
    assert.deepEqual(parseActions([{ type: 'add_page_to', config }]), { ok: false, problem: 'invalid', index: 0 }, JSON.stringify(config))
  }
})

test('★ 상한 · 아직 실행할 수 없는 종류 · 모르는 종류', () => {
  assert.deepEqual(parseActions(Array.from({ length: MAX_ACTIONS + 1 }, () => edit([cell('a')]))), { ok: false, problem: 'too_many_actions' })
  assert.deepEqual(parseActions([edit(Array.from({ length: MAX_CELLS_PER_ACTION + 1 }, (_, i) => cell(`p${i}`)))]), {
    ok: false,
    problem: 'too_many_cells',
    index: 0,
  })
  for (const type of ACTION_TYPES.filter((t) => !IMPLEMENTED_ACTIONS.includes(t))) {
    assert.deepEqual(parseActions([{ type, config: { v: 1 } }]), { ok: false, problem: 'unsupported_action', index: 0 }, type)
  }
  assert.deepEqual(parseActions([{ type: 'drop_table', config: {} }]), { ok: false, problem: 'unsupported_action', index: 0 })
  assert.deepEqual(parseActions('아님'), { ok: false, problem: 'invalid' })
  assert.deepEqual(parseActions([]), { ok: true, actions: [] }, '액션 0개 — 눌러도 아무 일이 없다')
})

const hook = (config: Record<string, unknown>) => ({ type: 'send_webhook', config: { v: 1, ...config } })
const URL_OK = 'https://hooks.example.com/services/T0/B0/xyz'
const REF = '11111111-2222-3333-4444-555555555555'

test('★ send_webhook 의 모양 — URL 또는 keep · 헤더 이름은 소문자로 · 값을 비우면 옮긴다(null) · 보낼 속성', () => {
  assert.deepEqual(parseActions([hook({ url: URL_OK, headers: [{ name: 'X-Token', value: 's3cret' }], properties: ['a', 'b'] })]), {
    ok: true,
    actions: [{ type: 'send_webhook', config: { v: 1, url: URL_OK, keep: null, headers: [{ name: 'x-token', value: 's3cret' }], properties: ['a', 'b'] } }],
  })
  assert.deepEqual(parseActions([hook({ keep: REF, headers: [{ name: 'x-token' }] })]), {
    ok: true,
    actions: [{ type: 'send_webhook', config: { v: 1, url: null, keep: REF, headers: [{ name: 'x-token', value: null }], properties: [] } }],
  })
  assert.deepEqual(parseActions([hook({})]), { ok: false, problem: 'invalid', index: 0 }, 'URL 도 keep 도 없다')
  assert.deepEqual(parseActions([hook({ keep: '아님' })]), { ok: false, problem: 'invalid', index: 0 })
})

test('★ send_webhook 의 URL 은 페이지 웹훅과 같은 검사 — http · 사설 주소 · 안쪽 이름 · 자격 증명 · 모양', () => {
  for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://10.0.0.8/x', 'https://localhost/x', 'https://u:p@hooks.example.com/x', '아님']) {
    assert.deepEqual(parseActions([hook({ url })]), { ok: false, problem: 'invalid_url', index: 0 }, url)
  }
})

test('★ send_webhook 의 헤더 — 정해진 이름 · 토큰 글자 · 같은 이름(대소문자 없이) · 값의 길이 · 줄바꿈 · 개수', () => {
  const cases: unknown[][] = [
    [{ name: 'Host', value: 'x' }],
    [{ name: 'content-type', value: 'x' }],
    [{ name: 'bad name', value: 'x' }],
    [{ name: 'x-a', value: '1' }, { name: 'X-A', value: '2' }],
    [{ name: 'x-a', value: 'x'.repeat(1025) }],
    [{ name: 'x-a', value: 'x\r\nInjected: 1' }],
    [{ name: 'x-a', value: '' }],
    Array.from({ length: 11 }, (_, i) => ({ name: `x-${i}`, value: 'v' })),
  ]
  for (const headers of cases) {
    assert.deepEqual(parseActions([hook({ url: URL_OK, headers })]), { ok: false, problem: 'invalid_header', index: 0 }, JSON.stringify(headers).slice(0, 80))
  }
})

test('send_webhook 의 상한 — automation 마다 5개 · 보낼 속성 50개 · 같은 속성 두 번은 안 된다', () => {
  const six = Array.from({ length: 6 }, () => hook({ url: URL_OK }))
  assert.deepEqual(parseActions(six), { ok: false, problem: 'too_many_webhooks', index: 5 })
  assert.ok(parseActions(six.slice(0, 5)).ok)
  assert.deepEqual(parseActions([hook({ url: URL_OK, properties: ['a', 'a'] })]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([hook({ url: URL_OK, properties: Array.from({ length: 51 }, (_, i) => `p${i}`) })]), { ok: false, problem: 'invalid', index: 0 })
})

test('저장한 send_webhook 은 봉인된 모양으로만 읽는다 — 평문 URL 은 저장한 것이 아니다', () => {
  const stored = { v: 1, urlSealed: 'AAAA', urlHint: 'hooks.example.com/…/xyz', headers: [{ name: 'x-token', valueSealed: 'BBBB' }], properties: ['a'] }
  assert.deepEqual(parseStoredActions([{ type: 'send_webhook', config: stored }]), { ok: true, actions: [{ type: 'send_webhook', config: stored }] })
  assert.deepEqual(parseStoredActions([{ type: 'send_webhook', config: { v: 1, url: URL_OK } }]), { ok: false, problem: 'invalid', index: 0 })
  assert.deepEqual(parseActions([{ type: 'send_webhook', config: stored }]), { ok: false, problem: 'invalid', index: 0 }, '봉인된 모양을 받지 않는다')
})

test('★ 값 슬롯 — 고정 값 또는 동적 값(지금 · 일하는 행의 속성) · 둘 다 · 모르는 출처는 안 된다', () => {
  const now = { propertyId: 'due', from: { kind: 'now' } }
  const copy = { propertyId: 'copy', from: { kind: 'row_property', propertyId: 'qty' } }
  assert.deepEqual(parseActions([edit([now, copy, cell('a')])]), {
    ok: true,
    actions: [{ type: 'edit_property', config: { v: 1, cells: [now, copy, cell('a')] } }],
  })
  for (const bad of [
    { propertyId: 'x', from: { kind: 'clicker' } },
    { propertyId: 'x', from: { kind: 'row_property' } },
    { propertyId: 'x', from: { kind: 'now' }, value: { type: 'date', date: null } },
    { propertyId: 'x', from: 'now' },
  ]) {
    assert.deepEqual(parseActions([edit([bad])]), { ok: false, problem: 'invalid', index: 0 }, JSON.stringify(bad))
  }
  const ds = '11111111-2222-3333-4444-555555555555'
  assert.ok(parseActions([{ type: 'add_page_to', config: { v: 1, dataSourceId: ds, cells: [copy] } }]).ok, '다른 표에 행 추가도 동적 값을 받는다')
})
