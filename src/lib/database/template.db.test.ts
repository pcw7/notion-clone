/**
 * 데이터베이스 템플릿 — 템플릿 6c-1조각 (F-08-02 · F-08-03)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **불변식 R1 이 실제로 돈다.** 템플릿 행은 표 · 보드 · 연결 후보 어디에도 나타나지 않는다.
 *      정본이 *"모든 뷰/API 쿼리는 기본 조건으로 is_template=false 를 강제한다"* 고 적은 것을
 *      **읽는 경로마다** 확인한다 — 한 군데만 빠져도 템플릿이 표에 섞여 보인다
 *   ② 템플릿 목록은 그 조건의 반대쪽이고, 그 목록만이 템플릿을 본다
 *   ③ 권한: 목록은 `view`, 만들기 · 버리기는 쓰기 권한
 *
 *      ⚠ **이 파일은 `edit_structure` 와 `create_child` 를 가려내지 못한다.** `resolveCaps` 가 ACL 의 대상 종류를
 *        `'page'` 로 고정해서(HANDOFF §7) 데이터베이스 노드에 `create` · `edit_content` 레벨을 줄 수 없고, 줄 수
 *        있는 레벨(`view` · `comment` · `edit` · `full_access`)에서는 그 셋이 늘 함께 오거나 함께 없다. 반사실로
 *        확인했다 — `createRowIn` 의 게이트를 `create_child` 로 되돌려도 이 파일은 **전부 통과한다.** 지키는 것은
 *        "볼 수만 있는 사람은 못 만든다"까지이고, 그 위의 구분은 §7 의 부채가 풀릴 때 검사가 생긴다
 *   ④ **행 명령으로는 템플릿을 버릴 수 없다**(`trashRow`). 거부하면 아무것도 바뀌지 않는다
 *   ⑤ 기본 템플릿(F-08-03)은 **살아 있는 이 표의 템플릿**만 가리킨다 — 애플리케이션이 먼저 거부하고
 *      0026 의 트리거가 뒤에서 막는다. 휴지통에 보내면 읽기가 null 을 주고 **복원하면 돌아온다**
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { restorePage } from '../block/trash.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import type { MvpPropertyType } from './property-types.ts'
import { asBlockId } from '../ids.ts'
import { createDatabase } from './database.ts'
import { addProperty, deleteProperty, getSchema } from './property.ts'
import { addRelationProperty, linkRows, readRelation, searchCandidates } from './relation.ts'
import { createRow, listRows, trashRow, updateCells, type RowSummary } from './row.ts'
import { queryRows } from './query.ts'
import { getView, updateView } from './view.ts'
import {
  createRowFromTemplate,
  createTemplate,
  deleteTemplate,
  listTemplates,
  DEFAULT_TEMPLATE_NAME,
  MAX_TEMPLATES_PER_SOURCE,
} from './template.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

type Table = { databaseId: string; dataSourceId: string; viewId: string; titleId: string }

const newTable = async (): Promise<Table> => {
  const created = await createDatabase(fx.owner.ctx, { name: '표' })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('unreachable')
  const schema = await getSchema(fx.owner.ctx, created.value.dataSourceId)
  assert.equal(schema.ok, true)
  if (!schema.ok) throw new Error('unreachable')
  return {
    databaseId: created.value.id,
    dataSourceId: created.value.dataSourceId,
    viewId: created.value.defaultViewId as string,
    titleId: schema.value.properties.find((p) => p.type === 'title')!.id,
  }
}

const unwrapTemplate = (r: Awaited<ReturnType<typeof createTemplate>>): RowSummary => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 저장된 값을 그대로 읽는다 — 읽기 경로(`getView`)가 가리는 것과 구분해야 한다. */
const storedDefaultOf = async (viewId: string): Promise<string | null> =>
  (
    await withReadTransaction((tx) =>
      tx.queryOne<{ id: string | null }>(`SELECT default_template_page_id AS id FROM view WHERE id = $1`, [viewId]),
    )
  ).id

