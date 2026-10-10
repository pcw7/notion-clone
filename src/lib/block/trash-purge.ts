/**
 * 휴지통 자동 비우기 — 만료된 휴지통 묶음을 `purged` 로 (히스토리 · 활동 4b-1 · F-11-06)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 휴지통 자동 비우기 · 상태 전이표의 GC 행(`trashed` → `purged`) ·
 *       §3.10 [보강] 공용 스케줄러(두 번째 소비자)
 *       11-history-notifications.md F-11-06 *"휴지통 보관 기간이 끝나거나 … 영구 삭제하면 콘텐츠를 접근 불가 상태로 만든다"*
 *
 * 공용 스케줄러가 부른다(`trash_purge` — 세션 없는 시스템 주체). 한 판에 `TRASH_PURGE_BATCH` 묶음:
 *
 *   · 묶음 — 삭제 루트 하나와 `trash_root_id` 가 그 루트인 페이지들. 루트가 data source 면 그 소스까지(소스를 버리면 그 행 · 템플릿이
 *     소스 id 를 루트로 함께 들어간다 — 0043). 따로 먼저 버린 자손 · 행은 제 루트를 가지므로 제 시각에 따로 비워진다(B3)
 *   · 한 묶음씩 한 트랜잭션 — **루트 행을 먼저 잠근다**(`SKIP LOCKED`). 되살리기(`restorePage` · `restoreDataSource`) · 손으로 하는
 *     영구 삭제도 루트를 잠근다 — 그쪽이 쥐고 있으면 이 판은 그 묶음을 **건너뛴다**(다음 판에 다시 본다 · 워커가 사람의 명령을 기다리지
 *     않는다). 잠그지 않고 묶음을 한 문장으로 바꾸면 자손을 쥔 채 루트를 기다리다 되살리기(루트를 쥔 채 자손을 바꾼다)와 교착한다.
 *     잠근 뒤 `purge_after` 가 지난 `trashed` 만 바꾼다 — 그사이 되살아났거나 손으로 영구 삭제됐으면 바꿀 것이 없다(두 번 돌아도
 *     같다 — 스케줄러의 멱등 규칙)
 *   · 쓰기는 수동 영구 삭제(`purgePage` · `purgeDataSource`)와 같다 — `purged_at` 은 실행기의 `now`. 검색 색인은 트리거가 내린다(0012)
 *   · **`file.ref_count` 는 내리지 않는다**(정본 [보강] ③) — `purged` 는 30일 동안 지원 경로로 되살릴 수 있어야 하고, 참조는 그것을 쥔
 *     행이 사라질 때(물리 삭제) 내린다
 */

import { withTransaction } from '../db/tx.ts'
import { query } from '../db/pool.ts'

/** 한 판에 비우는 묶음 수 — 꽉 차면 스케줄러가 곧 다시 부른다. */
export const TRASH_PURGE_BATCH = 100

export type TrashPurgeResult = {
  /** 무엇이라도 바꾼 묶음 수. */
  readonly units: number
  /** 루트를 다른 쪽(되살리기 · 영구 삭제)이 쥐고 있어 건너뛴 묶음 수 — 다음 판에 다시 본다. */
  readonly skipped: number
  /** `purged` 가 된 페이지(행 · 템플릿 포함) 수. */
  readonly pages: number
  /** `purged` 가 된 data source 수. */
  readonly sources: number
  /** 한 판이 꽉 찼다 — 더 남았을 수 있다. */
  readonly more: boolean
}

/**
 * @param options.batch 한 판에 비우는 묶음 수
 * @param options.workspaces 이 워크스페이스들만 — 검사가 다른 검사의 휴지통을 건드리지 않게(워커는 주지 않는다)
 */
export async function runTrashPurge(
  now: Date,
  options: { readonly batch?: number; readonly workspaces?: readonly string[] } = {},
): Promise<TrashPurgeResult> {
  const batch = options.batch ?? TRASH_PURGE_BATCH
  // 만료된 휴지통의 루트들 — 블록의 루트 id 와 소스 id 가 같은 묶음이면 하나로 모인다. 오래된 것부터
  const roots = await query<{ root: string }>(
    `SELECT root
       FROM (
         SELECT b.trash_root_id AS root, b.purge_after
           FROM block b
          WHERE b.lifecycle = 'trashed' AND b.purge_after <= $1
            AND ($3::uuid[] IS NULL OR b.workspace_id = ANY($3::uuid[]))
         UNION ALL
         SELECT ds.id, ds.purge_after
           FROM data_source ds JOIN block d ON d.id = ds.owner_database_id   -- 데이터베이스는 블록의 1:1 확장이다(X-2)
          WHERE ds.lifecycle = 'trashed' AND ds.purge_after <= $1
            AND ($3::uuid[] IS NULL OR d.workspace_id = ANY($3::uuid[]))
       ) due
      GROUP BY root
      ORDER BY min(purge_after), root
      LIMIT $2`,
    [now, batch, options.workspaces ?? null],
  )

  let units = 0
  let skipped = 0
  let pages = 0
  let sources = 0
  for (const { root } of roots) {
    const swept = await withTransaction(async (tx) => {
      // 루트를 먼저 잠근다 — 소스면 소스 행, 아니면 루트 페이지 행. 쥔 쪽이 있으면 건너뛴다(머리말)
      const { isSource } = await tx.queryOne<{ isSource: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM data_source WHERE id = $1) AS "isSource"`,
        [root],
      )
      const source = isSource
        ? await tx.queryMaybe<{ due: boolean }>(
            `SELECT lifecycle = 'trashed' AND purge_after <= $2 AS due FROM data_source WHERE id = $1 FOR UPDATE SKIP LOCKED`,
            [root, now],
          )
        : null
      const locked = isSource
        ? source !== null
        : (await tx.queryMaybe<{ id: string }>(`SELECT id FROM block WHERE id = $1 FOR UPDATE SKIP LOCKED`, [root])) !== null
      if (!locked) return null
      const purged = await tx.query<{ id: string }>(
        `UPDATE block SET lifecycle = 'purged', purged_at = $2
          WHERE trash_root_id = $1 AND lifecycle = 'trashed' AND purge_after <= $2
          RETURNING id`,
        [root, now],
      )
      if (source?.due === true) {
        await tx.query(`UPDATE data_source SET lifecycle = 'purged', purged_at = $2, updated_at = $2 WHERE id = $1`, [root, now])
      }
      return { pages: purged.length, sources: source?.due === true ? 1 : 0 }
    })
    if (swept === null) {
      skipped += 1
      continue
    }
    if (swept.pages + swept.sources > 0) units += 1
    pages += swept.pages
    sources += swept.sources
  }
  return { units, skipped, pages, sources, more: roots.length === batch }
}
