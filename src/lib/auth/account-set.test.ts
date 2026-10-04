/**
 * 한 브라우저에 로그인한 계정들 — 잔여 묶음 8j-2 (DB · 쿠키 없음)
 *
 *   ① 쿠키 — 토큰 모양만 · 겹치면 한 번 · 다른 계정은 넷까지
 *   ② 더하기 — 앞의 활성이 다른 사람의 살아 있는 세션이면 목록 맨 앞으로 · 같은 사람이면 폐기 · 죽었으면 뺀다
 *   ③ 그냥 로그인 — 앞의 활성은 빠질 뿐 폐기하지 않는다 · 새로 들어온 사람의 옛 토큰은 폐기
 *   ④ 다섯을 넘으면 오래된 쪽을 폐기
 *   ⑤ 바꾸기 — 살아 있는 세션만 · 죽었으면 signed_out · 없으면 not_found · 둘째 단계 전이면 알린다 · 지금 계정은 목록 맨 앞으로
 *   ⑥ 로그아웃 — 지금 계정(다음 살아 있는 계정이 활성) · 한 계정 · 모두
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_SIGNED_IN_ACCOUNTS,
  parseAccountTokens,
  planLogin,
  planLogout,
  planSwitch,
  serializeAccountTokens,
  type TokenInfo,
} from './account-set.ts'

const tok = (c: string) => c.repeat(43)
const info = (c: string, userId: string, over: Partial<TokenInfo> = {}): TokenInfo => ({ token: tok(c), userId, live: true, mfaPending: false, expiresAt: new Date(0), ...over })

test('★ ① 쿠키 — 토큰 모양만 · 겹치면 한 번 · 다른 계정은 넷까지', () => {
  assert.deepEqual(parseAccountTokens(undefined), [])
  assert.deepEqual(parseAccountTokens(''), [])
  assert.deepEqual(parseAccountTokens(`${tok('a')}.bad.${tok('a')}.${tok('b')}`), [tok('a'), tok('b')])
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map(tok)
  assert.equal(parseAccountTokens(serializeAccountTokens(many)).length, MAX_SIGNED_IN_ACCOUNTS - 1)
})

test('★ ② 더하기 — 다른 사람의 살아 있는 활성은 목록 맨 앞 · 같은 사람은 폐기 · 죽었으면 뺀다', () => {
  const fresh = { token: tok('n'), userId: 'new' }
  const added = planLogin({ previous: info('a', 'A'), others: [info('b', 'B')], fresh, keepPrevious: true })
  assert.deepEqual(added, { active: tok('n'), others: [tok('a'), tok('b')], revoke: [] })

  const same = planLogin({ previous: info('a', 'new'), others: [], fresh, keepPrevious: true })
  assert.deepEqual(same, { active: tok('n'), others: [], revoke: [tok('a')] })

  const dead = planLogin({ previous: info('a', 'A', { live: false }), others: [], fresh, keepPrevious: true })
  assert.deepEqual(dead, { active: tok('n'), others: [], revoke: [] })
})

test('③ 그냥 로그인 — 앞의 활성은 빠질 뿐 · 새로 들어온 사람의 옛 토큰(죽은 것도)은 폐기', () => {
  const fresh = { token: tok('n'), userId: 'B' }
  const plan = planLogin({ previous: info('a', 'A'), others: [info('b', 'B', { live: false }), info('c', 'C')], fresh, keepPrevious: false })
  assert.deepEqual(plan, { active: tok('n'), others: [tok('c')], revoke: [tok('b')] })
})

test('④ 다섯을 넘으면 오래된 쪽(목록의 뒤)을 폐기한다 · 같은 사람은 한 번', () => {
  const fresh = { token: tok('n'), userId: 'N' }
  const others = [info('b', 'B'), info('c', 'C'), info('d', 'D'), info('e', 'E'), info('f', 'B')]
  const plan = planLogin({ previous: info('a', 'A'), others, fresh, keepPrevious: true })
  assert.deepEqual(plan.others, [tok('a'), tok('b'), tok('c'), tok('d')])
  assert.deepEqual([...plan.revoke].sort(), [tok('e'), tok('f')].sort())
})

test('★ ⑤ 바꾸기 — 살아 있는 세션만 · 지금 계정은 목록 맨 앞으로', () => {
  const active = info('a', 'A')
  const others = [info('b', 'B'), info('c', 'C', { live: false }), info('d', 'D', { mfaPending: true })]
  assert.deepEqual(planSwitch({ active, others, userId: 'B' }), {
    ok: true,
    plan: { active: tok('b'), others: [tok('a'), tok('c'), tok('d')], revoke: [] },
    mfaPending: false,
  })
  assert.deepEqual(planSwitch({ active, others, userId: 'C' }), { ok: false, reason: 'signed_out' })
  assert.deepEqual(planSwitch({ active, others, userId: 'Z' }), { ok: false, reason: 'not_found' })
  const pending = planSwitch({ active, others, userId: 'D' })
  assert.equal(pending.ok && pending.mfaPending, true)
  // 지금 계정으로 바꾸면 아무것도 바뀌지 않는다
  assert.deepEqual(planSwitch({ active, others, userId: 'A' }), {
    ok: true,
    plan: { active: tok('a'), others: others.map((i) => i.token), revoke: [] },
    mfaPending: false,
  })
})

test('★ ⑥ 로그아웃 — 지금 계정 · 한 계정 · 모두', () => {
  const active = info('a', 'A')
  const others = [info('b', 'B', { live: false }), info('c', 'C'), info('d', 'D')]
  assert.deepEqual(planLogout({ active, others, scope: { kind: 'current' } }), {
    active: tok('c'),
    others: [tok('b'), tok('d')],
    revoke: [tok('a')],
  })
  assert.deepEqual(planLogout({ active, others: [info('b', 'B', { live: false })], scope: { kind: 'current' } }), {
    active: null,
    others: [tok('b')],
    revoke: [tok('a')],
  })
  assert.deepEqual(planLogout({ active, others, scope: { kind: 'account', userId: 'D' } }), {
    active: tok('a'),
    others: [tok('b'), tok('c')],
    revoke: [tok('d')],
  })
  // 지금 계정을 이름으로 골라도 "지금 계정만"과 같다
  assert.deepEqual(planLogout({ active, others, scope: { kind: 'account', userId: 'A' } }), planLogout({ active, others, scope: { kind: 'current' } }))
  assert.deepEqual(planLogout({ active, others, scope: { kind: 'all' } }), {
    active: null,
    others: [],
    revoke: [tok('a'), tok('b'), tok('c'), tok('d')],
  })
})