/** 표 하나를 열고 그 뷰가 주는 기본 템플릿(읽기 경로). */
const readDefaultOf = async (viewId: string): Promise<string | null> => {
  const got = await getView(fx.owner.ctx, viewId)
  assert.equal(got.ok, true)
  if (!got.ok) throw new Error('unreachable')
  return got.value.defaultTemplateId
}

// ── ① 불변식 R1 — 템플릿은 표에 보이지 않는다 ──────────────────────────

describe('불변식 R1 — 템플릿 행은 읽기 경로 어디에도 없다', () => {
  test('★ 행 목록 · 뷰 질의가 템플릿을 빼고, 템플릿 목록만 그것을 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()

    const row = await createRow(fx.owner.ctx, table.dataSourceId)
    assert.equal(row.ok, true)
    if (!row.ok) throw new Error('unreachable')
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '주간 회의' }))

    const listed = await listRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.deepEqual(listed.value.rows.map((r) => r.id), [row.value.id])

    // 뷰 질의(필터 · 정렬 · 커서를 지나는 길)도 같다 — 목록과 다른 함수다.
    const queried = await queryRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(queried.ok, true)
    if (queried.ok) {
      assert.deepEqual(queried.value.rows.map((r) => r.id), [row.value.id], '뷰 질의에 템플릿이 섞였다')
    }

    const templates = await listTemplates(fx.owner.ctx, table.dataSourceId)
    assert.equal(templates.ok, true)
    if (templates.ok) {
      assert.deepEqual(
        templates.value.map((t2) => ({ id: t2.id, title: t2.title })),
        [{ id: template.id, title: '주간 회의' }],
      )
    }
  })

  test('이름을 주지 않으면 부를 이름을 받는다 — 목록에서 고를 수 있어야 한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId))
    assert.equal(template.title, DEFAULT_TEMPLATE_NAME)
    assert.equal(template.title, '새 템플릿')
  })

  test('버린 템플릿은 목록에서 빠지고 복원하면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '버릴 것' }))

    assert.equal((await deleteTemplate(fx.owner.ctx, template.id)).ok, true)
    const afterDelete = await listTemplates(fx.owner.ctx, table.dataSourceId)
    assert.equal(afterDelete.ok, true)
    if (afterDelete.ok) assert.equal(afterDelete.value.length, 0)

    await restorePage(fx.owner.ctx, asBlockId(template.id))
    const afterRestore = await listTemplates(fx.owner.ctx, table.dataSourceId)
    assert.equal(afterRestore.ok, true)
    if (afterRestore.ok) assert.deepEqual(afterRestore.value.map((t2) => t2.id), [template.id])
  })

  test('★ 행 명령(`trashRow`)으로는 템플릿을 버릴 수 없다 — 거부하고 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '지켜야 한다' }))

    const refused = await trashRow(fx.owner.ctx, template.id)
    assert.equal(refused.ok, false)
    if (!refused.ok) assert.equal(refused.reason, 'not_found')

    // 반환값만 보지 않는다 — 상태를 다시 읽는다(§5).
    const lifecycle = await withReadTransaction((tx) =>
      tx.queryOne<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [template.id]),
    )
    assert.equal(lifecycle.lifecycle, 'live', 'trashRow 가 거부해 놓고 행을 버렸다')
    const still = await listTemplates(fx.owner.ctx, table.dataSourceId)
    assert.equal(still.ok, true)
    if (still.ok) assert.equal(still.value.length, 1)
  })

  test('상한을 넘으면 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    // 상한 검사만 재는 자리다 — 명령으로 100개를 만들면 느리기만 하다. 개수를 세는 질의가
    // 보는 것과 같은 모양의 행을 직접 넣는다.
    await withTransaction(async (tx) => {
      const container = await tx.queryOne<{ ancestor_path: string[]; perm_scope_id: string }>(
        `SELECT ancestor_path, perm_scope_id FROM block WHERE id = $1`,
        [table.databaseId],
      )
      for (let i = 0; i < MAX_TEMPLATES_PER_SOURCE; i += 1) {
        const id = randomUUID()
        await tx.query(
          `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                              ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
           VALUES ($1, $2, 'page', 'data_source', $3, $4, $5, $6, '{}'::jsonb, '{}'::jsonb, now(), now())`,
          [
            id,
            fx.workspaceId,
            table.dataSourceId,
            `t${String(i).padStart(4, '0')}`,
            [...container.ancestor_path, table.databaseId],
            container.perm_scope_id,
          ],
        )
        await tx.query(`INSERT INTO page (id, data_source_id, is_template) VALUES ($1, $2, true)`, [
          id,
          table.dataSourceId,
        ])
      }
    })

    const refused = await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '한 개 더' })
    assert.equal(refused.ok, false)
    if (!refused.ok) assert.equal(refused.reason, 'too_many')
  })
})

