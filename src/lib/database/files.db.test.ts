/**
 * 파일과 미디어 속성 — 쓰기 · 칸 가드 · 참조 장부 · 필터 (DB) — PT-4조각 (F-03-04)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 PT-1] ⑧ · §3.10 `file.ref_count` — 불변식 FS1).
 *
 *   ① ★ 쓰기 · 읽기 — {id, name} 의 배열이 저장된다 · 이 워크스페이스의 파일이 아니면 앱이 거부한다
 *   ② ★ 칸 가드(0139) — 앱을 거치지 않은 쓰기도 다른 워크스페이스 · 없는 파일 · 중복 · 20개 초과 · 이름 길이를 DB 가 거부한다
 *   ③ ★ 참조 장부 — 넣으면 +1 · 빼면 −1 · 같은 파일을 다시 쓰면 그대로 · 영구 삭제(물리)의 CASCADE 가 −1 · 데이터베이스 복제 · 템플릿은 +1
 *   ④ ★ 칸이 가리키는 파일은 지워지지 않는다(ref_count > 0 — FS1)
 *   ⑤ ★ 필터 — 비어 있음(칸이 없는 행도) · 비어 있지 않음 · 정렬은 거부
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { runTrashHardDelete } from '../block/trash-hard-delete.ts'
import { purgePage, trashPage } from '../block/trash.ts'
import { asBlockId } from '../ids.ts'
import { query } from '../db/pool.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { uploadFile } from '../file/file.ts'
import { makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { duplicateDatabase } from './duplicate-database.ts'
import { addProperty, getSchema } from './property.ts'
import { queryRows } from './query.ts'
import { createRow, updateCells } from './row.ts'
import { createRowFromTemplate, createTemplate } from './template.ts'
import { validateSorts, type FilterNode } from './filter.ts'
import type { CellValue } from './property-types.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fx: Fixture
let other: Fixture

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

async function upload(who: Fixture = fx, name = '메모.txt'): Promise<string> {
  const out = await uploadFile(who.owner.ctx, { bytes: new Uint8Array(16).fill(7), mime: 'text/plain', originalName: name, kind: 'file' })
  assert.equal(out.ok, true)
  if (!out.ok) throw new Error('unreachable')
  return out.file.id
}

const refCount = async (fileId: string): Promise<number> => (await query<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [fileId]))[0]!.ref_count
const files = (...refs: [string, string][]): CellValue => ({ type: 'files', files: refs.map(([id, name]) => ({ id, name })) })

async function setup() {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name: `파일 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '첨부', type: 'files' }))
  const props = unwrap(await getSchema(fx.owner.ctx, ds)).properties
  const prop = props.find((p) => p.name === '첨부')!.id
  const row = async (cells: CellValue[] = []) =>
    unwrap(await createRow(fx.owner.ctx, ds, { cells: cells.map((value) => ({ propertyId: prop, value })) })).id
  const put = (rowId: string, value: unknown) => updateCells(fx.owner.ctx, rowId, { cells: [{ propertyId: prop, value: value as CellValue }] })
  return { db, ds, prop, row, put }
}

test('① ★ 쓰기 · 읽기 — {id, name} 이 저장되고 이 워크스페이스의 파일이 아니면 앱이 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const a = await upload()
  const foreign = await upload(other)
  const id = await s.row()
  unwrap(await s.put(id, files([a, '메모.txt'])))
  const read = unwrap(await queryRows(fx.owner.ctx, s.ds, {})).rows.find((r) => r.id === id)!.properties[s.prop]
  assert.deepEqual(read, files([a, '메모.txt']))

  assert.equal((await s.put(id, files([foreign, '남의.txt']))).ok, false, '다른 워크스페이스의 파일')
  assert.equal((await s.put(id, files([randomUUID(), '없는.txt']))).ok, false, '없는 파일')
  assert.equal((await s.put(id, files([a, 'x'], [a, 'y']))).ok, false, '같은 파일 두 번')
  assert.equal((await s.put(id, files([a, '']))).ok, false, '빈 이름')
  assert.equal((await s.put(id, files([a, 'n'.repeat(256)]))).ok, false, '256자 이름')
  assert.equal((await s.put(id, { type: 'files', files: 'x' })).ok, false, '배열이 아니다')
  assert.equal(await refCount(foreign), 0, '남의 파일의 참조는 움직이지 않는다')
  assert.deepEqual(unwrap(await queryRows(fx.owner.ctx, s.ds, {})).rows.find((r) => r.id === id)!.properties[s.prop], files([a, '메모.txt']), '거부된 쓰기는 값을 바꾸지 않는다')
})

test('② ★ 칸 가드 — 앱을 거치지 않은 쓰기도 DB 가 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row()
  const a = await upload()
  const foreign = await upload(other)
  const put = (value: unknown) =>
    query(
      `INSERT INTO page_property_value (page_id, property_id, value) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (page_id, property_id) DO UPDATE SET value = EXCLUDED.value`,
      [id, s.prop, JSON.stringify(value)],
    )
  const twenty = await Promise.all(Array.from({ length: 21 }, async (_, i) => ({ id: await upload(fx, `f${i}`), name: `f${i}` })))
  const bad: [string, unknown][] = [
    ['다른 워크스페이스의 파일', files([foreign, 'x'])],
    ['없는 파일', files([randomUUID(), 'x'])],
    ['같은 파일 두 번', files([a, 'x'], [a, 'y'])],
    ['21개', { type: 'files', files: twenty }],
    ['빈 이름', files([a, ''])],
    ['256자 이름', files([a, 'n'.repeat(256)])],
    ['모르는 키', { type: 'files', files: [{ id: a, name: 'x', size: 1 }] }],
    ['봉투 타입이 다르다', { type: 'url', url: 'x' }],
    ['배열이 아니다', { type: 'files', files: { id: a } }],
    ['id 가 uuid 가 아니다', { type: 'files', files: [{ id: 'abc', name: 'x' }] }],
  ]
  for (const [label, value] of bad) {
    await assert.rejects(put(value), (e: { constraint?: string }) => e.constraint === 'tg_ppv_files_shape', label)
  }
  await put(files([a, 'n'.repeat(255)]))
  await put({ type: 'files', files: twenty.slice(0, 20) })
  await put({ type: 'files', files: [] })
})

test('③ ★ 참조 장부 — 넣으면 +1 · 빼면 −1 · 같은 파일은 그대로 · 영구 삭제(물리)가 −1 · 복제 · 템플릿은 +1', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const a = await upload()
  const b = await upload()
  const row = await s.row()

  unwrap(await s.put(row, files([a, 'a'])))
  assert.equal(await refCount(a), 1, '넣으면 +1')
  unwrap(await s.put(row, files([a, '이름만 바꿈'])))
  assert.equal(await refCount(a), 1, '같은 파일을 다시 쓰면 그대로')
  unwrap(await s.put(row, files([a, 'a'], [b, 'b'])))
  assert.deepEqual([await refCount(a), await refCount(b)], [1, 1], '하나 더 넣으면 그 파일만 +1')
  unwrap(await s.put(row, files([b, 'b'])))
  assert.deepEqual([await refCount(a), await refCount(b)], [0, 1], '빼면 −1')
  unwrap(await s.put(row, { type: 'files', files: [] }))
  assert.equal(await refCount(b), 0, '비우면 −1')
  unwrap(await s.put(row, files([a, 'a'], [b, 'b'])))

  // 템플릿으로 만든 행 — 같은 파일을 가리키는 참조가 하나 더
  const template = unwrap(await createTemplate(fx.owner.ctx, s.ds, { title: '틀' }))
  unwrap(await s.put(template.id, files([a, 'a'])))
  assert.equal(await refCount(a), 2, '템플릿 칸도 센다')
  const made = unwrap(await createRowFromTemplate(fx.owner.ctx, s.ds, template.id, {}))
  assert.equal(await refCount(a), 3, '템플릿으로 만든 행은 +1')
  assert.deepEqual(unwrap(await queryRows(fx.owner.ctx, s.ds, {})).rows.find((r) => r.id === made.row.id)!.properties[s.prop], files([a, 'a']))

  // 데이터베이스 복제(내용과 함께) — 행의 칸마다 +1
  const before = [await refCount(a), await refCount(b)]
  unwrap(await duplicateDatabase(fx.owner.ctx, s.db.id, { content: true }))
  const after = [await refCount(a), await refCount(b)]
  assert.deepEqual(after, [before[0]! + 3, before[1]! + 1], '복제된 행(2) + 템플릿(1)이 가리키는 만큼 +1')

  // 영구 삭제 — 휴지통 · purged 는 내리지 않고(되살릴 수 있다) 30일 뒤 물리 삭제의 CASCADE 가 내린다
  const [refsA, refsB] = [await refCount(a), await refCount(b)]
  await trashPage(fx.owner.ctx, asBlockId(row))
  await purgePage(fx.owner.ctx, asBlockId(row))
  assert.deepEqual([await refCount(a), await refCount(b)], [refsA, refsB], 'purged 는 내리지 않는다')
  await runTrashHardDelete(new Date(Date.now() + 31 * 86_400_000), { workspaces: [fx.workspaceId] })
  assert.deepEqual([await refCount(a), await refCount(b)], [refsA - 1, refsB - 1], '물리 삭제가 −1')
})

test('④ ★ 칸이 가리키는 파일은 ref_count > 0 이라 GC 의 대상이 아니다(FS1) · 빼면 대상이 된다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const a = await upload()
  const row = await s.row([files([a, 'a'])])
  // 아무도 가리키지 않는 파일 = ref_count 0 (`ix_file_unreferenced` 가 그 목록을 위한 인덱스 — GC 함수는 아직 없다)
  const unreferenced = async () => (await query<{ id: string }>(`SELECT id FROM file WHERE workspace_id = $1 AND ref_count = 0`, [fx.workspaceId])).map((r) => r.id)
  assert.equal((await unreferenced()).includes(a), false, '칸이 가리키는 파일은 목록에 없다')
  unwrap(await s.put(row, { type: 'files', files: [] }))
  assert.equal((await unreferenced()).includes(a), true, '뺀 파일은 아무도 가리키지 않는다')
})

test('⑤ ★ 필터 — 비어 있음(칸이 없는 행도) · 비어 있지 않음 · 정렬은 거부', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const a = await upload()
  const filled = await s.row([files([a, 'a'])])
  const none = await s.row()
  const emptied = await s.row([files([a, 'a'])])
  unwrap(await s.put(emptied, { type: 'files', files: [] }))
  const ids = async (filter: FilterNode) => unwrap(await queryRows(fx.owner.ctx, s.ds, { filter, limit: 50 })).rows.map((r) => r.id).sort()
  assert.deepEqual(await ids({ property_id: s.prop, operator: 'is_empty' } as FilterNode), [none, emptied].sort(), '비어 있음')
  assert.deepEqual(await ids({ property_id: s.prop, operator: 'is_not_empty' } as FilterNode), [filled], '비어 있지 않음')
  // 정렬은 저장 경로가 거부하고 컴파일러는 건너뛴다(오류 없이 순서만 그대로)
  assert.equal(validateSorts([{ property_id: s.prop, direction: 'asc' }], new Map([[s.prop, 'files']])).length, 1, '정렬 키로 저장할 수 없다')
  assert.equal((await queryRows(fx.owner.ctx, s.ds, { sorts: [{ property_id: s.prop, direction: 'asc' }], limit: 50 })).ok, true)
})
