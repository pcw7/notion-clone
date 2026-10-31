// 붙인 뷰의 화면 권한을 동작마다 가른다(N-2 · F-04-13) — 순수 모듈.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { DatabaseAccess } from './database.ts'
import { NO_DATABASE_ACCESS, splitLinkedAccess, viewAccessOf } from './linked-access.ts'

const FULL: DatabaseAccess = { canViewAllRows: true, canEditContent: true, canCreateRows: true, canEditStructure: true }
const VIEW_ONLY: DatabaseAccess = { canViewAllRows: true, canEditContent: false, canCreateRows: false, canEditStructure: false }
const CONTENT: DatabaseAccess = { canViewAllRows: true, canEditContent: true, canCreateRows: true, canEditStructure: false }

describe('붙인 뷰의 권한 — 동작마다 (N-2)', () => {
  test('소유한 소스의 뷰 — 둘 다 그릇의 것', () => {
    const split = splitLinkedAccess(CONTENT, null)
    assert.equal(split.access, CONTENT)
    assert.deepEqual(split.viewAccess, { canEditContent: true, canEditStructure: false })
  })

  test('★ 그릇은 볼 수만 있고 원본은 고칠 수 있다 — 칸 · 행은 열리고 뷰 안의 차례 · 설정은 닫힌다(§7 의 과소 표시를 고친다)', () => {
    const split = splitLinkedAccess(VIEW_ONLY, FULL)
    assert.equal(split.access, FULL)
    assert.deepEqual(split.viewAccess, { canEditContent: false, canEditStructure: false })
  })

  test('★ 그릇은 고칠 수 있고 원본은 볼 수만 있다 — 칸 · 행은 닫히고 뷰 안의 차례 · 설정은 열린다', () => {
    const split = splitLinkedAccess(FULL, VIEW_ONLY)
    assert.equal(split.access, VIEW_ONLY)
    assert.deepEqual(split.viewAccess, { canEditContent: true, canEditStructure: true })
  })

  test('원본을 볼 수 없다 — 모두 닫힌다', () => {
    const split = splitLinkedAccess(FULL, 'hidden')
    assert.deepEqual(split.access, NO_DATABASE_ACCESS)
    assert.deepEqual(split.viewAccess, { canEditContent: false, canEditStructure: false })
  })

  test('viewAccessOf 는 둘만 남긴다', () => {
    assert.deepEqual(viewAccessOf(CONTENT), { canEditContent: true, canEditStructure: false })
  })
})
