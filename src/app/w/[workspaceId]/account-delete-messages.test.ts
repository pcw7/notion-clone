import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  accountDeleteFailureMessage,
  afterDeletionPath,
  blockedReason,
  canConfirmDeletion,
  outcomeLabel,
  type DeletionRow,
} from './account-delete-messages.ts'

const solo: DeletionRow = { id: 'a', name: '혼자', outcome: 'delete' }
const shared: DeletionRow = { id: 'b', name: '공동', outcome: 'leave' }
const sole: DeletionRow = { id: 'c', name: '유일', outcome: 'blocked', reason: 'sole_owner' }
const team: DeletionRow = { id: 'd', name: '팀', outcome: 'blocked', reason: 'teamspace_last_owner', teamspaces: ['디자인', '개발'] }

describe('계정 삭제의 말', () => {
  it('결과마다 한 줄', () => {
    assert.equal(outcomeLabel('delete'), '함께 지워집니다')
    assert.equal(outcomeLabel('leave'), '이 워크스페이스에서 나갑니다')
    assert.equal(outcomeLabel('blocked'), '먼저 해결해야 합니다')
  })
  it('막힌 까닭 — 유일 owner · 팀스페이스 이름들 · 막히지 않은 줄은 빈 말', () => {
    assert.match(blockedReason(sole), /owner 로 올리거나 워크스페이스를 지우세요/)
    assert.match(blockedReason(team), /디자인 · 개발/)
    assert.equal(blockedReason(solo), '')
  })
  it('삭제 단추 — 막힌 줄이 없고 이메일이 같을 때만(대소문자 무관)', () => {
    assert.equal(canConfirmDeletion(null, 'a@b.c', 'a@b.c'), false)
    assert.equal(canConfirmDeletion([solo, shared], 'A@B.C', 'a@b.c'), true)
    assert.equal(canConfirmDeletion([solo, shared], 'x@b.c', 'a@b.c'), false)
    assert.equal(canConfirmDeletion([solo, sole], 'a@b.c', 'a@b.c'), false)
    assert.equal(canConfirmDeletion([], '', ''), false)
  })
  it('실패 문구 · 끝난 뒤 가는 곳', () => {
    assert.match(accountDeleteFailureMessage('email_mismatch'), /이메일이 다릅니다/)
    assert.match(accountDeleteFailureMessage('blocked'), /해결해야/)
    assert.match(accountDeleteFailureMessage(undefined), /삭제하지 못했습니다/)
    assert.equal(afterDeletionPath(true), '/')
    assert.equal(afterDeletionPath(false), '/login')
  })
})
