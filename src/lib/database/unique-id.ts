/**
 * 고유 ID 의 번호 발급 — DB 심화 2a-1조각 (F-03-09)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 고유 ID ② ③ ⑤
 *
 * ──────────────────────────────────────────────────────────────────────
 * 번호는 카운터에서만 나온다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `UPDATE data_source SET unique_id_counter = … RETURNING` 이 유일한 발급 길이다(0013 의 주석 · 03 *"애플리케이션 레벨
 * `MAX(seq)+1` 은 동시성에서 반드시 깨진다"*). 카운터는 내려가지 않는다 — 행이 휴지통에 가도 · 영구 삭제돼도 번호를 돌려받지
 * 않는다(구멍이 남는다 · 정본 ⑤).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 행을 만드는 쪽과 ID 프로퍼티를 더하는 쪽이 엇갈려도 빠지는 번호가 없다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 행 생성은 ID 프로퍼티가 있는지를 **행을 넣은 뒤의 문장 안에서** 묻는다(`issueUniqueSeq`). `INSERT INTO page` 의 FK 검사가
 * data source 줄에 `FOR KEY SHARE` 를 잡고, ID 프로퍼티를 더하는 명령은 `lockSchema` 로 같은 줄을 `FOR UPDATE` 로 잡는다 —
 * 둘은 충돌하므로 한쪽이 커밋한 뒤에 다른 쪽이 진행한다:
 *
 *   더하기가 먼저   행의 FK 검사가 그 커밋을 기다린다 → 다음 문장(READ COMMITTED 의 새 스냅숏)이 ID 프로퍼티를 본다 → 번호
 *   행이 먼저       더하기의 `FOR UPDATE` 가 행의 커밋을 기다린다 → 채우기(`fillUniqueIds`)가 그 행을 본다 → 번호
 *
 * 게이트(`openDataSource`)가 읽은 프로퍼티 목록으로 판단하면 안 된다 — 그 목록은 잠금 **전에** 읽은 것이라, 더하기가 사이에
 * 커밋하면 번호 없는 행이 남는다.
 */

import type { Tx } from '../db/tx.ts'

/**
 * 막 만든 행에 번호를 준다 — 이 표에 살아 있는 ID 프로퍼티가 있을 때만. 템플릿에는 부르지 않는다(불변식 U2).
 *
 * 반드시 `INSERT INTO page` **뒤에** 부른다(머리말의 잠금 순서).
 */
export async function issueUniqueSeq(tx: Tx, dataSourceId: string, rowId: string): Promise<void> {
  await tx.query(
    `WITH issued AS (
       UPDATE data_source SET unique_id_counter = unique_id_counter + 1
        WHERE id = $1
          AND EXISTS (SELECT 1 FROM property
                       WHERE data_source_id = $1 AND type = 'unique_id' AND deleted_at IS NULL)
        RETURNING unique_id_counter
     )
     UPDATE page SET unique_seq = issued.unique_id_counter
       FROM issued
      WHERE page.id = $2`,
    [dataSourceId, rowId],
  )
}

/**
 * 번호가 없는 행을 채운다 — ID 프로퍼티를 더하거나 되살릴 때(정본 ③). 채운 개수를 돌려준다.
 *
 * **만든 순서**(`block.created_at` — 한 트랜잭션에서 만든 행은 시각이 같으므로 그다음은 행 순서)대로, **휴지통의 행도**(03: *"assigned to every page, including deleted pages"*) 채운다.
 * 템플릿은 빼고(U2). 카운터는 그 개수만큼 **한 번에** 올린다(배치 예약 — 행마다 올리면 천 행에 천 문장이다).
 *
 * 호출자가 data source 를 `FOR UPDATE` 로 잠근 채 부른다(`lockSchema`) — 그래서 그 사이에 번호를 받는 행이 없다.
 */
export async function fillUniqueIds(tx: Tx, dataSourceId: string): Promise<number> {
  const filled = await tx.query<{ id: string }>(
    `WITH todo AS (
       SELECT p.id, row_number() OVER (ORDER BY b.created_at, b.order_key COLLATE "C", b.id) AS n
         FROM page p JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1 AND p.unique_seq IS NULL AND NOT p.is_template
     ),
     reserved AS (
       UPDATE data_source SET unique_id_counter = unique_id_counter + (SELECT count(*) FROM todo)
        WHERE id = $1
        RETURNING unique_id_counter - (SELECT count(*) FROM todo) AS base
     )
     UPDATE page SET unique_seq = reserved.base + todo.n
       FROM todo, reserved
      WHERE page.id = todo.id
      RETURNING page.id`,
    [dataSourceId],
  )
  return filled.length
}