// ── ③ 권한 ────────────────────────────────────────────────────────────

describe('권한 — 목록은 view, 만들기 · 버리기는 edit_structure', () => {
  /** 이 표를 `other` 에게 주어진 레벨로만 열어 둔다. */
  const shareWith = async (table: Table, level: 'view' | 'comment' | 'edit') => {
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, table.databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: other.userId }, level)).ok,
      true,
    )
  }

  test('★ 볼 수만 있는 사람은 목록을 읽지만 만들지도 버리지도 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '기밀 작업' }))
    await shareWith(table, 'view')

    const listed = await listTemplates(other.ctx, table.dataSourceId)
    assert.equal(listed.ok, true, '목록은 view 로 읽는다 — 08 의 "목록 노출은 하되 생성 불가"')
    if (listed.ok) assert.deepEqual(listed.value.map((t2) => t2.id), [template.id])

    const created = await createTemplate(other.ctx, table.dataSourceId, { title: '끼어들기' })
    assert.equal(created.ok, false)
    if (!created.ok) assert.equal(created.reason, 'forbidden')

    const deleted = await deleteTemplate(other.ctx, template.id)
    assert.equal(deleted.ok, false)
    if (!deleted.ok) assert.equal(deleted.reason, 'forbidden')

    // 거부한 뒤 상태를 다시 읽는다.
    const after = await listTemplates(fx.owner.ctx, table.dataSourceId)
    assert.equal(after.ok, true)
    if (after.ok) assert.deepEqual(after.value.map((t2) => t2.id), [template.id])
  })

  test('표를 볼 수 없으면 존재를 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '기밀 작업' }))
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, table.databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )

    const listed = await listTemplates(other.ctx, table.dataSourceId)
    assert.equal(listed.ok, false)
    if (!listed.ok) assert.equal(listed.reason, 'not_found')

    const deleted = await deleteTemplate(other.ctx, template.id)
    assert.equal(deleted.ok, false)
    if (!deleted.ok) assert.equal(deleted.reason, 'not_found')
    assert.ok(
      !JSON.stringify(listed).includes('기밀 작업') && !JSON.stringify(deleted).includes('기밀 작업'),
      '거부 응답에 템플릿 제목이 실렸다',
    )
  })

  test('고칠 수 있는 사람은 만들고 버린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await shareWith(table, 'edit')

    const created = await createTemplate(other.ctx, table.dataSourceId, { title: '동료의 템플릿' })
    assert.equal(created.ok, true)
    if (!created.ok) throw new Error('unreachable')
    assert.equal((await deleteTemplate(other.ctx, created.value.id)).ok, true)
  })
})

// ── ⑤ 기본 템플릿 (F-08-03) ───────────────────────────────────────────

