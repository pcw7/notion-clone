/**
 * 페이지 버전 기록 — 언제 남기고 무엇을 담는가 (잔여 묶음 8d-1 · F-11-01 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.7 `page_version` · [보강] 버전 기록 ①~④ · 불변식 S5
 *       11-history-notifications.md F-11-01 *"활발히 편집하는 동안 10분마다 1개, 그리고 마지막 편집 후 2분 뒤에 1개"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 타이머가 아니라 그 페이지를 쓰는 순간에 판정한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 쓰기는 모두 본문 세션(`collab/doc-store.ts` `openBodyDoc` — 그 페이지의 스냅샷 행을 잠근다)을 지난다. 세션을 여는 순간, 이번 변경을
 * 적용하기 **전에** 이 함수가 "아직 버전이 담지 않은 편집이 있고, 남길 때가 되었는가"를 묻는다:
 *
 *   · 쉼(`idle`)     — 마지막 update 에서 `VERSION_IDLE` 이 지났다(그 편집 세션이 끝났다)
 *   · 주기(`interval`) — 버전이 담지 않은 첫 update 에서 `VERSION_INTERVAL` 이 지났다(쉬지 않고 고치는 중)
 *
 * 기록 목록을 열 때도 같은 판정을 한다(`version.ts`) — 마지막 편집 뒤에 아무도 쓰지 않아도 끝난 세션이 목록에 선다. 쓰기가 두
 * 프로세스(협업 서버 · 앱)에서 오지만 판정이 그 페이지의 잠금 안이라 버전이 둘 생길 수 없고(한 위치에 하나 — 0040), 시각은 DB 의
 * `now()` 하나로 잰다. 대가: 쉼 버전은 2분이 지난 **뒤의 첫 쓰기 · 목록 열기**에 만들어진다(내용은 마지막 편집 때의 것 · `created_at`
 * 도 그 시각이다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 옮기기(seq 1)만 있는 상태는 버전이 아니다 — 비어 있지 않으면 첫 쓰기 때 남긴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 새 페이지는 빈 본문으로 옮겨진다(seq 1 · `import`) — 그것을 버전으로 치면 고친 적 없는 페이지에 빈 버전이 선다(F-11-01 *"편집이 없으면
 * 스냅샷도 생기지 않는다"*). 그러나 Phase 0 의 행에서 옮긴 페이지는 옮긴 상태가 곧 그때까지의 내용이다 — 처음 고친 사람이 다 지워도
 * 되돌릴 수 있게 **첫 쓰기 때 그 상태를 남긴다**(쓰기 전에 · 이유값 `idle` — 쉬던 상태다). 목록 열기는 남기지 않는다(편집이 아니다).
 *
 * ⚠ 버전의 바이트는 파일 저장소에 쓴다 — 트랜잭션이 되돌려지면 아무도 가리키지 않는 객체가 남는다(올린 파일과 같은 처지 · GC 의 몫 · §7).
 */

import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'

import type { Tx } from '../db/tx.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import { countFileReferences } from '../block/image.ts'
import type { EditorBlock } from '../editor/document.ts'
import { fileStorage } from '../file/storage.ts'
import { versionRetentionDays } from './retention.ts'

/** 마지막 편집 뒤 이만큼 쉬면 그 세션의 버전을 남긴다(F-11-01 *"마지막 편집 후 2분 뒤에 1개"*). Postgres interval. */
export const VERSION_IDLE = '2 minutes'
/** 쉬지 않고 고치면 이만큼마다 남긴다(F-11-01 *"10분마다 1개"*). */
export const VERSION_INTERVAL = '10 minutes'

/** 판정을 부르는 자리 — 쓰기 세션이면 옮긴 내용도 남긴다(머리말). */
export type VersionIntent = 'write' | 'list'

export type RecordedVersion = { readonly id: string; readonly reason: 'idle' | 'interval'; readonly throughSeq: string }

/** 버전의 바이트를 둘 저장소 키 — 워크스페이스 · 페이지 아래(올린 파일과 같은 저장소의 다른 가지). */
export function versionStorageKey(workspaceId: string, pageId: string, versionId: string): string {
  return `versions/${workspaceId}/${pageId}/${versionId}.yjs`
}

type DueRow = {
  last_at: Date
  last_origin: string
  through_seq: string | null
  idle: boolean
  interval: boolean
}

