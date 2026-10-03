/**
 * 이미지 아이콘 — 파일 참조 · 받기 · 읽는 길 — 잔여 묶음 8c-4 (F-02-05 · DB)
 *
 * 올린 파일을 아이콘으로 쓰면 그 아이콘은 이미지 블록처럼 **그 파일의 참조**다(`file.ref_count` — 불변식 FS1). 아이콘을 쓰는 명령 ·
 * 복제가 같은 트랜잭션에서 센다(`icon-reference.ts`).
 *
 *   ① ★ 페이지 — 올린 파일 아이콘은 참조를 하나 올리고, 다른 파일 · 이모지 · 외부 주소로 바꾸거나 지우면 옛 파일의 참조를 내린다 ·
 *      같은 파일이면 그대로
 *   ② ★ 받지 않는 것 — 없는 파일 · 다른 워크스페이스의 파일 · 이미지가 아닌 파일 · 안전하지 않은 주소. 아무것도 바뀌지 않는다
 *   ③ ★ 데이터베이스 아이콘도 같다
 *   ④ ★ 복제 · 템플릿으로 만든 행은 같은 파일을 가리키는 참조가 하나 더 생긴다
 *   ⑤ 읽는 길 — 사이드바 트리 · 멘션의 이름 맵이 이미지 아이콘을 그대로 싣는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, setPageIcon, PageError } from '../block/page.ts'
import { duplicatePage } from '../block/duplicate.ts'
import { listPageTree, type PageTreeNode } from '../block/page-tree.ts'
import { loadMentionLabels } from '../block/mention-candidates.ts'
import { pageIconOfFormat, type PageIcon } from '../block/page-icon.ts'
import { createDatabase, getDatabase, setDatabaseIcon } from '../database/database.ts'
import { createRowFromTemplate, createTemplate } from '../database/template.ts'
import { readRow } from '../database/row.ts'
import { withReadTransaction } from '../db/tx.ts'
import { titleFromPlainText } from '../block/page.ts'
import type { BlockId } from '../ids.ts'
import { setFileStorage, type FileStorage } from './storage.ts'
import { uploadFile } from './file.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Fixture

/** 디스크를 건드리지 않는 드라이버(`file.db.test.ts` 와 같다). */
function memoryStorage(): FileStorage {
  const store = new Map<string, Uint8Array>()
  return {
    kind: 'memory',
    async put(key, bytes) {
      store.set(key, bytes)
    },
    async read(key) {
      return store.get(key) ?? null
    },
    async remove(key) {
      store.delete(key)
    },
  }
}

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  setFileStorage(memoryStorage())
  fx = await makeFixture()
  other = await makeFixture()
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}
const fileIcon = (fileId: string): PageIcon => ({ type: 'file', file_id: fileId })
const external = (url: string): PageIcon => ({ type: 'external', url })

async function upload(f: Fixture = fx): Promise<string> {
  const out = await uploadFile(f.owner.ctx, { bytes: new Uint8Array(16).fill(137), mime: 'image/png', originalName: 'icon.png' })
  assert.equal(out.ok, true)
  if (!out.ok) throw new Error('unreachable')
  return out.file.id
}

async function refCount(fileId: string): Promise<number> {
  const [row] = await query<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [fileId])
  return row.ref_count
}

async function storedPageIcon(pageId: string): Promise<PageIcon | null> {
  const [row] = await query<{ format: unknown }>(`SELECT format FROM block WHERE id = $1`, [pageId])
  return pageIconOfFormat(row.format)
}

function findNode(nodes: readonly PageTreeNode[], id: string): PageTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return undefined
}

describe('① 페이지', () => {
  test('★ 올린 파일 아이콘은 참조를 올리고, 바꾸거나 지우면 옛 파일의 참조를 내린다 · 같은 파일이면 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('이미지 아이콘') })).id
    const a = await upload()
    const b = await upload()
    assert.deepEqual([await refCount(a), await refCount(b)], [0, 0], '전제: 올리기만 한 파일은 참조가 없다')

    assert.deepEqual(await setPageIcon(fx.owner.ctx, page, fileIcon(a)), fileIcon(a))
    assert.deepEqual(await storedPageIcon(page), fileIcon(a))
    assert.deepEqual([await refCount(a), await refCount(b)], [1, 0])

    // 같은 파일 — 대문자 · 앞뒤 공백도 같은 id 다(받기가 소문자로). 쓰지 않으니 참조도 그대로.
    await setPageIcon(fx.owner.ctx, page, { type: 'file', file_id: ` ${a.toUpperCase()} ` } as unknown as PageIcon)
    assert.deepEqual([await refCount(a), await refCount(b)], [1, 0])

    await setPageIcon(fx.owner.ctx, page, fileIcon(b))
    assert.deepEqual([await refCount(a), await refCount(b)], [0, 1], '다른 파일로 — 옛 파일은 내리고 새 파일은 올린다')

    await setPageIcon(fx.owner.ctx, page, external('https://example.com/icon.png'))
    assert.deepEqual(await storedPageIcon(page), external('https://example.com/icon.png'))
    assert.deepEqual([await refCount(a), await refCount(b)], [0, 0], '외부 주소로 — 옛 파일을 내린다')

    await setPageIcon(fx.owner.ctx, page, fileIcon(a))
    await setPageIcon(fx.owner.ctx, page, { type: 'emoji', emoji: '🌱' })
    assert.equal(await refCount(a), 0, '이모지로 — 옛 파일을 내린다')

    await setPageIcon(fx.owner.ctx, page, fileIcon(a))
    await setPageIcon(fx.owner.ctx, page, null)
    assert.equal(await refCount(a), 0, '지우면 — 옛 파일을 내린다')
    assert.equal(await storedPageIcon(page), null)
  })
})

