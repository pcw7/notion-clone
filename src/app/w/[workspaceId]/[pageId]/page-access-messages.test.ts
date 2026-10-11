/**
 * "페이지 단위 접근" 절의 문구 — 6f-2c (F-06-10 · 순수)
 *
 *   ① 레벨 고르개는 "없음" + 서버가 규칙에 받는 페이지 레벨 넷이다(0089 의 CHECK · `isGrantableLevel('page')`)
 *   ② 줄 이름 · 보는 사람의 레벨 이름
 *   ③ 실패 까닭마다 할 말이 있다 · 모르는 까닭 · 원형의 이름은 일반 문구
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { LEVELS, isGrantableLevel } from '../../../../lib/permissions/levels.ts'
import type { AccessRuleFailure } from '../../../../lib/permissions/access-rule.ts'
import { NO_RULE, RULE_LEVEL_OPTIONS, pageAccessFailureMessage, ruleLevelLabel, ruleRowLabel } from './page-access-messages.ts'

describe('① 레벨 고르개', () => {
  test('★ "없음" + 서버가 받는 페이지 레벨 넷 — 데이터베이스 전용 레벨은 없다', () => {
    assert.deepEqual(
      RULE_LEVEL_OPTIONS.map((o) => o.value),
      [NO_RULE, ...LEVELS.filter((l) => isGrantableLevel('page', l))],
    )
    assert.deepEqual(RULE_LEVEL_OPTIONS.map((o) => o.label), ['없음', '읽기', '댓글', '편집', '전체 권한'])
  })
})

describe('② 이름', () => {
  test('소스가 하나면 "만든 사람" · 여럿이면 소스 이름을 앞에 · 보는 사람에게는 레벨 이름(없으면 "없음")', () => {
    assert.equal(ruleRowLabel(null), '만든 사람')
    assert.equal(ruleRowLabel('제출'), '제출 · 만든 사람')
    assert.equal(ruleLevelLabel(NO_RULE), '없음')
    assert.equal(ruleLevelLabel(null), '없음')
    assert.equal(ruleLevelLabel('edit'), '편집')
  })
})

describe('③ 실패 문구', () => {
  test('★ 서버의 까닭마다 할 말 · 모르는 까닭 · 원형의 이름은 일반 문구', () => {
    const reasons: AccessRuleFailure[] = ['not_found', 'forbidden', 'invalid_level', 'unsupported_source', 'invalid_property']
    for (const reason of reasons) assert.notEqual(pageAccessFailureMessage(reason), '바꾸지 못했습니다.', reason)
    assert.equal(pageAccessFailureMessage('forbidden'), '전체 권한이 있어야 페이지 단위 접근을 바꿀 수 있습니다.')
    assert.equal(pageAccessFailureMessage('invalid_input'), '바꾸지 못했습니다.')
    assert.equal(pageAccessFailureMessage('constructor'), '바꾸지 못했습니다.')
    assert.equal(pageAccessFailureMessage(undefined), '바꾸지 못했습니다.')
  })
})