/**
 * 남길 때가 되었으면 지금 상태(`ydoc` — 그 페이지를 잠근 뒤 읽은 `seq` 까지의 본문)를 버전으로 남긴다. 호출자가 그 페이지의 스냅샷 행을
 * 잠갔다. 남겼으면 그 버전, 아니면 null.
 */
export async function recordVersionIfDue(
  tx: Tx,
  input: { readonly workspaceId: string; readonly pageId: string; readonly ydoc: Y.Doc; readonly seq: string; readonly intent: VersionIntent },
): Promise<RecordedVersion | null> {
  const { pageId, seq } = input
  const due = await tx.queryMaybe<DueRow>(
    `SELECT last.created_at AS last_at, last.origin AS last_origin, v.through_seq,
            (now() - last.created_at) >= $3::interval AS idle,
            coalesce((now() - first.created_at) >= $4::interval, false) AS interval
       FROM doc_update last
       LEFT JOIN LATERAL (
         SELECT through_seq FROM page_version WHERE page_id = $1 ORDER BY through_seq DESC LIMIT 1
       ) v ON true
       LEFT JOIN LATERAL (
         SELECT created_at FROM doc_update WHERE page_id = $1 AND seq = coalesce(v.through_seq, 0) + 1
       ) first ON true
      WHERE last.page_id = $1 AND last.seq = $2`,
    [pageId, seq, VERSION_IDLE, VERSION_INTERVAL],
  )
  if (due === null) return null
  if (due.through_seq !== null && BigInt(due.through_seq) >= BigInt(seq)) return null

  let reason: 'idle' | 'interval' | null
  if (due.through_seq === null && seq === '1') {
    // 옮기기만 있다 — 쓰기 세션이고 옮긴 내용이 비어 있지 않을 때만(머리말).
    reason = input.intent === 'write' && due.last_origin === 'import' && !isEmpty(input.ydoc, pageId) ? 'idle' : null
  } else {
    reason = due.idle ? 'idle' : due.interval ? 'interval' : null
  }
  if (reason === null) return null

  const id = randomUUID()
  const bytes = Y.encodeStateAsUpdate(input.ydoc)
  const stateRef = versionStorageKey(input.workspaceId, pageId, id)
  await fileStorage().put(stateRef, bytes)

  const workspace = await tx.queryOne<{ plan_code: string }>(`SELECT plan_code FROM workspace WHERE id = $1`, [input.workspaceId])
  const days = versionRetentionDays(workspace.plan_code)
  // 앞 버전 뒤부터 여기까지 고친 사람 — 시스템 · 옮기기(actor 없음)는 빠진다.
  const editors = await tx.query<{ actor_id: string }>(
    `SELECT DISTINCT actor_id FROM doc_update
      WHERE page_id = $1 AND seq > $2 AND seq <= $3 AND actor_id IS NOT NULL`,
    [pageId, due.through_seq ?? '0', seq],
  )
  await tx.query(
    `INSERT INTO page_version (id, page_id, state_ref, state_vector, byte_size, editor_ids, reason, through_seq, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8, $9::timestamptz,
             CASE WHEN $10::int IS NULL THEN 'infinity'::timestamptz ELSE $9::timestamptz + make_interval(days => $10::int) END)`,
    [
      id,
      pageId,
      stateRef,
      Buffer.from(Y.encodeStateVector(input.ydoc)),
      bytes.byteLength,
      editors.map((e) => e.actor_id).sort(),
      reason,
      seq,
      due.last_at,
      days,
    ],
  )

  // S5 — 버전이 담은 이미지 블록의 파일은 그 버전의 참조다(옛 버전으로 되돌릴 때 첨부가 깨지지 않게). 버전을 지우는 GC 가 아직 없어
  // 내리지 않는다.
  const blocks: { properties?: Readonly<Record<string, unknown>> }[] = []
  const walk = (list: readonly EditorBlock[]): void => {
    for (const block of list) {
      blocks.push(block)
      if (block.children !== undefined) walk(block.children)
    }
  }
  walk(readBodyYDoc(input.ydoc, pageId).doc.blocks)
  for (const [fileId, count] of countFileReferences(blocks)) {
    await tx.query(`UPDATE file SET ref_count = ref_count + $3 WHERE id = $1 AND workspace_id = $2`, [fileId, input.workspaceId, count])
  }

  return { id, reason, throughSeq: seq }
}

function isEmpty(ydoc: Y.Doc, pageId: string): boolean {
  return readBodyYDoc(ydoc, pageId).doc.blocks.length === 0
}
