/**
 * 버전 GC — 만료된 버전을 지운다 (히스토리 · 활동 4a-1 · F-11-03)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 공용 스케줄러(첫 소비자) · §3.7 [보강] 버전 기록 ④ · 0007 의 S5
 *       11-history-notifications.md F-11-03 *"만료된 버전을 자동 파기"* · *"최소 1개(가장 최근)는 보관 기간과 무관하게 유지"* ·
 *       *"삭제 대상 id 를 먼저 확정(SELECT)한 뒤 삭제"* · *"row 삭제와 blob 삭제를 분리"*
 *
 * 공용 스케줄러가 부른다(`version_gc` — 세션 없는 시스템 주체). 한 판에 `BATCH` 개:
 *
 *   · 지울 것 — `expires_at < now` 인 버전. 단 ⓐ 그 페이지의 **가장 최근 버전**(`through_seq` 가 가장 큰 것)은 남긴다 ⓑ 다른 버전이
 *     `restored_from` 으로 **가리키는 버전**은 남긴다 — 가리키는 쪽이 더 나중에 만료되므로 그것이 지워진 다음 판에 지워진다(FK 를 SET NULL
 *     로 바꾸면 `reason='restore' ⇔ restored_from` CHECK 와 부딪힌다)
 *   · 한 버전씩 — 바이트를 읽어 담은 파일 참조를 기록 때와 **같은 셈**(`versionFileReferences`)으로 세고, 한 트랜잭션에서 그 행을 다시
 *     잠가(그사이 다른 워커가 지웠으면 건너뛴다) 참조 수를 내리고 행을 지운다. 커밋한 **뒤에** 바이트를 저장소에서 지운다 — 실패하면 고아로
 *     남는다(저장소 고아 쓸기는 파일 GC 와 함께 — §7). 바이트가 이미 없으면 참조를 셀 수 없다 — 행은 지우고 그 사실을 남긴다
 *   · 같은 버전을 두 워커가 지워도 결과가 같다(행 잠금 + 없으면 건너뜀 — 스케줄러의 멱등 규칙)
 */

import * as Y from 'yjs'

import { withTransaction } from '../db/tx.ts'
import { query } from '../db/pool.ts'
import { fileStorage } from '../file/storage.ts'
import { versionFileReferences } from './record.ts'

/** 한 판에 지우는 수 — 꽉 차면 스케줄러가 곧 다시 부른다. */
export const VERSION_GC_BATCH = 200

export type VersionGcResult = {
  /** 지운 버전 수. */
  readonly deleted: number
  /** 한 판이 꽉 찼다 — 더 남았을 수 있다. */
  readonly more: boolean
  /** 바이트가 없어 참조를 내리지 못하고 지운 버전 수. */
  readonly missingBytes: number
}

/**
 * @param options.batch 한 판에 지우는 수
 * @param options.only 이 페이지들만 — 검사가 다른 검사의 버전을 건드리지 않게(워커는 주지 않는다)
 */
export async function runVersionGc(
  now: Date,
  options: { readonly batch?: number; readonly only?: readonly string[] } = {},
): Promise<VersionGcResult> {
  const batch = options.batch ?? VERSION_GC_BATCH
  const candidates = await query<{ id: string; page_id: string; state_ref: string }>(
    `SELECT v.id, v.page_id, v.state_ref
       FROM page_version v
      WHERE v.expires_at < $1
        AND ($3::uuid[] IS NULL OR v.page_id = ANY($3::uuid[]))
        -- ⓐ 그 페이지의 가장 최근 버전은 남긴다
        AND EXISTS (SELECT 1 FROM page_version newer WHERE newer.page_id = v.page_id AND newer.through_seq > v.through_seq)
        -- ⓑ 복원이 가리키는 버전은 남긴다
        AND NOT EXISTS (SELECT 1 FROM page_version r WHERE r.restored_from = v.id)
      ORDER BY v.expires_at, v.id
      LIMIT $2`,
    [now, batch, options.only ?? null],
  )

  let deleted = 0
  let missingBytes = 0
  for (const version of candidates) {
    const bytes = await fileStorage().read(version.state_ref)
    let references = new Map<string, number>()
    if (bytes !== null) {
      const ydoc = new Y.Doc()
      Y.applyUpdate(ydoc, bytes)
      references = versionFileReferences(ydoc, version.page_id)
    }
    const removed = await withTransaction(async (tx) => {
      // 다시 잠근다 — 그사이 다른 워커가 지웠거나 다른 버전이 가리키게 됐으면 건너뛴다
      const locked = await tx.queryMaybe<{ id: string }>(
        `SELECT id FROM page_version v WHERE v.id = $1
            AND NOT EXISTS (SELECT 1 FROM page_version r WHERE r.restored_from = v.id)
          FOR UPDATE SKIP LOCKED`,
        [version.id],
      )
      if (locked === null) return false
      for (const [fileId, count] of references) {
        await tx.query(`UPDATE file SET ref_count = GREATEST(ref_count - $2, 0) WHERE id = $1`, [fileId, count])
      }
      await tx.query(`DELETE FROM page_version WHERE id = $1`, [version.id])
      return true
    })
    if (!removed) continue
    deleted += 1
    if (bytes === null) {
      missingBytes += 1
      console.warn(`[version-gc] 바이트가 없어 파일 참조를 내리지 못하고 지웠다: ${version.id} (${version.state_ref})`)
    } else {
      // 커밋한 뒤에 — 실패하면 고아로 남는다(정본 [보강] · §7)
      await fileStorage()
        .remove(version.state_ref)
        .catch((e: unknown) => console.warn(`[version-gc] 바이트를 지우지 못했다(고아): ${version.state_ref} — ${String(e)}`))
    }
  }
  return { deleted, more: candidates.length === batch, missingBytes }
}
