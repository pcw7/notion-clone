import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { NOTIFY_SLOT as SERVER_SLOT } from '../../../../../lib/automation/actions.ts'
import { joinNotifyMessage, NOTIFY_SLOT, splitNotifyMessage } from './notify-message.ts'

describe('알림 메시지 조각', () => {
  test('화면의 슬롯 정규식은 서버의 것과 같다', () => {
    assert.equal(NOTIFY_SLOT.source, SERVER_SLOT.source)
    assert.equal(NOTIFY_SLOT.flags, SERVER_SLOT.flags)
  })

  test('속성 id 에 s 가 들어 있어도 칩이 된다(역슬래시가 빠졌던 자리)', () => {
    assert.deepEqual(splitNotifyMessage('새 행: {{row:lhOsUycu80}} 끝'), ['새 행: ', 'lhOsUycu80', ' 끝'])
  })

  test('공백이 든 것은 슬롯이 아니다', () => {
    assert.deepEqual(splitNotifyMessage('{{row:a b}}'), ['{{row:a b}}'])
  })

  test('가르고 이으면 그대로다', () => {
    const message = 'a{{row:x_s-1}}b{{row:y}}'
    assert.equal(joinNotifyMessage(splitNotifyMessage(message)), message)
  })
})
