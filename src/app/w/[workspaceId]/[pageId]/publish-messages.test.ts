/**
 * 웹 게시 절의 문구 — 게시 · 공유 6a-3 (순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { PublishFailure } from '../../../../lib/publish/public-link.ts'
import { coveredMessage, publicUrlOf, publishFailureMessage, publishPolicyNotice } from './publish-messages.ts'

test('실패 까닭을 사람의 말로 — 모르는 까닭은 일반 문구', () => {
  assert.equal(publishFailureMessage('policy_disabled'), '워크스페이스 정책이 웹 게시를 막았습니다.')
  assert.equal(publishFailureMessage('forbidden'), '전체 권한이 있어야 웹에 게시할 수 있습니다.')
  assert.equal(publishFailureMessage('trashed'), '휴지통의 페이지는 게시할 수 없습니다.')
  assert.equal(publishFailureMessage('뭔가'), '바꾸지 못했습니다.')
  assert.equal(publishFailureMessage(undefined), '바꾸지 못했습니다.')
  assert.equal(publishFailureMessage('constructor'), '바꾸지 못했습니다.', '객체의 속성 이름이 문구가 되지 않는다')
})

test('★ 서버의 까닭마다 할 말이 있다 — 슬러그 둘(6c-2)도', () => {
  // `invalid_input` 은 일반 문구 그대로다(몸체가 틀린 것은 화면의 잘못)
  const reasons: Exclude<PublishFailure, 'invalid_input'>[] = [
    'not_found', 'forbidden', 'not_page', 'trashed', 'policy_disabled', 'publishing_blocked', 'not_published', 'moderated', 'invalid_slug', 'slug_taken',
  ]
  for (const reason of reasons) assert.notEqual(publishFailureMessage(reason), '바꾸지 못했습니다.', reason)
  // 운영자의 게시 차단(6b-3a)은 소유자 정책과 다른 말 — 소유자가 설정으로 풀 수 없다
  assert.notEqual(publishFailureMessage('publishing_blocked'), publishFailureMessage('policy_disabled'))
  assert.match(publishFailureMessage('publishing_blocked'), /운영 정책/)
})

test('정책 줄(6b-3b) — 운영자의 잠금은 "운영 정책" · 설정으로 풀 수 없다고 · 소유자 정책은 그대로', () => {
  assert.match(publishPolicyNotice(true), /운영 정책/)
  assert.match(publishPolicyNotice(true), /설정으로 풀 수 없습니다/)
  assert.equal(publishPolicyNotice(false), '워크스페이스 정책이 웹 게시를 막았습니다. 게시된 주소도 지금은 열리지 않습니다.')
})

test('위 페이지의 게시 — 볼 수 없으면 이름 없이 · 빈 제목은 "제목 없음"', () => {
  assert.equal(coveredMessage(null), '위 페이지가 웹에 게시되어 이 페이지도 공개되어 있습니다.')
  assert.equal(coveredMessage(' 위키 '), '위 페이지 "위키" 이(가) 웹에 게시되어 이 페이지도 공개되어 있습니다.')
  assert.equal(coveredMessage(''), '위 페이지 "제목 없음" 이(가) 웹에 게시되어 이 페이지도 공개되어 있습니다.')
})

test('공개 주소 — 끝의 / 를 겹치지 않는다', () => {
  assert.equal(publicUrlOf('http://localhost:3000', 'abc'), 'http://localhost:3000/p/abc')
  assert.equal(publicUrlOf('https://x.example/', 'abc'), 'https://x.example/p/abc')
})
