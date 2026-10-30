/**
 * 데이터베이스 복제 — 내용 없이(스키마 · 뷰) (29번 트랙 D-1 · 노션의 "Duplicate without content")
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 D-1]
 *
 * 원본의 **모양**을 새 id 로 다시 만든다 — 데이터베이스 · 소유한 소스 · 속성 · 상태 그룹 · 옵션 · 속성 의존 · 뷰 · 뷰의 열 · 폼(닫힌 채) · 행 페이지
 * 레이아웃(탭 · 모듈) · 행 규칙 · 버튼의 자동화(웹훅 액션은 빼고) · 붙인 소스의 부착. 행 · 행의 본문 · 템플릿은 D-2 · D-3 의 몫이다.
 *
 *   - **한 트랜잭션** — 반쯤 복제하고 멈추지 않는다.
 *   - **행을 JSON 으로 읽어 id 만 바꿔 그대로 넣는다**(`jsonb_populate_recordset`) — 표에 칸이 늘어도 사본이 조용히 빠뜨리지 않는다. 바꾸는
 *     것은 지도(옛 id → 새 id)로 훑어서다(`duplicate-database-remap.ts`) — 그 글자를 담은 모든 칸(키 · 설정 JSON · 수식 토큰)이 함께 바뀐다.
 *   - **바깥은 그대로** — 지도에 없는 id(다른 데이터베이스의 속성 · 소스)는 원본과 같은 바깥을 가리킨다. 바깥 표를 가리키는 양방향 relation 은
 *     한쪽으로 바꾼다(짝은 그 표의 것이다 · 남의 표에 짝을 만들지 않는다).
 *   - **자리** — 원본과 같은 자리(페이지 복제와 같다): 인라인이면 원본 참조 바로 뒤 · 최상위면 같은 부모(워크스페이스 · teamspace · 내 개인)의 끝.
 *   - **권한** — 원본을 볼 수 있어야 하고(`view` — 구조를 읽는다) 그 자리에 만들 수 있어야 한다(인라인 — 부모 페이지에 만들기 · teamspace —
 *     그 teamspace 에 만들기). 아니면 없는 것과 같은 답.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, type Tx } from '../db/tx.ts'
import { asBlockId, isUuid } from '../ids.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps, teamspaceCaps } from '../permissions/effective.ts'
import { enterPrivateRoot, inheritFromWorkspace } from '../permissions/acl.ts'
import { lockParentPage, nextSiblingKey, PageError, readTitle } from '../block/page.ts'
import { openPageBody, ownerPageOf } from '../block/body-write.ts'
import { insertPageRefAfter } from '../block/page-refs.ts'
import { duplicateTitle } from '../block/duplicate-remap.ts'
import { readPageIcon } from '../block/page-icon.ts'
import { addIconFileReference } from '../file/icon-reference.ts'
import { indexPageTitle } from '../search/index-page.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { newPropertyId } from './property.ts'
import { remapIds, remapRelationConfig, type IdMap } from './duplicate-database-remap.ts'

export type DuplicateDatabaseFailure = 'not_found' | 'too_deep'

export type DuplicateDatabaseResult =
  | {
      readonly ok: true
      readonly value: {
        readonly id: string
        readonly name: string
        /** 사본이 처음 여는 뷰(탭 순서의 첫째). */
        readonly defaultViewId: string | null
        /** 바깥 표를 가리켜 한쪽으로 바꾼 relation 수 — 화면이 "일부 관계는 한쪽으로 복제했습니다" 를 말할 수 있게. */
        readonly oneWayRelations: number
      }
    }
  | { readonly ok: false; readonly reason: DuplicateDatabaseFailure }

type Row = Record<string, unknown>

