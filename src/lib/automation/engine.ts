/**
 * 자동화 엔진 — 액션을 순서대로, 한 트랜잭션에서, 실행 기록 하나로 (자동화 5a-1 · 5c-1 · F-08-07 · F-08-10 · F-08-13)
 *
 * 정본: 00-canonical-data-model.md §3.10 불변식 AU1 · [보강] 자동화 엔진 · 버튼 속성 ③ ④ ⑤ ⑦ ⑫ ⑯
 *
 *   ① 멱등 — 실행 기록을 멱등 키로 먼저 넣는다(`UNIQUE (workspace_id, idempotency_key)`). 같은 키가 이미 있으면 실행하지 않고 그 기록을
 *     돌려준다(연타 · 다시 보내기). 다른 automation 의 키면 null — 부르는 쪽이 거절한다.
 *   ② 한 트랜잭션(AU1) — 액션을 순서대로 같은 트랜잭션에서 실행한다. 액션마다 세이브포인트를 둔다.
 *   ③ 건너뛰기 — 대상을 고칠 권한이 없거나(`forbidden` · 볼 수 없으면 `not_found`) 잠겼으면(`locked`) 그 액션만 되돌리고 건너뛴다.
 *     실행은 `partial`(08 *"접근이 제한된 페이지에는 영향을 주지 않는다 — 스킵 + 로그"*).
 *   ④ 실패 — 그 밖의 거절(값이 틀렸다 · 속성이 사라졌다)은 **전부 되돌리고** 실패 기록만 따로 남긴다(반쪽 실행이 남지 않게).
 *   ⑤ 액션은 **실행하는 사람의 권한으로** 다시 판정된다 — 각 액션이 부르는 명령(`updateCellsIn` …)이 그 사람의 `SessionContext` 로 묻는다.
 *   ⑥ 기록에는 id 와 까닭만 — 대상의 내용을 담지 않는다(레벨이 전순서가 아니다 · A2).
 *   ⑦ `send_webhook` 은 바깥으로 나가지 않는다 — 같은 트랜잭션에서 배달 한 줄(`automation_delivery`)을 쌓는다(되돌리면 함께 사라진다).
 *     몸은 그때의 값을 실행하는 사람의 권한으로 읽는다(그 행을 볼 수 없으면 건너뛴다). 요금제가 허락하지 않으면 건너뛴다(`plan`).
 *   ⑧ 동적 값(⑯) — 셀의 `from` 을 실행할 때 푼다: 지금은 그 실행의 시작 시각, 일하는 행의 속성은 그때의 값(실행하는 사람이 그 행을 볼 수 있을
 *     때만 · 비었으면 빈 값 · 원본 속성이 사라졌거나 타입이 바뀌었으면 실패).
 *   ⑨ 블록 넣기(정본 ⑱) — 그 페이지의 본문을 **명령 경로로** 연다(페이지 행 잠금 → 본문 세션 → 변경 → 투영 · 로그 · 퍼뜨리기). 블록마다 새 id ·
 *     버튼 아래 또는 페이지 끝. 같은 트랜잭션이라 실행이 되돌려지면 넣은 블록도 남지 않는다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { createRowIn, isRowFailure, openDataSource, readRow, updateCellsIn, type RowCell, type RowSummary } from '../database/row.ts'
import { emptyValue, isMvpPropertyType, type CellValue } from '../database/property-types.ts'
import { createRowFromTemplateIn, readLiveTemplate } from '../database/template.ts'
import { entitlement } from '../billing/entitlement.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { isDynamicCell, type ActionCell, type ActionType, type InsertBlocksConfig, type SendWebhookStored, type StoredAction } from './actions.ts'
import { openPageBody } from '../block/body-write.ts'
import { remapBody } from '../block/duplicate-remap.ts'
import { containerFor } from '../editor/pm-adapter.ts'
import { findContainerById } from '../editor/pm-blocks.ts'
import type { WriteOrigin } from './trigger-route.ts'

export type StepStatus = 'done' | 'skipped' | 'failed'
export type Step = {
  readonly index: number
  readonly type: ActionType
  readonly status: StepStatus
  readonly reason?: string
  /** `add_page_to` 가 만든 행 — 화면이 열어 준다(내용은 담지 않는다 · ⑥). */
  readonly pageId?: string
  /** `send_webhook` 이 쌓은 배달(⑦). */
  readonly deliveryId?: string
}
export type RunStatus = 'success' | 'partial' | 'failed'
export type RunOutcome = { readonly runId: string; readonly status: RunStatus; readonly steps: readonly Step[]; readonly duplicate: boolean }

