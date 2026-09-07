import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  can,
  capabilitiesOf,
  capabilityList,
  displayLevel,
  isDefinedLevel,
  maxByCap,
  NO_CAPABILITIES,
  unionCaps,
} from './levels.ts'

describe('capabilitiesOf — 정본 §3.3 표', () => {
  test('page/full_access 는 7개 전부', () => {
    assert.deepEqual(capabilityList(capabilitiesOf('page', 'full_access')), [
      'view', 'comment', 'edit_content', 'create_child', 'edit_structure', 'share', 'manage_perm',
    ])
  })

  test('page/edit 은 share·manage_perm 이 없다', () => {
    const caps = capabilitiesOf('page', 'edit')
    assert.equal(can(caps, 'edit_structure'), true)
    assert.equal(can(caps, 'share'), false)
    assert.equal(can(caps, 'manage_perm'), false)
  })

  test('database/create 는 view 를 포함하지 않는다 — 규칙 A2 의 근거', () => {
    const caps = capabilitiesOf('database', 'create')
    assert.equal(can(caps, 'create_child'), true)
    assert.equal(can(caps, 'view'), false)
    assert.equal(can(caps, 'comment'), false)
    assert.equal(can(caps, 'edit_content'), false)
    assert.deepEqual(capabilityList(caps), ['create_child'])
  })

  test('page 에는 edit_content · create 레벨이 없다 (database 전용)', () => {
    assert.equal(isDefinedLevel('page', 'edit_content'), false)
    assert.equal(isDefinedLevel('page', 'create'), false)
    assert.equal(isDefinedLevel('database', 'edit_content'), true)
    assert.equal(isDefinedLevel('database', 'create'), true)
  })

  test('정의되지 않은 조합은 조용히 0 이 아니라 예외', () => {
    // 0 을 돌려주면 "권한 없음"과 "정의 없음"이 구분되지 않는다.
    assert.throws(() => capabilitiesOf('page', 'create'), /level_capability .* 행이 없습니다/)
    assert.throws(() => capabilitiesOf('teamspace', 'view'), /정본 문서/)
  })
})

describe('maxByCap — 단순 정수 MAX 였다면 틀렸을 경우들', () => {
  test('database create + view = {view, create_child}', () => {
    const caps = maxByCap([
      { targetKind: 'database', level: 'create' },
      { targetKind: 'database', level: 'view' },
    ])
    assert.deepEqual(capabilityList(caps), ['view', 'create_child'])
  })

  test('create 와 view 의 합집합이 edit_content 로 승격되지 않는다', () => {
    // 정수 MAX 라면 create(4) > view(1) 이니 create 가 되거나,
    // "가장 가까운 레벨로 올림"을 하면 edit_content 가 되어 comment·edit_content 가 새로 생긴다.
    const caps = maxByCap([
      { targetKind: 'database', level: 'create' },
      { targetKind: 'database', level: 'view' },
    ])
    assert.equal(can(caps, 'comment'), false, 'comment 가 생기면 권한 상승이다')
    assert.equal(can(caps, 'edit_content'), false, 'edit_content 가 생기면 권한 상승이다')
  })

  test('create 만 가진 사용자는 view 를 얻지 못한다', () => {
    const caps = maxByCap([{ targetKind: 'database', level: 'create' }])
    assert.equal(can(caps, 'view'), false)
  })

  test('view 만 가진 사용자는 create_child 를 얻지 못한다', () => {
    const caps = maxByCap([{ targetKind: 'database', level: 'view' }])
    assert.equal(can(caps, 'create_child'), false)
  })

  test('여러 principal 에서 온 grant 는 합집합', () => {
    // 사용자 개인은 comment, 그룹으로는 create
    const caps = maxByCap([
      { targetKind: 'database', level: 'comment' },
      { targetKind: 'database', level: 'create' },
    ])
    assert.deepEqual(capabilityList(caps), ['view', 'comment', 'create_child'])
  })

  test('grant 가 없으면 아무 권한도 없다', () => {
    assert.equal(maxByCap([]), NO_CAPABILITIES)
    assert.equal(can(maxByCap([]), 'view'), false)
  })

  test('순서에 무관하다 (OR 은 교환법칙)', () => {
    const a = maxByCap([
      { targetKind: 'page', level: 'view' },
      { targetKind: 'page', level: 'edit' },
    ])
    const b = maxByCap([
      { targetKind: 'page', level: 'edit' },
      { targetKind: 'page', level: 'view' },
    ])
    assert.equal(a, b)
  })
})

describe('unionCaps', () => {
  test('이미 계산된 CapSet 들을 합친다', () => {
    const local = capabilitiesOf('page', 'comment')
    const inherited = capabilitiesOf('page', 'view')
    assert.deepEqual(capabilityList(unionCaps(local, inherited)), ['view', 'comment'])
  })

  test('빈 입력은 0', () => {
    assert.equal(unionCaps(), NO_CAPABILITIES)
  })
})

describe('displayLevel — 표시 전용, 절대 올림하지 않는다', () => {
  test('정확히 일치하면 그 레벨', () => {
    assert.equal(displayLevel('page', capabilitiesOf('page', 'comment')), 'comment')
    assert.equal(displayLevel('database', capabilitiesOf('database', 'create')), 'create')
  })

  test('일치하는 레벨이 없으면 부분집합 중 가장 큰 것 — 올림하지 않는다', () => {
    // {view, create_child} 를 가진 레벨은 없다.
    // edit_content 로 올리면 comment·edit_content 를 없는데 있다고 표시하게 된다.
    const caps = maxByCap([
      { targetKind: 'database', level: 'create' },
      { targetKind: 'database', level: 'view' },
    ])
    const shown = displayLevel('database', caps)
    assert.notEqual(shown, 'edit_content', '올림하면 권한 상승으로 오인된다')
    assert.ok(shown === 'view' || shown === 'create')
    // 표시된 레벨의 capability 는 실제 capability 의 부분집합이어야 한다
    const shownCaps = capabilitiesOf('database', shown!)
    assert.equal(shownCaps & ~caps, 0, '표시 레벨이 실제보다 많은 권한을 뜻하면 안 된다')
  })

  test('권한이 전혀 없으면 null', () => {
    assert.equal(displayLevel('page', NO_CAPABILITIES), null)
  })

  test('표시 레벨은 언제나 실제 capability 의 부분집합이다', () => {
    // 가능한 모든 조합에 대해 불변식을 확인한다
    const dbLevels = ['view', 'comment', 'edit_content', 'create', 'edit', 'full_access'] as const
    for (const a of dbLevels) {
      for (const b of dbLevels) {
        const caps = maxByCap([
          { targetKind: 'database', level: a },
          { targetKind: 'database', level: b },
        ])
        const shown = displayLevel('database', caps)
        if (shown === null) continue
        const shownCaps = capabilitiesOf('database', shown)
        assert.equal(
          shownCaps & ~caps,
          0,
          `(${a} + ${b}) -> ${shown} 이 실제보다 많은 권한을 표시한다`,
        )
      }
    }
  })
})
