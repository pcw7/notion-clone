/**
 * 이 표의 구조를 고칠 수 있나 — `canEditSchema` (10n-49 · HANDOFF §3.2-293 · F-03-10)
 *
 * 관계형 폼이 "반대쪽에도 표시"를 미리 끄는 판정이다. 고치는 명령이 지나는 문(`lockSchema`)과 같아야 한다 — 그래서 같은 함수를
 * 잠그지 않고 부른다. 이 파일은 그 판정이 명령의 거부와 맞는지 본다.
 *
 *   ① 주인 — 고칠 수 있다
 *   ② ★ 데이터베이스에 "내용 편집"만 받은 사람 — 값은 고쳐도 구조는 아니다(false) · 실제로 양방향을 만들면 대상 쪽이 거부한다
 *   ③ ★ 잠긴 데이터베이스 — 주인도 false
 *   ④ 볼 수 없는 표 · 없는 표 · id 가 아닌 값 — false
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setDatabaseLock } from '../permissions/lock.ts'
import { createDatabase } from './database.ts'
import { canEditSchema } from './property.ts'
import { addRelationProperty } from './relation.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

async function world() {
  const ws = await createBareWorkspace('구조 권한')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const member: Actor = await joinAs(ws, await createUser('멤버'), 'member')
  const mine = unwrap(await createDatabase(member.ctx, { name: `내 표 ${Date.now()}` }))
  const theirs = unwrap(await createDatabase(boss.ctx, { name: `남의 표 ${Date.now()}` }))
  /** 남의 표를 멤버에게 그 레벨로만 연다(따로 관리 · 모두에게 주던 것을 거둔다). null 이면 아예 못 보게. */
  const restrict = async (level: 'view' | 'edit_content' | null) => {
    assert.ok((await stopInheriting(boss.ctx, theirs.id)).ok)
    assert.ok((await grantAccess(boss.ctx, theirs.id, { type: 'user', id: boss.userId }, 'full_access')).ok)
    assert.ok((await revokeAccess(boss.ctx, theirs.id, { type: 'workspace_everyone', id: null })).ok)
    if (level !== null) assert.ok((await grantAccess(boss.ctx, theirs.id, { type: 'user', id: member.userId }, level)).ok)
  }
  return { boss, member, mine, theirs, restrict }
}

describe('이 표의 구조를 고칠 수 있나 (10n-49)', () => {
  test('① 주인 · 만든 사람 — 고칠 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(await canEditSchema(w.boss.ctx, w.theirs.dataSourceId), true)
    assert.equal(await canEditSchema(w.member.ctx, w.mine.dataSourceId), true)
  })

  test('★ ② "내용 편집"만 받은 사람 — false · 실제로 양방향을 만들면 대상 쪽이 거부한다(판정과 명령이 같다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    await w.restrict('edit_content')
    assert.equal(await canEditSchema(w.member.ctx, w.theirs.dataSourceId), false)
    const made = await addRelationProperty(w.member.ctx, w.mine.dataSourceId, {
      name: '남의 행',
      targetDataSourceId: w.theirs.dataSourceId,
      twoWay: { name: '내 행' },
    })
    assert.equal(made.ok === false && made.reason, 'forbidden')
    // 단방향은 된다 — 대상 표를 고치지 않는다
    assert.equal((await addRelationProperty(w.member.ctx, w.mine.dataSourceId, { name: '남의 행', targetDataSourceId: w.theirs.dataSourceId })).ok, true)
  })

  test('★ ③ 잠긴 데이터베이스 — 주인도 false · 풀면 다시 true', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.ok((await setDatabaseLock(w.boss.ctx, w.theirs.id, true)).ok)
    assert.equal(await canEditSchema(w.boss.ctx, w.theirs.dataSourceId), false)
    assert.ok((await setDatabaseLock(w.boss.ctx, w.theirs.id, false)).ok)
    assert.equal(await canEditSchema(w.boss.ctx, w.theirs.dataSourceId), true)
  })

  test('④ 볼 수 없는 표 · 없는 표 · id 가 아닌 값 — false', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    await w.restrict(null)
    assert.equal(await canEditSchema(w.member.ctx, w.theirs.dataSourceId), false)
    assert.equal(await canEditSchema(w.member.ctx, '00000000-0000-4000-8000-000000000000'), false)
    assert.equal(await canEditSchema(w.member.ctx, 'not-a-uuid'), false)
  })
})