/**
 * 액션이 일하는 자리 — 버튼 속성이면 누른 행 · DB automation 이면 트리거된 행 · 버튼 블록이면 그 페이지. `hostBlockId` 는 버튼 블록 자신
 * (블록 넣기가 그 아래에 넣는다 · 정본 ⑱).
 */
export type RunContext = { readonly triggerPageId: string; readonly hostBlockId?: string }

/**
 * 실행의 종류 — 버튼 속성 · 버튼 블록(누른 사람 · origin `user` · depth 0 · 쓰기는 `button` — DB automation 이 받는다 · 버튼 블록은 ⑰) 또는
 * DB automation(만든 사람의
 * 위임 · origin `automation` · depth 1 · 쓰기는 `automation` — 다른 automation 을 깨우지 않는다 · 정본 [보강] DB automation ⓒ).
 */
export type RunKind = 'button' | 'button_block' | 'db_automation'
const RUN_ORIGIN: Record<RunKind, 'user' | 'automation'> = { button: 'user', button_block: 'user', db_automation: 'automation' }
const RUN_DEPTH: Record<RunKind, number> = { button: 0, button_block: 0, db_automation: 1 }
const WRITE_ORIGIN: Record<RunKind, WriteOrigin> = { button: 'button', button_block: 'button', db_automation: 'automation' }

/** 이 액션은 건너뛴다(권한 · 잠금) — 세이브포인트를 되돌린다. */
class StepSkipped extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.reason = reason
  }
}
/** 이 액션이 실패했다 — 실행 전체를 되돌린다. */
class StepFailed extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.reason = reason
  }
}
class RunFailed extends Error {
  readonly steps: readonly Step[]
  constructor(steps: readonly Step[]) {
    super('automation run failed')
    this.steps = steps
  }
}

/** 건너뛰는 거절 — 대상에 손댈 수 없다(③). 나머지는 실패(④). */
const SKIPPABLE: ReadonlySet<string> = new Set(['forbidden', 'not_found', 'locked'])

/** 액션의 결과 — 만든 행 · 쌓은 배달이 있으면 그 id. */
type Done = { readonly pageId?: string; readonly deliveryId?: string }

/** 실행 하나의 자리 — 쓰기의 출처 · 실행 기록 · automation(배달이 싣는다) · 시작 시각(동적 값 "지금"). */
type RunEnv = { readonly origin: WriteOrigin; readonly runId: string; readonly automationId: string; readonly startedAt: string }

/** 일하는 행의 속성으로 채울 수 없는 타입(`action-check.ts` 와 같다 · 정본 ⑯). */
const NOT_COPYABLE: ReadonlySet<string> = new Set(['select', 'status'])

/**
 * 동적 값을 고정 값으로 푼다(⑧ · 정본 ⑯). 고정 값만이면 그대로. 일하는 행은 처음 필요할 때 한 번 읽는다 — 실행하는 사람이 볼 수 없으면 그
 * 액션을 건너뛴다(웹훅과 같다).
 */
