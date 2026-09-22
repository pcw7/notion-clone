/**
 * 사이드바 트리 조회 — F-02-03 / F-07-16
 *
 * 조립 규칙은 `page-tree.test.ts`(DB 없음)가 본다. 여기서는 **DB 에서 오는
 * 것들**만 확인한다: 워크스페이스 격리, 휴지통 제외, 본문을 싣지 않는다는 것,
 * 그리고 실제로 토글 안에 넣은 하위 페이지가 트리에 남는가.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import {
  probeDatabase,
  createUser,
  createBareWorkspace,
  joinAs,
} from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { listPageTree, type PageTreeNode } from './page-tree.ts'
import { savePageBody } from './save-page-body.ts'
import { trashPage } from './trash.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { BlockId } from '../ids.ts'
import { createDatabase } from '../database/database.ts'
import { getSchema } from '../database/property.ts'
import { createRow } from '../database/row.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
  // 공용 픽스처를 쓰지 않는다 — 트리 조회는 워크스페이스 **전체**를 보므로
  // 다른 테스트가 만든 페이지가 섞이면 기대값이 흔들린다.
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 워크스페이스를 매번 새로 만든다 — 트리 조회는 워크스페이스 전체를 본다. */
async function freshWorkspace() {
  const ws = await createBareWorkspace('트리')
  const actor = await joinAs(ws, await createUser(), 'owner')
  const mk = (title: string, parent: BlockId | null = null) =>
    createPage(actor.ctx, { parentPageId: parent, title: titleFromPlainText(title) })
  return { ws, actor, mk }
}

const shape = (nodes: readonly PageTreeNode[]): unknown[] =>
  nodes.map((n) => [n.title, shape(n.children)])

describe('listPageTree', () => {
  test('중첩된 페이지 계층을 돌려준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { actor, mk } = await freshWorkspace()

    const a = await mk('A')
    await mk('A-1', a.id)
    await mk('B')

    assert.deepEqual(shape(await listPageTree(actor.ctx)), [
      ['A', [['A-1', []]]],
      ['B', []],
    ])
  })

  test('휴지통 페이지는 나오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { actor, mk } = await freshWorkspace()

    const keep = await mk('남는다')
    const gone = await mk('사라진다')
    await trashPage(actor.ctx, gone.id)

    const tree = await listPageTree(actor.ctx)
    assert.deepEqual(shape(tree), [['남는다', []]])
    assert.equal(tree[0].id, keep.id)
  })

  test('부모가 휴지통이면 자손도 트리에서 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { actor, mk } = await freshWorkspace()

    const root = await mk('루트')
    await mk('자식', root.id)
    await trashPage(actor.ctx, root.id)

    assert.deepEqual(await listPageTree(actor.ctx), [])
  })

  test('다른 워크스페이스의 페이지는 섞이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mine = await freshWorkspace()
    const other = await freshWorkspace()

    await mine.mk('내 페이지')
    await other.mk('남의 페이지')

    assert.deepEqual(shape(await listPageTree(mine.actor.ctx)), [['내 페이지', []]])
    assert.deepEqual(shape(await listPageTree(other.actor.ctx)), [['남의 페이지', []]])
  })

  test('본문을 싣지 않는다 — 노드에 title 말고는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { actor, mk } = await freshWorkspace()

    const page = await mk('본문 있는 페이지')
    assert.ok(
      (await savePageBody(actor.ctx, page.id, {
        blocks: [{ id: randomUUID(), type: 'paragraph', title: [textRun('본문 텍스트')] }],
      })).ok,
    )

    const tree = await listPageTree(actor.ctx)
    // F-02-03: "사이드바가 페이지 본문을 끌고 오면 즉시 성능이 무너진다."
    // teamspaceId(7c-2)는 섹션을 가르는 id 하나다 — 레이아웃이 쓰고 화면에는 넘기지 않는다(layout.tsx `toSidebarNode`).
    assert.deepEqual(Object.keys(tree[0]).sort(), ['children', 'hasChildren', 'id', 'kind', 'parentId', 'teamspaceId', 'title'])
    assert.equal(JSON.stringify(tree).includes('본문 텍스트'), false, '본문이 실려 나왔다')
  })
})

describe('listPageTree — 본문 안에 중첩된 하위 페이지 (PR #23)', () => {
  test('토글 안에 넣어도 사이드바에서는 그 페이지의 자식으로 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { actor, mk } = await freshWorkspace()

    const parent = await mk('부모')
    const child = await mk('자식', parent.id)

    // 자식 페이지를 부모 본문의 토글 안으로 옮긴다.
    const toggleId = randomUUID()
    assert.ok(
      (await savePageBody(actor.ctx, parent.id, {
        blocks: [
          {
            id: toggleId,
            type: 'toggle',
            title: [textRun('토글')],
            children: [{ id: child.id, type: 'page', title: [] }],
          },
        ],
      })).ok,
    )

    // 이제 자식의 parent_id 는 토글이다. 그걸로 트리를 엮으면 사라진다.
    const tree = await listPageTree(actor.ctx)
    assert.deepEqual(shape(tree), [['부모', [['자식', []]]]], '자식이 사이드바에서 사라졌다')
    assert.equal(tree[0].children[0].parentId, parent.id)
    assert.equal(tree[0].hasChildren, true)
  })
})

describe('listPageTree — 데이터베이스 행 (W8)', () => {
  test('★ DB 행은 사이드바 최상위로 새지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { actor, mk } = await freshWorkspace()
    await mk('페이지')

    // DB 행도 `type='page'` 블록이다(C-3). 트리가 타입만 보고 모으면 행이 섞이고,
    // 행의 조상 경로에 있는 컨테이너(`type='database'`)는 페이지 집합에 없으므로
    // **최상위 노드**가 된다 — 행 50개짜리 표 하나가 사이드바를 50줄 늘린다.
    const db = await createDatabase(actor.ctx, { name: '할 일' })
    if (!db.ok) throw new Error(`표 생성 실패: ${db.reason}`)
    const schema = await getSchema(actor.ctx, db.value.dataSourceId)
    if (!schema.ok) throw new Error('스키마를 읽지 못했다')
    const titleId = schema.value.properties[0].id
    for (const title of ['행 1', '행 2']) {
      const row = await createRow(actor.ctx, db.value.dataSourceId, {
        cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }],
      })
      assert.ok(row.ok)
    }

    // 표 자신은 트리에 선다 — 풀페이지 DB 는 사이드바의 한 줄이다(F-04-14).
    const tree = await listPageTree(actor.ctx)
    assert.deepEqual(shape(tree), [
      ['페이지', []],
      ['할 일', []],
    ])
    assert.deepEqual(
      tree.map((n) => n.kind),
      ['page', 'database'],
    )
  })
})
