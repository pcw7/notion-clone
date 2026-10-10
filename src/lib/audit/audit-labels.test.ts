/**
 * 감사 로그를 읽는 말 — 게시 · 공유 6d-2 (순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { auditCsv } from './audit-csv.ts'
import { AUDIT_TYPE_LABEL, auditActor, auditDetail } from './audit-labels.ts'
import { AUDIT_EVENT_TYPES, type AuditRow } from './audit-types.ts'

const row = (type: AuditRow['type'], metadata: Record<string, unknown> = {}, extra: Partial<AuditRow> = {}): AuditRow => ({
  id: 'r',
  type,
  occurredAt: '2026-10-11T00:00:00.000Z',
  actor: { userId: 'u', name: '대표', email: 'boss@example.com' },
  target: null,
  ip: null,
  metadata,
  setting: null,
  ...extra,
})

test('종류마다 이름이 있고 겹치지 않는다', () => {
  assert.equal(new Set(AUDIT_EVENT_TYPES.map((t) => AUDIT_TYPE_LABEL[t])).size, AUDIT_EVENT_TYPES.length)
})

test('세부 한 줄 — 종류마다', () => {
  assert.equal(auditDetail(row('account.login', { authMethod: 'password', newAccount: true })), 'password · 새 계정')
  assert.equal(auditDetail(row('account.security_changed', { change: 'mfa_enabled' })), '2단계 인증을 켰다')
  assert.equal(auditDetail(row('workspace.member_invited', { email: 'a@b.c', role: 'member', renewed: true })), 'a@b.c · 멤버 · 다시 보냄')
  assert.equal(auditDetail(row('workspace.member_joined', { role: 'guest', via: 'access_request' })), '게스트 · 접근 요청 허락')
  assert.equal(auditDetail(row('workspace.member_role_changed', { from: 'guest', to: 'member' })), '게스트 → 멤버')
  assert.equal(
    auditDetail(row('workspace.setting_changed', {}, { setting: { key: 'workspace.allow_publish_sites_and_forms', before: true, after: false } })),
    'workspace.allow_publish_sites_and_forms: true → false',
  )
  assert.equal(
    auditDetail(row('page.permission_changed', { change: 'grant', principal: { type: 'user', id: '0123456789abcdef' }, level: 'edit' })),
    '주기 — 사람 01234567 · 편집',
  )
  assert.equal(auditDetail(row('page.permission_changed', { change: 'revoke', principal: { type: 'workspace_everyone', id: null } })), '거두기 — 모든 멤버')
  assert.equal(auditDetail(row('page.publish_changed', { change: 'settings', robots: 'index', rotated: true })), '검색 엔진 노출 켬 · 주소 바꿈')
  assert.equal(auditDetail(row('page.permanently_deleted', { descendants: 3 })), '하위 페이지 3개와 함께')
  assert.equal(auditDetail(row('account.security_changed', { change: 'constructor' })), 'constructor', '원형의 이름을 꺼내지 않는다')
})

test('누가 — 이름(메일) · 없으면 시스템', () => {
  assert.equal(auditActor(row('workspace.exported')), '대표 (boss@example.com)')
  assert.equal(auditActor(row('workspace.exported', {}, { actor: { userId: null, name: null, email: null } })), '시스템')
})

test('★ CSV — BOM · 머리 · 남이 쓴 글자의 수식은 막는다', () => {
  const csv = auditCsv([row('workspace.member_invited', { email: '=HYPERLINK("x")', role: 'member' }, { actor: { userId: 'u', name: '+악성', email: null } })])
  assert.ok(csv.startsWith('﻿시각,종류,누가,대상,세부,IP\r\n'))
  assert.ok(csv.includes(`'+악성`), '이름의 수식을 막는다')
  assert.ok(csv.includes(`"'=HYPERLINK(""x"") · 멤버"`), '세부의 수식을 막고 따옴표를 겹친다')
})