async function resolveCells(tx: Tx, ctx: SessionContext, cells: readonly ActionCell[], context: RunContext, env: RunEnv): Promise<RowCell[]> {
  if (!cells.some(isDynamicCell)) return cells as RowCell[]
  let row: RowSummary | undefined
  let types: Map<string, string> | undefined
  const out: RowCell[] = []
  for (const cell of cells) {
    if (!isDynamicCell(cell)) {
      out.push(cell)
      continue
    }
    if (cell.from.kind === 'now') {
      out.push({ propertyId: cell.propertyId, value: { type: 'date', date: { start: env.startedAt } } })
      continue
    }
    if (row === undefined || types === undefined) {
      if (!can(await effectiveCaps(tx, ctx, context.triggerPageId), 'view')) throw new StepSkipped('not_found')
      const read = await readRow(tx, context.triggerPageId)
      if (read === null) throw new StepSkipped('not_found')
      row = read
      types = new Map(
        (
          await tx.query<{ id: string; type: string }>(
            `SELECT pr.id, pr.type FROM property pr JOIN page p ON p.data_source_id = pr.data_source_id WHERE p.id = $1 AND pr.deleted_at IS NULL`,
            [context.triggerPageId],
          )
        ).map((p) => [p.id, p.type]),
      )
    }
    // 원본 속성이 사라졌거나 옮길 수 없는 타입이 됐다 — 정의가 깨졌다(실패 · ④)
    const type = types.get(cell.from.propertyId)
    if (type === undefined || !isMvpPropertyType(type) || NOT_COPYABLE.has(type)) throw new StepFailed('unknown_property')
    const raw = row.properties[cell.from.propertyId]
    const value = typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === type ? (raw as CellValue) : emptyValue(type)
    out.push({ propertyId: cell.propertyId, value })
  }
  return out
}

const rejected = (reason: string): never => {
  throw SKIPPABLE.has(reason) ? new StepSkipped(reason) : new StepFailed(reason)
}

/**
 * `send_webhook` 의 배달을 쌓는다(⑦ · 정본 ⑫). 몸은 `{ run_id, automation_id, page: { id, url }, properties: { 이름: 셀 값 } }` — 고른 속성 중
 * 지금 살아 있는 것만, 그때의 값으로.
 */
async function queueWebhook(tx: Tx, ctx: SessionContext, config: SendWebhookStored, context: RunContext, env: RunEnv): Promise<Done> {
  // 요금제를 내렸으면 건너뛴다 — 실패가 아니다(정본 ⑫)
  if (!(await entitlement(ctx.workspaceId, 'automation.webhook', tx))) throw new StepSkipped('plan')
  // 그 행을 실행하는 사람이 볼 수 있어야 값을 싣는다
  if (!can(await effectiveCaps(tx, ctx, context.triggerPageId), 'view')) throw new StepSkipped('not_found')
  const row = await readRow(tx, context.triggerPageId)
  if (row === null) throw new StepSkipped('not_found')
  const names = await tx.query<{ id: string; name: string }>(
    `SELECT pr.id, pr.name FROM property pr JOIN page p ON p.data_source_id = pr.data_source_id
      WHERE p.id = $1 AND pr.id = ANY($2::text[]) AND pr.deleted_at IS NULL`,
    [context.triggerPageId, config.properties],
  )
  // 선택지 셀은 옵션 id 만 담는다 — 받는 쪽은 이름이 필요하다(옵션 표에서 붙인다)
  const options = new Map(
    (
      await tx.query<{ id: string; name: string }>(`SELECT id::text, name FROM select_option WHERE property_id = ANY($1::text[])`, [config.properties])
    ).map((o) => [o.id, o.name]),
  )
  const withOptionName = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value ?? null
    const cell = value as { type?: string; select?: { id: string } | null; status?: { id: string } | null }
    if (cell.type === 'select' && cell.select) return { ...cell, select: { ...cell.select, name: options.get(cell.select.id) ?? null } }
    if (cell.type === 'status' && cell.status) return { ...cell, status: { ...cell.status, name: options.get(cell.status.id) ?? null } }
    return value
  }
  const properties: Record<string, unknown> = {}
  for (const propertyId of config.properties) {
    const name = names.find((n) => n.id === propertyId)?.name
    if (name !== undefined) properties[name] = withOptionName(row.properties[propertyId])
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const payload = {
    run_id: env.runId,
    automation_id: env.automationId,
    page: { id: row.id, url: `${appUrl}/w/${ctx.workspaceId}/${row.id}` },
    properties,
  }
  const deliveryId = randomUUID()
  await tx.query(
    `INSERT INTO automation_delivery (id, run_id, automation_id, workspace_id, url_sealed, url_hint, headers, payload, status, next_attempt_at)
     VALUES ($1, $2, $3, $4, decode($5, 'base64'), $6, $7::jsonb, $8::jsonb, 'pending', now())`,
    [deliveryId, env.runId, env.automationId, ctx.workspaceId, config.urlSealed, config.urlHint, JSON.stringify(config.headers), JSON.stringify(payload)],
  )
  return { deliveryId }
}