describe('기본 템플릿 — 살아 있는 이 표의 템플릿만 가리킨다', () => {
  test('★ 지정하면 뷰가 돌려주고, 버리면 null 이 되며, 복원하면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '기본' }))

    const set = await updateView(fx.owner.ctx, table.viewId, { defaultTemplateId: template.id })
    assert.equal(set.ok, true)
    if (set.ok) assert.equal(set.value.defaultTemplateId, template.id)
    assert.equal(await readDefaultOf(table.viewId), template.id)

    assert.equal((await deleteTemplate(fx.owner.ctx, template.id)).ok, true)
    assert.equal(await readDefaultOf(table.viewId), null, '버린 템플릿을 기본으로 내주고 있다')
    // ★ 저장된 값은 **그대로 둔다**(`group_by` 와 같은 규칙) — 그래서 복원이 지정을 되살린다.
    assert.equal(await storedDefaultOf(table.viewId), template.id)

    await restorePage(fx.owner.ctx, asBlockId(template.id))
    assert.equal(await readDefaultOf(table.viewId), template.id, '복원했는데 기본 지정이 돌아오지 않았다')
  })

  test('null 을 주면 빈 페이지로 돌아간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '기본' }))
    assert.equal((await updateView(fx.owner.ctx, table.viewId, { defaultTemplateId: template.id })).ok, true)

    const cleared = await updateView(fx.owner.ctx, table.viewId, { defaultTemplateId: null })
    assert.equal(cleared.ok, true)
    if (cleared.ok) assert.equal(cleared.value.defaultTemplateId, null)
    assert.equal(await storedDefaultOf(table.viewId), null)
  })

  test('보내지 않으면 그대로 둔다 — 다른 설정을 고쳐도 지정이 풀리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '기본' }))
    assert.equal((await updateView(fx.owner.ctx, table.viewId, { defaultTemplateId: template.id })).ok, true)

    const renamed = await updateView(fx.owner.ctx, table.viewId, { name: '다른 이름' })
    assert.equal(renamed.ok, true)
    if (renamed.ok) assert.equal(renamed.value.defaultTemplateId, template.id)
  })

  test('★ 일반 행 · 다른 표의 템플릿 · 없는 id 는 전부 거부하고 지정을 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const otherTable = await newTable()
    const mine = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '내 것' }))
    const theirs = unwrapTemplate(await createTemplate(fx.owner.ctx, otherTable.dataSourceId, { title: '남의 것' }))
    const plain = await createRow(fx.owner.ctx, table.dataSourceId)
    assert.equal(plain.ok, true)
    if (!plain.ok) throw new Error('unreachable')

    assert.equal((await updateView(fx.owner.ctx, table.viewId, { defaultTemplateId: mine.id })).ok, true)

    for (const [what, id] of [
      ['일반 행', plain.value.id],
      ['다른 표의 템플릿', theirs.id],
      ['없는 id', randomUUID()],
      ['uuid 가 아닌 것', 'not-a-uuid'],
    ] as const) {
      const refused = await updateView(fx.owner.ctx, table.viewId, { defaultTemplateId: id })
      assert.equal(refused.ok, false, `${what} 을 기본 템플릿으로 받았다`)
      if (!refused.ok) assert.equal(refused.reason, 'invalid_template', what)
      // 거부한 뒤 상태를 다시 읽는다 — "쓴 뒤에 거부"가 아닌지 본다(§5).
      assert.equal(await storedDefaultOf(table.viewId), mine.id, `${what} 이 거부됐는데 지정이 바뀌었다`)
    }
  })

  test('★ 0026 의 트리거가 애플리케이션 뒤에서 같은 것을 막는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const plain = await createRow(fx.owner.ctx, table.dataSourceId)
    assert.equal(plain.ok, true)
    if (!plain.ok) throw new Error('unreachable')

    // 애플리케이션을 건너뛰고 직접 쓴다 — 임포트 · 복제 같은 새 경로가 생겨도 DB 가 막는지 본다.
    await assert.rejects(
      () =>
        withTransaction((tx) =>
          tx.query(`UPDATE view SET default_template_page_id = $2 WHERE id = $1`, [table.viewId, plain.value.id]),
        ),
      (e: { code?: string }) => e.code === '23514',
      '일반 행을 가리키는 쓰기를 DB 가 받았다',
    )
  })

  test('★ 템플릿을 영구 삭제하면 지정이 풀린다 (0026 의 FK)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '사라질 것' }))
    assert.equal((await updateView(fx.owner.ctx, table.viewId, { defaultTemplateId: template.id })).ok, true)

    await withTransaction((tx) => tx.query(`DELETE FROM block WHERE id = $1`, [template.id]))
    assert.equal(await storedDefaultOf(table.viewId), null, '영구 삭제됐는데 지정이 남았다')
  })
})

