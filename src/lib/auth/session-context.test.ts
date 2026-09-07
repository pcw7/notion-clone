import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  canEnterWorkspace,
  hashSessionToken,
  sessionTokenMatches,
  type AuthMethod,
  type WorkspaceRole,
} from './session-context.ts'

describe('canEnterWorkspace — 0단계 게이트 (정본 §3.11, 14 R-11)', () => {
  const ALL_METHODS: AuthMethod[] = [
    'login_code', 'password', 'passkey', 'google', 'apple', 'microsoft', 'saml',
  ]
  const ALL_ROLES: WorkspaceRole[] = [
    'owner', 'membership_admin', 'member', 'restricted_member', 'guest',
  ]

  test('SSO 강제가 아니면 누구나 통과', () => {
    for (const authMethod of ALL_METHODS) {
      for (const role of ALL_ROLES) {
        assert.equal(
          canEnterWorkspace({ ssoEnforced: false, authMethod, role }),
          true,
          `${authMethod}/${role} 이 막혔다`,
        )
      }
    }
  })

  test('SSO 강제면 saml 로그인은 언제나 통과', () => {
    for (const role of ALL_ROLES) {
      assert.equal(canEnterWorkspace({ ssoEnforced: true, authMethod: 'saml', role }), true)
    }
  })

  test('SSO 강제면 owner 와 guest 만 예외', () => {
    // owner 예외: SSO 를 잘못 설정하고 자기 워크스페이스에서 잠기는 것을 막는다
    // guest 예외: 외부인은 조직 IdP 계정을 가질 수 없다
    assert.equal(canEnterWorkspace({ ssoEnforced: true, authMethod: 'password', role: 'owner' }), true)
    assert.equal(canEnterWorkspace({ ssoEnforced: true, authMethod: 'password', role: 'guest' }), true)
  })

  test('SSO 강제면 나머지 역할은 비-saml 로 못 들어온다', () => {
    const blocked: WorkspaceRole[] = ['membership_admin', 'member', 'restricted_member']
    for (const role of blocked) {
      for (const authMethod of ALL_METHODS.filter((m) => m !== 'saml')) {
        assert.equal(
          canEnterWorkspace({ ssoEnforced: true, authMethod, role }),
          false,
          `${authMethod}/${role} 이 통과했다 — SSO 강제가 무력화된다`,
        )
      }
    }
  })

  test('membership_admin 은 예외가 아니다', () => {
    // 관리자 역할이 콘텐츠 접근 예외를 만들지 않는다는 정본 원칙과 일관된다.
    assert.equal(
      canEnterWorkspace({ ssoEnforced: true, authMethod: 'google', role: 'membership_admin' }),
      false,
    )
  })
})

describe('세션 토큰 해시', () => {
  test('같은 토큰은 같은 해시', () => {
    assert.equal(hashSessionToken('abc'), hashSessionToken('abc'))
  })

  test('다른 토큰은 다른 해시', () => {
    assert.notEqual(hashSessionToken('abc'), hashSessionToken('abd'))
  })

  test('해시는 원문을 담지 않는다', () => {
    const token = 'super-secret-token-value'
    assert.ok(!hashSessionToken(token).includes(token))
    assert.equal(hashSessionToken(token).length, 64) // sha256 hex
  })

  test('일치 검사', () => {
    const token = 'tok_' + 'a'.repeat(40)
    assert.equal(sessionTokenMatches(token, hashSessionToken(token)), true)
    assert.equal(sessionTokenMatches(token + 'x', hashSessionToken(token)), false)
  })

  test('길이가 다른 저장 해시에도 던지지 않고 false', () => {
    // timingSafeEqual 은 길이가 다르면 예외를 던진다. 먼저 걸러야 한다.
    assert.equal(sessionTokenMatches('anything', 'deadbeef'), false)
    assert.equal(sessionTokenMatches('anything', ''), false)
  })
})
