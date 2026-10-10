/**
 * 자동화 엔진 — 액션을 순서대로, 한 트랜잭션에서, 실행 기록 하나로 (자동화 5a-1 · F-08-07 · F-08-10)
 *
 * 정본: 00-canonical-data-model.md §3.10 불변식 AU1 · [보강] 자동화 엔진 · 버튼 속성 ③ ④ ⑤ ⑦
 *
 *   ① 멱등 — 실행 기록을 멱등 키로 먼저 넣는다(`UNIQUE (workspace_id, idempotency_key)`). 같은 키가 이미 있으면 실행하지 않고 그 기록을
 *     돌려준다(연타 · 다시 보내기). 다른 automation 의 키면 null — 부르는 쪽이 거절한다.
 *   ② 한 트랜잭션(AU1) — 액션을 순서대로 같은 트랜잭션에서 실행한다. 액션마다 세이브포인트를 둔다.
 *   ③ 건너뛰기 — 대상을 고칠 권한이 없거나(`forbidden` · 볼 수 없으면 `not_found`) 잠겼으면(`locked`) 그 액션만 되돌리고 건너뛴다.
 *     실행은 `partial`(08 *"접근이 제한된 페이지에는 영향을 주지 않는다 — 스킵 + 로그"*).
 *   ④ 실패 — 그 밖의 거절(값이 틀렸다 · 속성이 사라졌다)은 **전부 되돌리고** 실패 기록만 따로 남긴다(반쪽 실행이 남지 않게).
 *   ⑤ 액션은 **실행하는 사람의 권한으로** 다시 판정된다 — 각 액션이 부르는 명령(`updateCellsIn` …)이 그 사람의 `SessionContext` 로 묻는다.
 *   ⑥ 기록에는 id 와 까닭만 — 대상의 내용을 담지 않는다(레벨이 전순서가 아니다 · A2).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { createRowIn, isRowFailure, openDataSource, updateCellsIn } from '../database/row.ts'
import { createRowFromTemplateIn, readLiveTemplate } from '../database/template.ts'
import type { ActionInput, ActionType } from './actions.ts'

export type StepStatus = 'done' | 'skipped' | 'failed'
export type Step = {
  readonly index: number
  readonly type: ActionType
  readonly status: StepStatus
  readonly reason?: string
  /** `add_page_to` 가 만든 행 — 화면이 열어 준다(내용은 담지 않는다 · ⑥). */
  readonly pageId?: string
}
export type RunStatus = 'success' | 'partial' | 'failed'
export type RunOutcome = { readonly runId: string; readonly status: RunStatus; readonly steps: readonly Step[]; readonly duplicate: boolean }

/** 액션이 일하는 자리 — 버튼 속성이면 누른 행. */
export type RunContext = { readonly triggerPageId: string }

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

/** 액션의 결과 — 만든 행이 있으면 그 id. */
type Done = { readonly pageId?: string }

const rejected = (reason: string): never => {
  throw SKIPPABLE.has(reason) ? new StepSkipped(reason) : new StepFailed(reason)
}

async function execute(tx: Tx, ctx: SessionContext, action: ActionInput, context: RunContext): Promise<Done> {
  switch (action.type) {
    case 'edit_property': {
      const result = await updateCellsIn(tx, ctx, context.triggerPageId, { cells: action.config.cells, filledBy: 'automation' })
      return result.ok ? {} : rejected(result.reason)
    }
    case 'add_page_to': {
      // 그 표에 행을 만들 수 있는가 — 누른 사람의 권한으로(없으면 건너뛴다 · 정본 ⑨). 템플릿을 확인하기 전에 묻는다 — 볼 수 없는 표의
      // 템플릿이 있는지 없는지를 실패 까닭으로 알려주지 않게.
      const { dataSourceId, cells, templateId } = action.config
      const gate = await openDataSource(tx, ctx, dataSourceId, 'create_child')
      if (isRowFailure(gate)) return rejected(gate.ok ? 'not_found' : gate.reason)
      if (templateId === null) {
        const made = await createRowIn(tx, ctx, dataSourceId, { cells, filledBy: 'automation' })
        return made.ok ? { pageId: made.value.id } : rejected(made.reason)
      }
      // 템플릿이 사라졌으면 정의가 깨진 것이다 — 실패(④)
      if ((await readLiveTemplate(tx, ctx, dataSourceId, templateId)) === null) throw new StepFailed('unknown_template')
      const made = await createRowFromTemplateIn(tx, ctx, dataSourceId, templateId, { cells, precedence: 'template', filledBy: 'automation' })
      return made.ok ? { pageId: made.value.row.id } : rejected(made.reason)
    }
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
    readonly actions: readonly ActionInput[]
  },
): Promise<RunOutcome | null> {
  const runId = randomUUID()
  const record = (tx: Tx, status: 'running' | 'failed', steps: readonly Step[]) =>
    tx.query<{ id: string }>(
      `INSERT INTO automation_run (id, automation_id, workspace_id, trigger_page_id, actor_id, origin, depth, status, idempotency_key, steps, finished_at)
       VALUES ($1, $2, $3, $4, $5, 'user', 0, $6, $7, $8::jsonb, CASE WHEN $6::text = 'failed' THEN now() END)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [runId, input.automationId, ctx.workspaceId, input.context.triggerPageId, ctx.userId, status, input.idempotencyKey, JSON.stringify(steps)],
    )

  try {
    return await withTransaction(async (tx) => {
      // ① 멱등 — 같은 키가 커밋돼 있으면(또는 커밋을 기다린 뒤) 넣지 못한다
      if ((await record(tx, 'running', [])).length === 0) return duplicateOf(tx, ctx.workspaceId, input.automationId, input.idempotencyKey)

      const steps: Step[] = []
      for (const [index, action] of input.actions.entries()) {
        try {
          const done = await tx.savepoint('automation_step', () => execute(tx, ctx, action, input.context))
          steps.push({ index, type: action.type, status: 'done', ...(done.pageId === undefined ? {} : { pageId: done.pageId }) })
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