// ── ⑥ 템플릿으로 행 만들기 (F-08-02) ──────────────────────────────────

const para = (...runs: ReturnType<typeof textRun>[]): EditorBlock => ({
  id: randomUUID(),
  type: 'paragraph',
  title: runs,
})
/** 하위 페이지 참조 블록 — 본문에서 그 페이지가 서는 자리(`page-refs.ts`). */
const ref = (pageId: string): EditorBlock => ({ id: pageId, type: 'page', title: [] })

const unwrapMade = (r: Awaited<ReturnType<typeof createRowFromTemplate>>) => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const titleCellOf = (propertyId: string, text: string) => ({
  propertyId,
  value: { type: 'title' as const, title: [textRun(text)] },
})

/**
 * 프로퍼티를 더하고 **그 id** 를 준다.
 *
 * `addProperty` 는 스키마 스냅샷을 돌려준다 — 이름으로 찾아야 한다. ⚠ tsconfig 가 `*.test.ts` 를 타입 검사에서
 * 빼므로(HANDOFF §6) `added.value.propertyId` 같은 오타는 **돌려 봐야** 드러난다. 실제로 그렇게 한 번 걸렸다.
 */
const addProp = async (dataSourceId: string, name: string, type: MvpPropertyType): Promise<string> => {
  const added = await addProperty(fx.owner.ctx, dataSourceId, { name, type })
  assert.equal(added.ok, true, `프로퍼티 ${name} 추가 실패`)
  if (!added.ok) throw new Error('unreachable')
  const found = added.value.properties.find((p) => p.name === name)
  assert.ok(found !== undefined, `프로퍼티 ${name} 이 스키마에 없다`)
  return found.id
}

const liveRowCount = async (dataSourceId: string): Promise<number> =>
  Number(
    (
      await withReadTransaction((tx) =>
        tx.queryOne<{ n: string }>(
          `SELECT count(*) AS n FROM page p JOIN block b ON b.id = p.id
            WHERE p.data_source_id = $1 AND b.lifecycle = 'live'`,
          [dataSourceId],
        ),
      )
    ).n,
  )