/** 블록 넣기(⑨ · 정본 ⑱) — 새 id 로 복제해 버튼 아래(같은 부모 · 바로 뒤) 또는 페이지 끝. 버튼이 사라졌으면 페이지 끝. */
async function insertBlocks(tx: Tx, ctx: SessionContext, config: InsertBlocksConfig, context: RunContext): Promise<Done> {
  const pageId = context.triggerPageId
  // 명령 경로 ① — 본문을 가진 페이지 행을 먼저 잡는다(잠금 순서: 페이지 행 → 스냅샷)
  const page = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live' FOR UPDATE`,
    [pageId, ctx.workspaceId],
  )
  if (page === null) throw new StepSkipped('not_found')
  const write = await openPageBody(tx, ctx, pageId, 'api')
  const copied = remapBody({ blocks: config.blocks }, new Map(), randomUUID).blocks
  write.change((tr, doc) => {
    const nodes = copied.map(containerFor)
    const host = config.position === 'below' && context.hostBlockId !== undefined ? findContainerById(doc, context.hostBlockId) : null
    // 페이지 끝 — 뿌리는 doc > blockGroup > 컨테이너들
    const end = 1 + (doc.firstChild?.content.size ?? 0)
    tr.insert(host === null ? end : host.pos + host.node.nodeSize, nodes)
  })
  const result = await write.finish({ origin: 'api' })
  if (!result.ok) throw new StepFailed(result.reason)
  return {}
}

async function execute(tx: Tx, ctx: SessionContext, action: StoredAction, context: RunContext, env: RunEnv): Promise<Done> {
  const { origin } = env
  switch (action.type) {
    case 'edit_property': {
      const cells = await resolveCells(tx, ctx, action.config.cells, context, env)
      const result = await updateCellsIn(tx, ctx, context.triggerPageId, { cells, filledBy: 'automation', origin })
      return result.ok ? {} : rejected(result.reason)
    }
    case 'add_page_to': {
      // 그 표에 행을 만들 수 있는가 — 누른 사람의 권한으로(없으면 건너뛴다 · 정본 ⑨). 템플릿을 확인하기 전에 묻는다 — 볼 수 없는 표의
      // 템플릿이 있는지 없는지를 실패 까닭으로 알려주지 않게.
      const { dataSourceId, templateId } = action.config
      const gate = await openDataSource(tx, ctx, dataSourceId, 'create_child')
      if (isRowFailure(gate)) return rejected(gate.ok ? 'not_found' : gate.reason)
      const cells = await resolveCells(tx, ctx, action.config.cells, context, env)
      if (templateId === null) {
        const made = await createRowIn(tx, ctx, dataSourceId, { cells, filledBy: 'automation', origin })
        return made.ok ? { pageId: made.value.id } : rejected(made.reason)
      }
      // 템플릿이 사라졌으면 정의가 깨진 것이다 — 실패(④)
      if ((await readLiveTemplate(tx, ctx, dataSourceId, templateId)) === null) throw new StepFailed('unknown_template')
      const made = await createRowFromTemplateIn(tx, ctx, dataSourceId, templateId, { cells, precedence: 'template', filledBy: 'automation', origin })
      return made.ok ? { pageId: made.value.row.id } : rejected(made.reason)
    }
    case 'send_webhook':
      return queueWebhook(tx, ctx, action.config, context, env)
    case 'insert_blocks':
      return insertBlocks(tx, ctx, action.config, context)
  }
}