/** 데이터베이스를 내용 없이 복제한다(정본 [보강 D-1]). */
export async function duplicateDatabase(
  ctx: SessionContext,
  databaseId: string,
  options: { readonly content: false },
): Promise<DuplicateDatabaseResult> {
  void options
  if (!isUuid(databaseId)) return { ok: false, reason: 'not_found' }
  return withCommandTransaction(async (tx) => {
    const source = await tx.queryMaybe<{
      id: string
      parent_type: string
      parent_id: string
      owner_user_id: string | null
      properties: { title?: unknown } | null
    }>(
      `SELECT id, parent_type, parent_id, owner_user_id, properties FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'database' AND lifecycle = 'live'`,
      [databaseId, ctx.workspaceId],
    )
    // 구조를 읽는다 — "만들기만" 으로는 복제하지 않는다(모든 행 · 속성을 볼 수 있어야 한다)
    if (source === null || !can(await effectiveCaps(tx, ctx, databaseId), 'view')) return { ok: false, reason: 'not_found' } as const
    const title = duplicateTitle(readTitle(source.properties))
    const name = toPlainText(title)
    const id = randomUUID()

    // ── 자리 · 블록 ──
    let inlineBody: Awaited<ReturnType<typeof openPageBody>> | null = null
    if (source.parent_type === 'block') {
      const host = await ownerPageOf(tx, ctx, source.parent_id)
      if (host === null) return { ok: false, reason: 'not_found' } as const
      let placement: Awaited<ReturnType<typeof lockParentPage>>
      try {
        placement = await lockParentPage(tx, ctx, asBlockId(host))
      } catch (e) {
        if (e instanceof PageError) return { ok: false, reason: e.code === 'too_deep' ? 'too_deep' : 'not_found' } as const
        throw e
      }
      // 하위 페이지 · 인라인 데이터베이스와 같다 — 행을 넣기 **전에** 부모 본문을 연다
      inlineBody = await openPageBody(tx, ctx, placement.parentId)
      await insertBlock(tx, ctx, { id, title, parentType: 'block', parentId: placement.parentId, orderKey: await nextSiblingKey(tx, placement.parentId),
        ancestorPath: placement.ancestorPath, permScopeId: placement.permScopeId, ownerUserId: null })
    } else {
      const teamspaceId = source.parent_type === 'teamspace' ? source.parent_id : null
      // 개인 최상위의 사본은 **복제한 사람의** 개인 최상위다(페이지 복제와 같다 — 7c-7)
      const privateTop = source.parent_type === 'workspace' && source.owner_user_id !== null
      if (teamspaceId !== null) {
        const teamspace = await tx.queryMaybe<{ id: string }>(
          `SELECT id FROM teamspace WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL FOR UPDATE`,
          [teamspaceId, ctx.workspaceId],
        )
        if (teamspace === null || !can(await teamspaceCaps(tx, ctx, teamspace.id), 'create_child')) return { ok: false, reason: 'not_found' } as const
      }
      if (privateTop && ctx.role === 'guest') return { ok: false, reason: 'not_found' } as const
      const parentId = teamspaceId ?? ctx.workspaceId
      await insertBlock(tx, ctx, { id, title, parentType: teamspaceId === null ? 'workspace' : 'teamspace', parentId, orderKey: await nextSiblingKey(tx, parentId),
        ancestorPath: [], permScopeId: teamspaceId ?? id, ownerUserId: privateTop ? ctx.userId : null })
      if (privateTop) await enterPrivateRoot(tx, ctx, id)
      else if (teamspaceId === null) await inheritFromWorkspace(tx, ctx, id)
    }
    await indexPageTitle(tx, id, name)

    // ── 원본의 모양을 읽는다 ──
    const database = await readOne(tx, `SELECT to_jsonb(d) AS row FROM database d WHERE d.id = $1`, [databaseId])
    const sources = await readRows(tx,
      `SELECT to_jsonb(ds) AS row FROM data_source ds
         JOIN database_data_source dds ON dds.data_source_id = ds.id AND dds.database_id = $1
        WHERE ds.owner_database_id = $1 AND ds.lifecycle = 'live' ORDER BY dds.order_idx, ds.id`, [databaseId])
    const sourceIds = sources.map((s) => String(s.id))
    const attachments = await readRows(tx,
      `SELECT to_jsonb(dds) AS row FROM database_data_source dds JOIN data_source ds ON ds.id = dds.data_source_id
        WHERE dds.database_id = $1 AND (ds.owner_database_id <> $1 OR ds.id = ANY($2::uuid[])) ORDER BY dds.order_idx`, [databaseId, sourceIds])
    const properties = await readRows(tx,
      `SELECT to_jsonb(p) AS row FROM property p WHERE p.data_source_id = ANY($1::uuid[]) AND p.deleted_at IS NULL ORDER BY p.order_idx, p.id`, [sourceIds])
    const propertyIds = properties.map((p) => String(p.id))
    const statusGroups = await readRows(tx, `SELECT to_jsonb(g) AS row FROM status_group g WHERE g.property_id = ANY($1::text[])`, [propertyIds])
    const options = await readRows(tx, `SELECT to_jsonb(o) AS row FROM select_option o WHERE o.property_id = ANY($1::text[]) ORDER BY o.order_idx, o.id`, [propertyIds])
    const dependencies = await readRows(tx,
      `SELECT to_jsonb(d) AS row FROM property_dependency d WHERE d.dependent_property_id = ANY($1::text[])`, [propertyIds])
    // 뷰 — 데이터베이스의 탭(살아 있는 소유 소스 · 붙인 소스의 것) · 행 페이지 레이아웃의 탭이 쓰는 뷰
    const linkedIds = attachments.map((a) => String(a.data_source_id)).filter((ds) => !sourceIds.includes(ds))
    const views = await readRows(tx,
      `SELECT to_jsonb(v) AS row FROM view v
        WHERE ((v.database_id = $1 AND v.owner_kind = 'database_view' AND v.data_source_id = ANY($2::uuid[]))
            OR (v.owner_kind = 'layout_tab' AND v.data_source_id = ANY($3::uuid[])))
        ORDER BY v.order_idx, v.id`, [databaseId, [...sourceIds, ...linkedIds], sourceIds])
    const viewIds = views.map((v) => String(v.id))
    const viewProperties = await readRows(tx, `SELECT to_jsonb(vp) AS row FROM view_property vp WHERE vp.view_id = ANY($1::uuid[])`, [viewIds])
    const forms = await readRows(tx, `SELECT to_jsonb(f) AS row FROM form_view f WHERE f.view_id = ANY($1::uuid[])`, [viewIds])
    const questions = await readRows(tx, `SELECT to_jsonb(q) AS row FROM form_question q WHERE q.view_id = ANY($1::uuid[])`, [viewIds])
    const layouts = await readRows(tx, `SELECT to_jsonb(l) AS row FROM page_layout l WHERE l.data_source_id = ANY($1::uuid[])`, [sourceIds])
    const tabs = await readRows(tx, `SELECT to_jsonb(t) AS row FROM layout_tab t WHERE t.data_source_id = ANY($1::uuid[]) ORDER BY t.order_idx, t.id`, [sourceIds])
    const modules = await readRows(tx, `SELECT to_jsonb(m) AS row FROM layout_module m WHERE m.data_source_id = ANY($1::uuid[]) ORDER BY m.order_idx, m.id`, [sourceIds])
    const rules = await readRows(tx, `SELECT to_jsonb(r) AS row FROM page_access_rule r WHERE r.data_source_id = ANY($1::uuid[])`, [sourceIds])
    const buttons = await readRows(tx,
      `SELECT to_jsonb(a) AS row FROM automation a WHERE a.kind = 'button_property' AND a.host_property_id = ANY($1::text[])`, [propertyIds])
    const actions = await readRows(tx,
      `SELECT to_jsonb(x) AS row FROM automation_action x WHERE x.automation_id = ANY($1::uuid[]) AND x.type <> 'send_webhook'`,
      [buttons.map((b) => String(b.id))])

    // ── 지도 — 옛 id → 새 id ──
    const ids = new Map<string, string>([[databaseId, id]])
    for (const s of sources) ids.set(String(s.id), randomUUID())
    for (const p of properties) ids.set(String(p.id), newPropertyId())
    for (const rows of [statusGroups, options, views, tabs, modules, rules, buttons, actions]) for (const r of rows) ids.set(String(r.id ?? r.view_id), randomUUID())
    const now = new Date().toISOString()
    const fresh = (row: Row, extra: Row = {}): Row => ({ ...remapIds(row, ids), ...stamped(row, now), ...extra })

    // ── 쓴다 — 가리키는 쪽이 가리켜지는 쪽 뒤에 ──
    await insertRows(tx, 'database', [fresh(database, { title_rich: title, is_inline: source.parent_type === 'block' })])
    await addIconFileReference(tx, ctx, readPageIcon(database.icon ?? null))
    // 소스 — 새 번호는 0부터(행이 없다) · 휴지통 칸은 비운다(살아 있는 것만 읽었다)
    await insertRows(tx, 'data_source', sources.map((s) => fresh(s, { unique_id_counter: 0, change_seq: 0 })))
    await insertRows(tx, 'database_data_source', attachments.map((a) => remapIds(a, ids)))
    let oneWay = 0
    await insertRows(tx, 'property', properties.map((p) => {
      if (p.type !== 'relation' || typeof p.config !== 'object' || p.config === null) return fresh(p)
      const config = remapRelationConfig(p.config as Row, ids)
      if ('synced_property_id' in (p.config as Row) && !('synced_property_id' in config)) oneWay += 1
      return fresh(p, { config })
    }))
    await insertRows(tx, 'status_group', statusGroups.map((g) => remapIds(g, ids)))
    await insertRows(tx, 'select_option', options.map((o) => remapIds(o, ids)))
    await insertRows(tx, 'property_dependency', dependencies.map((d) => remapIds(d, ids)))
    // 뷰 — 대시보드 뷰를 가리키는 칸은 뷰를 다 넣은 뒤 · 템플릿은 아직 없다(행이 없다 — D-3)
    await insertRows(tx, 'view', views.map((v) => fresh(v, { dashboard_view_id: null, default_template_page_id: null, owner_user_id: null })))
    for (const v of views) {
      if (v.dashboard_view_id != null) await tx.query(`UPDATE view SET dashboard_view_id = $2 WHERE id = $1`, [ids.get(String(v.id)), ids.get(String(v.dashboard_view_id)) ?? null])
    }
    await insertRows(tx, 'view_property', viewProperties.map((vp) => remapIds(vp, ids)))
    // 폼 — 닫힌 채(공개 주소는 사본의 것이 아니다 — 토큰은 하나다)
    await insertRows(tx, 'form_view', forms.map((f) => fresh(f, { access: 'closed', token: null, updated_by: ctx.userId })))
    await insertRows(tx, 'form_question', questions.map((q) => remapIds(q, ids)))
    await insertRows(tx, 'page_layout', layouts.map((l) => fresh(l, { updated_by: ctx.userId })))
    await insertRows(tx, 'layout_tab', tabs.map((t) => remapIds(t, ids)))
    // 모듈 — 부모 모듈이 먼저(자기 참조)
    await insertRows(tx, 'layout_module', modules.map((m) => ({ ...remapIds(m, ids), parent_module_id: null })))
    for (const m of modules) {
      if (m.parent_module_id != null) await tx.query(`UPDATE layout_module SET parent_module_id = $2 WHERE id = $1`, [ids.get(String(m.id)), ids.get(String(m.parent_module_id)) ?? null])
    }
    await insertRows(tx, 'page_access_rule', rules.map((r) => remapIds(r, ids)))
    await insertRows(tx, 'automation', buttons.map((b) => fresh(b, { created_by: ctx.userId })))
    await insertRows(tx, 'automation_action', actions.map((x) => remapIds(x, ids)))

    if (inlineBody !== null) {
      inlineBody.change(insertPageRefAfter(id, null, databaseId, 'database'))
      const result = await inlineBody.finish()
      if (!result.ok && result.reason === 'page_ref_too_deep') return { ok: false, reason: 'too_deep' } as const
      if (!result.ok) throw new Error(`본문 투영이 데이터베이스 복제를 거부했다(${result.reason}): ${databaseId}`)
    }

    const first = views.find((v) => v.owner_kind === 'database_view')
    return {
      ok: true,
      value: { id, name, defaultViewId: first === undefined ? null : (ids.get(String(first.id)) ?? null), oneWayRelations: oneWay },
    } as const
  })
}