describe('템플릿으로 행 만들기 — 셀 · 본문이 따라온다', () => {
  test('★ 셀과 제목이 그대로 실리고 꼬리표는 붙지 않는다 — 사본이 아니라 새 항목이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const propertyId = await addProp(table.dataSourceId, '중요도', 'number')

    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '주간 회의' }))
    assert.equal(
      (await updateCells(fx.owner.ctx, template.id, { cells: [{ propertyId, value: { type: 'number', number: 3 } }] })).ok,
      true,
    )

    const made = unwrapMade(await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, template.id))
    assert.notEqual(made.row.id, template.id)
    assert.equal(made.row.title, '주간 회의', '꼬리표가 붙었거나 제목이 비었다')
    assert.deepEqual(made.row.properties[propertyId], { type: 'number', number: 3 })
    assert.equal(made.skippedPages, 0)
    assert.equal(made.skippedLinks, 0)

    // 새 행은 **템플릿이 아니다** — 표에 보이고 템플릿 목록에는 없다.
    const listed = await listRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.deepEqual(listed.value.rows.map((r) => r.id), [made.row.id])
    const templates = await listTemplates(fx.owner.ctx, table.dataSourceId)
    assert.equal(templates.ok, true)
    if (templates.ok) assert.deepEqual(templates.value.map((t2) => t2.id), [template.id])
  })

  test('★ 호출자가 준 셀이 템플릿의 값을 덮는다 — 보드 열의 값이 이긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const propertyId = await addProp(table.dataSourceId, '중요도', 'number')

    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '주간 회의' }))
    assert.equal(
      (await updateCells(fx.owner.ctx, template.id, { cells: [{ propertyId, value: { type: 'number', number: 3 } }] })).ok,
      true,
    )

    const made = unwrapMade(
      await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, template.id, {
        cells: [
          { propertyId, value: { type: 'number', number: 99 } },
          titleCellOf(table.titleId, '9월 3주'),
        ],
      }),
    )
    assert.deepEqual(made.row.properties[propertyId], { type: 'number', number: 99 })
    assert.equal(made.row.title, '9월 3주')
  })

  test('★ 지워진 · 읽기 전용이 된 프로퍼티의 값은 무시한다 — 그 템플릿으로도 행이 만들어진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const gone = await addProp(table.dataSourceId, '없어질 것', 'number')
    const frozen = await addProp(table.dataSourceId, '잠길 것', 'number')
    const kept = await addProp(table.dataSourceId, '남을 것', 'number')

    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '낡은 템플릿' }))
    assert.equal(
      (
        await updateCells(fx.owner.ctx, template.id, {
          cells: [
            { propertyId: gone, value: { type: 'number', number: 1 } },
            { propertyId: frozen, value: { type: 'number', number: 2 } },
            { propertyId: kept, value: { type: 'number', number: 3 } },
          ],
        })
      ).ok,
      true,
    )
    assert.equal((await deleteProperty(fx.owner.ctx, table.dataSourceId, gone)).ok, true)
    await withTransaction((tx) => tx.query(`UPDATE property SET writable = 'readonly' WHERE id = $1`, [frozen]))

    const made = unwrapMade(await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, template.id))
    assert.deepEqual(made.row.properties[kept], { type: 'number', number: 3 })
    assert.equal(made.row.properties[frozen], undefined, '읽기 전용 프로퍼티에 값이 실렸다')
  })

  test('★ 본문과 하위 페이지가 따라온다 — 하위 페이지는 새 id 이고 사본 본문이 그것을 가리킨다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '회의록' }))
    const child = await createPage(fx.owner.ctx, {
      title: titleFromPlainText('지난 안건'),
      parentPageId: asBlockId(template.id),
    })
    assert.equal(
      (
        await savePageBody(fx.owner.ctx, asBlockId(template.id), {
          blocks: [para(textRun('안건 정리')), ref(child.id)],
        })
      ).ok,
      true,
    )

    const made = unwrapMade(await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, template.id))
    const body = await loadPageBody(fx.owner.ctx, asBlockId(made.row.id))
    assert.ok(body !== null, '사본의 본문을 읽지 못했다')
    assert.equal(toPlainText(body.doc.blocks[0].title), '안건 정리')
    const copiedRef = body.doc.blocks.find((b) => b.type === 'page')
    assert.ok(copiedRef !== undefined, '사본 본문에 하위 페이지 참조가 없다')
    assert.notEqual(copiedRef.id, child.id, '하위 페이지가 원본을 가리킨다 — 새 id 를 받아야 한다')
    assert.equal(made.skippedPages, 0)

    // 원본 템플릿은 그대로다.
    const original = await loadPageBody(fx.owner.ctx, asBlockId(template.id))
    assert.equal(original?.doc.blocks.find((b) => b.type === 'page')?.id, child.id)
  })
})