describe('② 받지 않는 것', () => {
  test('★ 없는 파일 · 다른 워크스페이스의 파일 · 이미지가 아닌 파일 · 안전하지 않은 주소 — 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('거부') })).id
    const mine = await upload()
    await setPageIcon(fx.owner.ctx, page, fileIcon(mine))
    const theirs = await upload(other)
    // 이미지가 아닌 파일 — 지금의 업로드는 이미지만 받으므로 행을 직접 넣는다(파일 표는 형식을 가리지 않는다).
    const pdf = randomUUID()
    await query(
      `INSERT INTO file (id, workspace_id, region_id, storage_key, mime, size_bytes, ref_count, created_at)
       SELECT $1, $2, region_id, $3, 'application/pdf', 10, 0, now() FROM workspace WHERE id = $2`,
      [pdf, fx.workspaceId, `test/${pdf}.pdf`],
    )

    const refuse = async (icon: unknown, label: string) => {
      await assert.rejects(
        () => setPageIcon(fx.owner.ctx, page, icon as PageIcon),
        (e: unknown) => e instanceof PageError && e.code === 'invalid_icon',
        label,
      )
    }
    await refuse(fileIcon(randomUUID()), '없는 파일')
    await refuse(fileIcon(theirs), '다른 워크스페이스의 파일')
    await refuse(fileIcon(pdf), '이미지가 아닌 파일')
    await refuse({ type: 'file', file_id: 'not-a-uuid' }, 'uuid 가 아닌 id')
    await refuse(external('javascript:alert(1)'), 'javascript: 주소')
    await refuse(external('/api/workspaces/x/files/y/content'), '상대 주소')
    await refuse(external(`https://example.com/${'a'.repeat(2048)}`), '너무 긴 주소')
    await refuse(external('https://example.com/a b.png'), '공백이 든 주소')

    assert.deepEqual(await storedPageIcon(page), fileIcon(mine))
    assert.deepEqual([await refCount(mine), await refCount(theirs), await refCount(pdf)], [1, 0, 0])
  })
})

describe('③ 데이터베이스', () => {
  test('★ 데이터베이스 아이콘도 참조를 세고 같은 것을 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '이미지 아이콘 표' }))
    const a = await upload()
    const b = await upload()
    const theirs = await upload(other)

    assert.deepEqual(unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, fileIcon(a))), fileIcon(a))
    assert.deepEqual(unwrap(await getDatabase(fx.owner.ctx, db.id)).icon, fileIcon(a))
    assert.equal(await refCount(a), 1)
    unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, fileIcon(b)))
    assert.deepEqual([await refCount(a), await refCount(b)], [0, 1])

    assert.deepEqual(await setDatabaseIcon(fx.owner.ctx, db.id, fileIcon(theirs)), { ok: false, reason: 'invalid_icon' })
    assert.deepEqual(await setDatabaseIcon(fx.owner.ctx, db.id, external('javascript:alert(1)')), { ok: false, reason: 'invalid_icon' })
    assert.deepEqual([await refCount(b), await refCount(theirs)], [1, 0])

    unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, external('https://example.com/db.png')))
    assert.equal(await refCount(b), 0)
    assert.deepEqual(unwrap(await getDatabase(fx.owner.ctx, db.id)).icon, external('https://example.com/db.png'))
  })
})

describe('④ 복제 · 템플릿', () => {
  test('★ 복제한 페이지 · 템플릿으로 만든 행은 같은 파일을 가리키고 참조가 하나 더 생긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('복제할 아이콘') })).id
    const a = await upload()
    await setPageIcon(fx.owner.ctx, page, fileIcon(a))
    const copy = await duplicatePage(fx.owner.ctx, page)
    assert.deepEqual(await storedPageIcon(copy.page.id), fileIcon(a), '사본은 같은 파일을 가리킨다(다시 올리지 않는다)')
    assert.equal(await refCount(a), 2)

    const table = unwrap(await createDatabase(fx.owner.ctx, { name: '템플릿 아이콘 표' }))
    const template = unwrap(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '이미지 틀' }))
    const b = await upload()
    await setPageIcon(fx.owner.ctx, template.id as BlockId, fileIcon(b))
    const made = unwrap(await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, template.id))
    assert.deepEqual((await withReadTransaction((tx) => readRow(tx, made.row.id)))?.icon, fileIcon(b))
    assert.equal(await refCount(b), 2, '템플릿 · 그것으로 만든 행')
  })
})

describe('⑤ 읽는 길', () => {
  test('사이드바 트리 · 멘션의 이름 맵이 이미지 아이콘을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('트리의 이미지') })).id
    const linked = (await createPage(fx.owner.ctx, { title: titleFromPlainText('링크 이미지') })).id
    const a = await upload()
    await setPageIcon(fx.owner.ctx, page, fileIcon(a))
    await setPageIcon(fx.owner.ctx, linked, external('https://example.com/linked.png'))
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '트리의 이미지 표' }))
    unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, external('https://example.com/table.png')))

    const tree = await listPageTree(fx.owner.ctx)
    assert.deepEqual(findNode(tree, page)?.icon, fileIcon(a))
    assert.deepEqual(findNode(tree, linked)?.icon, external('https://example.com/linked.png'))
    assert.deepEqual(findNode(tree, db.id)?.icon, external('https://example.com/table.png'))
    const labels = await loadMentionLabels(fx.owner.ctx, { userIds: [], pageIds: [page, linked, db.id] })
    assert.deepEqual(labels.pageIcons, {
      [page]: fileIcon(a),
      [linked]: external('https://example.com/linked.png'),
      [db.id]: external('https://example.com/table.png'),
    })
  })
})