async function insertBlock(
  tx: Tx,
  ctx: SessionContext,
  input: {
    readonly id: string
    readonly title: readonly RichTextRun[]
    readonly parentType: 'block' | 'workspace' | 'teamspace'
    readonly parentId: string
    readonly orderKey: string
    readonly ancestorPath: readonly string[]
    readonly permScopeId: string
    readonly ownerUserId: string | null
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO block (
       id, workspace_id, type, parent_type, parent_id, order_key, ancestor_path, perm_scope_id, owner_user_id,
       properties, format, created_by, created_at, last_edited_by, last_edited_at
     ) VALUES ($1, $2, 'database', $3, $4, $5, $6, $7, $8, $9::jsonb, '{}'::jsonb, $10, now(), $10, now())`,
    [input.id, ctx.workspaceId, input.parentType, input.parentId, input.orderKey, input.ancestorPath, input.permScopeId, input.ownerUserId,
      JSON.stringify({ title: input.title }), ctx.userId],
  )
}

async function readRows(tx: Tx, sql: string, params: readonly unknown[]): Promise<Row[]> {
  return (await tx.query<{ row: Row }>(sql, params)).map((r) => r.row)
}

async function readOne(tx: Tx, sql: string, params: readonly unknown[]): Promise<Row> {
  const rows = await readRows(tx, sql, params)
  if (rows[0] === undefined) throw new Error(`복제할 원본의 행이 없다: ${sql}`)
  return rows[0]
}

/** 행을 그대로 넣는다 — 칸 이름 · 순서는 표의 것(`jsonb_populate_recordset`). */
async function insertRows(tx: Tx, table: string, rows: readonly Row[]): Promise<void> {
  if (rows.length === 0) return
  await tx.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [JSON.stringify(rows)])
}

/** 만든 · 고친 시각 칸이 있으면 지금으로. */
function stamped(row: Row, now: string): Row {
  const out: Row = {}
  for (const key of ['created_at', 'updated_at']) if (key in row) out[key] = now
  return out
}

/** 지도 타입을 바깥에서 쓰지 않는다 — 검사용으로만 내보낸다. */
export type { IdMap }