describe('템플릿으로 행 만들기 — relation 은 대상을 그대로 물려준다', () => {
  test('★ 양방향이면 거울상이 상대 행에 생긴다 — 대상은 재매핑하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tasks = await newTable()
    const projects = await newTable()
    const made = await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
      name: '프로젝트',
      targetDataSourceId: projects.dataSourceId,
      twoWay: { name: '작업들' },
    })
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')
    const forward = made.value.propertyId
    const back = made.value.syncedPropertyId as string

    const project = await createRow(fx.owner.ctx, projects.dataSourceId, {
      cells: [titleCellOf(projects.titleId, '가을 개편')],
    })
    assert.equal(project.ok, true)
    if (!project.ok) throw new Error('unreachable')

    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, tasks.dataSourceId, { title: '개편 작업' }))
    assert.equal((await linkRows(fx.owner.ctx, template.id, forward, { add: [project.value.id] })).ok, true)

    const row = unwrapMade(await createRowFromTemplate(fx.owner.ctx, tasks.dataSourceId, template.id))
    assert.equal(row.skippedLinks, 0)

    const linked = await readRelation(fx.owner.ctx, row.row.id, forward)
    assert.equal(linked.ok, true)
    if (linked.ok) assert.deepEqual(linked.value.items.map((r) => r.title), ['가을 개편'])

    // 거울상 — 상대 행의 칸에 템플릿과 새 행 **둘 다** 서 있다(엣지는 둘, 템플릿은 R1 이 가린다).
    const mirrored = await readRelation(fx.owner.ctx, project.value.id, back)
    assert.equal(mirrored.ok, true)
    if (mirrored.ok) assert.deepEqual(mirrored.value.items.map((r) => r.id), [row.row.id])
  })

  test('★ 볼 수 없는 대상은 잇지 않고 개수로 말한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tasks = await newTable()
    const secret = await newTable()
    const made = await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
      name: '비밀 프로젝트',
      targetDataSourceId: secret.dataSourceId,
    })
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')

    const hidden = await createRow(fx.owner.ctx, secret.dataSourceId, {
      cells: [titleCellOf(secret.titleId, '기밀 작업')],
    })
    assert.equal(hidden.ok, true)
    if (!hidden.ok) throw new Error('unreachable')

    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, tasks.dataSourceId, { title: '비밀 템플릿' }))
    assert.equal((await linkRows(fx.owner.ctx, template.id, made.value.propertyId, { add: [hidden.value.id] })).ok, true)

    // 대상 표를 `other` 에게서 닫는다. 템플릿이 있는 표는 그대로 열려 있다.
    assert.equal(
      (await grantAccess(fx.owner.ctx, secret.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal((await revokeAccess(fx.owner.ctx, secret.databaseId, { type: 'workspace_everyone', id: null })).ok, true)

    const row = unwrapMade(await createRowFromTemplate(other.ctx, tasks.dataSourceId, template.id))
    assert.equal(row.skippedLinks, 1, '볼 수 없는 대상을 이었거나 세지 않았다')

    const edges = await withReadTransaction((tx) =>
      tx.query<{ to_page_id: string }>(`SELECT to_page_id FROM relation_edge WHERE from_page_id = $1`, [row.row.id]),
    )
    assert.deepEqual(edges, [], '볼 수 없는 대상에 엣지가 생겼다')
    assert.ok(!JSON.stringify(row).includes('기밀 작업'), '응답에 볼 수 없는 행의 제목이 실렸다')
  })
})

describe('템플릿으로 행 만들기 — 거부하면 아무것도 남지 않는다', () => {
  test('★ 일반 행 · 다른 표의 템플릿 · 휴지통의 템플릿 · 없는 id 는 전부 not_found 다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const otherTable = await newTable()
    const plain = await createRow(fx.owner.ctx, table.dataSourceId)
    assert.equal(plain.ok, true)
    if (!plain.ok) throw new Error('unreachable')
    const theirs = unwrapTemplate(await createTemplate(fx.owner.ctx, otherTable.dataSourceId, { title: '남의 것' }))
    const trashed = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '버린 것' }))
    assert.equal((await deleteTemplate(fx.owner.ctx, trashed.id)).ok, true)

    const before = await liveRowCount(table.dataSourceId)
    for (const [what, id] of [
      ['일반 행', plain.value.id],
      ['다른 표의 템플릿', theirs.id],
      ['휴지통의 템플릿', trashed.id],
      ['없는 id', randomUUID()],
      ['uuid 가 아닌 것', 'not-a-uuid'],
    ] as const) {
      const refused = await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, id)
      assert.equal(refused.ok, false, `${what} 로 행이 만들어졌다`)
      if (!refused.ok) assert.equal(refused.reason, 'not_found', what)
    }
    assert.equal(await liveRowCount(table.dataSourceId), before, '거부했는데 행이 생겼다')
  })

  test('★ 볼 수만 있는 사람은 템플릿으로도 행을 만들지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '템플릿' }))
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal((await revokeAccess(fx.owner.ctx, table.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: other.userId }, 'view')).ok,
      true,
    )

    const before = await liveRowCount(table.dataSourceId)
    const refused = await createRowFromTemplate(other.ctx, table.dataSourceId, template.id)
    assert.equal(refused.ok, false)
    if (!refused.ok) assert.equal(refused.reason, 'forbidden')
    assert.equal(await liveRowCount(table.dataSourceId), before, '거부했는데 행이 생겼다')
  })
})

