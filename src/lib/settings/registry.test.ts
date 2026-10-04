/**
 * 설정 레지스트리 — 설정 정보구조 8g-1조각 (F-17-12, DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 선언이 맞물린다 — 키는 하나씩 · 항목의 절은 내비에 있고 같은 범위의 묶음 안이다
 *   ② **고치는 사람은 늘 보는 사람 안에 있다** — 보이지 않는 것을 고칠 수 없다
 *   ③ 계정 범위는 모두(게스트 포함) · 워크스페이스 범위는 게스트에게 보이지 않는다
 *   ④ 내비 — 보이는 항목이 있는 절만 · 절이 있는 묶음만
 *   ⑤ 값의 규칙 — 글자는 공백을 정리한 뒤 1 ~ maxLength · 켜고 끄기는 참거짓만
 *   ⑥ 읽기 전용의 안내 — 누가 바꿀 수 있는지
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { WORKSPACE_ROLES } from '../auth/session-context.ts'
import {
  SETTINGS,
  SETTING_GROUPS,
  canEditSetting,
  canSeeSetting,
  editorsNote,
  normalizeSettingValue,
  settingDefinition,
  visibleSettingGroups,
} from './registry.ts'

describe('① 선언이 맞물린다', () => {
  test('키는 하나씩 · 항목의 절은 내비에 있고 같은 범위의 묶음 안이다', () => {
    assert.equal(new Set(SETTINGS.map((d) => d.key)).size, SETTINGS.length)
    for (const definition of SETTINGS) {
      const group = SETTING_GROUPS.find((g) => g.sections.some((s) => s.id === definition.section))
      assert.ok(group !== undefined, `${definition.key} 의 절이 내비에 없다`)
      assert.equal(group.scope, definition.scope, `${definition.key} 가 다른 범위의 묶음에 있다`)
    }
    assert.equal(settingDefinition('workspace.name')?.key, 'workspace.name')
    assert.equal(settingDefinition('없는.키'), null)
  })
})

describe('② · ③ 누가', () => {
  test('★ 고치는 사람은 늘 보는 사람 안에 있다', () => {
    for (const definition of SETTINGS) {
      for (const role of WORKSPACE_ROLES) {
        if (canEditSetting(definition, role)) assert.ok(canSeeSetting(definition, role), `${definition.key} · ${role}`)
      }
      // 선언 자체도 — 고치는 사람 목록이 보는 사람 목록을 넘지 않는다.
      if (definition.editors !== 'everyone' && definition.viewers !== 'everyone') {
        for (const role of definition.editors) assert.ok((definition.viewers as readonly string[]).includes(role), `${definition.key} · ${role}`)
      }
    }
  })

  test('★ 선언이 어긋나도 보이지 않는 것은 고칠 수 없다 — 판정이 막는다', () => {
    // 고치는 사람이 보는 사람을 넘는 잘못된 선언 — 위 검사가 실제 선언에서 막지만, 판정도 혼자 막아야 한다.
    const skewed = { ...settingDefinition('workspace.name')!, viewers: ['owner'], editors: 'everyone' } as const
    assert.equal(canEditSetting(skewed, 'member'), false)
    assert.equal(canEditSetting(skewed, 'owner'), true)
  })

  test('★ 계정 범위는 게스트에게도 · 워크스페이스 범위는 게스트에게 보이지 않는다', () => {
    for (const definition of SETTINGS) {
      if (definition.scope === 'account') assert.ok(canEditSetting(definition, 'guest'), `게스트가 자기 ${definition.key} 를 못 고친다`)
      if (definition.scope === 'workspace') assert.ok(!canSeeSetting(definition, 'guest'), `게스트에게 ${definition.key} 가 보인다`)
    }
  })
})

describe('④ 내비', () => {
  const sectionsOf = (role: (typeof WORKSPACE_ROLES)[number]) => visibleSettingGroups(role).map((g) => [g.scope, g.sections.map((s) => s.id)])

  test('★ 보이는 항목이 있는 절만 · 절이 있는 묶음만', () => {
    assert.deepEqual(sectionsOf('owner'), [
      ['account', ['account.profile']],
      ['workspace', ['workspace.general', 'workspace.security']],
    ])
    // 멤버에게는 보안 절이 없다(정책은 소유자만 본다) — 일반 절은 읽기 전용으로 선다.
    assert.deepEqual(sectionsOf('member'), [
      ['account', ['account.profile']],
      ['workspace', ['workspace.general']],
    ])
    assert.deepEqual(sectionsOf('guest'), [['account', ['account.profile']]], '게스트에게 워크스페이스 묶음이 섰다')
  })
})

describe('⑤ 값의 규칙', () => {
  const name = settingDefinition('workspace.name')!
  const policy = settingDefinition('workspace.allow_nonmember_page_access_request')!

  test('글자 — 앞뒤 공백을 떼고 연속 공백을 접는다 · 비거나 길면 · 글자가 아니면 null', () => {
    assert.equal(normalizeSettingValue(name, '  우리   팀\t공간 '), '우리 팀 공간')
    assert.equal(normalizeSettingValue(name, 'a'.repeat(100)), 'a'.repeat(100))
    for (const bad of ['', '   ', 'a'.repeat(101), 3, null, undefined, true]) {
      assert.equal(normalizeSettingValue(name, bad), null, JSON.stringify(bad))
    }
  })

  test('켜고 끄기 — 참거짓만', () => {
    assert.equal(normalizeSettingValue(policy, false), false)
    assert.equal(normalizeSettingValue(policy, true), true)
    for (const bad of ['false', 0, 1, null, undefined, {}]) assert.equal(normalizeSettingValue(policy, bad), null, JSON.stringify(bad))
  })
})

describe('⑥ 읽기 전용의 안내', () => {
  test('모두가 고치면 없다 · 아니면 누가 바꾸는지', () => {
    assert.equal(editorsNote(settingDefinition('account.name')!), null)
    assert.equal(editorsNote(settingDefinition('workspace.name')!), '소유자만 바꿀 수 있습니다.')
  })
})