/**
 * 실행한다. 같은 키의 기록이 있으면 그것을(`duplicate`), 다른 automation 의 키면 null.
 *
 * @param input.idempotencyKey 워크스페이스 안에서 유일 — 버튼은 `button:{uuid}`
 */
export async function runAutomation(
  ctx: SessionContext,
  input: {
    readonly automationId: string
    readonly idempotencyKey: string
    readonly context: RunContext
    readonly actions: readonly StoredAction[]
    readonly kind: RunKind
  },
): Promise<RunOutcome | null> {
  const runId = randomUUID()
  const env: RunEnv = { origin: WRITE_ORIGIN[input.kind], runId, automationId: input.automationId, startedAt: new Date().toISOString() }
  const record = (tx: Tx, status: 'running' | 'failed', steps: readonly Step[]) =>
    tx.query<{ id: string }>(
      `INSERT INTO automation_run (id, automation_id, workspace_id, trigger_page_id, actor_id, origin, depth, status, idempotency_key, steps, finished_at)
       VALUES ($1, $2, $3, $4, $5, $9, $10, $6, $7, $8::jsonb, CASE WHEN $6::text = 'failed' THEN now() END)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [
        runId,
        input.automationId,
        ctx.workspaceId,
        input.context.triggerPageId,
        ctx.userId,
        status,
        input.idempotencyKey,
        JSON.stringify(steps),
        RUN_ORIGIN[input.kind],
        RUN_DEPTH[input.kind],
      ],
    )

  try {
    return await withTransaction(async (tx) => {
      // ① 멱등 — 같은 키가 커밋돼 있으면(또는 커밋을 기다린 뒤) 넣지 못한다
      if ((await record(tx, 'running', [])).length === 0) return duplicateOf(tx, ctx.workspaceId, input.automationId, input.idempotencyKey)

      const steps: Step[] = []
      for (const [index, action] of input.actions.entries()) {
        try {
          const done = await tx.savepoint('automation_step', () => execute(tx, ctx, action, input.context, env))
          steps.push({
            index,
            type: action.type,
            status: 'done',
            ...(done.pageId === undefined ? {} : { pageId: done.pageId }),
            ...(done.deliveryId === undefined ? {} : { deliveryId: done.deliveryId }),
          })
        } catch (e) {
          if (e instanceof StepSkipped) {
            steps.push({ index, type: action.type, status: 'skipped', reason: e.reason })
            continue
          }
          if (e instanceof StepFailed) {
            steps.push({ index, type: action.type, status: 'failed', reason: e.reason })
            throw new RunFailed(steps)
          }
          throw e
        }
      }
      const status: RunStatus = steps.some((s) => s.status === 'skipped') ? 'partial' : 'success'
      await tx.query(`UPDATE automation_run SET status = $2, steps = $3::jsonb, finished_at = now() WHERE id = $1`, [
        runId,
        status,
        JSON.stringify(steps),
      ])
      return { runId, status, steps, duplicate: false }
    })
  } catch (e) {
    if (!(e instanceof RunFailed)) throw e
    // ④ 전부 되돌렸다 — 실패 기록만 따로 남긴다(같은 키가 그 사이에 들어왔으면 남기지 않는다)
    await withTransaction((tx) => record(tx, 'failed', e.steps))
    return { runId, status: 'failed', steps: e.steps, duplicate: false }
  }
}

async function duplicateOf(tx: Tx, workspaceId: string, automationId: string, key: string): Promise<RunOutcome | null> {
  const run = await tx.queryMaybe<{ id: string; automation_id: string | null; status: string; steps: Step[] }>(
    `SELECT id, automation_id, status, steps FROM automation_run WHERE workspace_id = $1 AND idempotency_key = $2`,
    [workspaceId, key],
  )
  if (run === null || run.automation_id !== automationId) return null
  const status: RunStatus = run.status === 'partial' || run.status === 'failed' ? run.status : 'success'
  return { runId: run.id, status, steps: run.steps, duplicate: true }
}