describe('템플릿의 연결 칸 — 열린 쪽과 열지 않은 쪽', () => {
  test('★ 템플릿의 연결 칸은 읽고 고칠 수 있다 — R1 은 목록의 규칙이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tasks = await newTable()
    const projects = await newTable()
    const made = await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
      name: '프로젝트',
      targetDataSourceId: projects.dataSourceId,
    })
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')

    const project = await createRow(fx.owner.ctx, projects.dataSourceId, {
      cells: [titleCellOf(projects.titleId, '가을 개편')],
    })
    assert.equal(project.ok, true)
    if (!project.ok) throw new Error('unreachable')

    const template = unwrapTemplate(await createTemplate(fx.owner.ctx, tasks.dataSourceId, { title: '개편 작업' }))
    const linked = await linkRows(fx.owner.ctx, template.id, made.value.propertyId, { add: [project.value.id] })
    assert.equal(linked.ok, true, '템플릿의 연결 칸을 고치지 못했다 — F-08-02 가 요구하는 기능이다')

    const read = await readRelation(fx.owner.ctx, template.id, made.value.propertyId)
    assert.equal(read.ok, true)
    if (read.ok) assert.deepEqual(read.value.items.map((r) => r.title), ['가을 개편'])
  })

  test('★ 템플릿은 연결의 **대상**이 될 수 없다 — 후보에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tasks = await newTable()
    const projects = await newTable()
    const made = await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
      name: '프로젝트',
      targetDataSourceId: projects.dataSourceId,
    })
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')

    // 대상 표의 템플릿. 이름은 우연히 나올 수 없는 것으로 둔다(§6 — 누출 검사의 값).
    const targetTemplate = unwrapTemplate(
      await createTemplate(fx.owner.ctx, projects.dataSourceId, { title: '프로젝트 템플릿 987654' }),
    )
    const task = await createRow(fx.owner.ctx, tasks.dataSourceId)
    assert.equal(task.ok, true)
    if (!task.ok) throw new Error('unreachable')

    const refused = await linkRows(fx.owner.ctx, task.value.id, made.value.propertyId, { add: [targetTemplate.id] })
    assert.equal(refused.ok, false, '템플릿을 연결 대상으로 받았다 — 표에 없는 행을 가리키는 칸이 된다')
    if (!refused.ok) assert.equal(refused.reason, 'invalid_value')

    const edges = await withReadTransaction((tx) =>
      tx.query<{ to_page_id: string }>(`SELECT to_page_id FROM relation_edge WHERE from_page_id = $1`, [task.value.id]),
    )
    assert.deepEqual(edges, [], '거부했는데 엣지가 생겼다')

    const candidates = await searchCandidates(fx.owner.ctx, task.value.id, made.value.propertyId, '')
    assert.equal(candidates.ok, true)
    if (candidates.ok) {
      assert.ok(
        !candidates.value.items.some((c) => c.id === targetTemplate.id),
        '후보 목록에 템플릿이 나왔다',
      )
      assert.ok(!JSON.stringify(candidates).includes('987654'), '후보 응답에 템플릿의 이름이 실렸다')
    }
  })
})
