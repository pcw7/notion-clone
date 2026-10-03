/**
 * 이미지 아이콘의 파일 참조 — 잔여 묶음 8c-4 (F-02-05 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 페이지 아이콘 ⑤ · §3.10 `file.ref_count`(불변식 FS1 — `ref_count > 0` 은 지우지 않는다)
 *
 * 올린 파일을 아이콘으로 쓰면(`{type:'file', file_id}`) 그 아이콘은 이미지 블록과 똑같이 **그 파일의 참조**다. 세지 않으면 아이콘만
 * 가리키는 파일은 `ref_count = 0` 으로 남아 GC(§7 — 아직 없다)가 바이트를 지우고, 사이드바의 아이콘이 깨진다.
 *
 * 이미지 블록의 참조는 본문 프로젝터가 센다(`save-page-body.ts` — 자식 페이지 행은 빼고). 아이콘은 블록의 `properties` 가 아니라 페이지
 * 행의 `format` · `database.icon` 에 있으므로 **그것을 쓰는 명령이 센다** — 바꾸는 명령(`setPageIcon` · `setDatabaseIcon`)과 복제
 * (`duplicate.ts` — 템플릿으로 만든 행도 이 길이다). 셋 다 **같은 트랜잭션에서** — 아이콘을 쓰고 카운트를 나중에 올리면 그 사이에
 * GC 가 도는 순간 방금 단 아이콘의 바이트가 사라진다(프로젝터와 같은 까닭 · §3.3-24).
 *
 * 내릴 때는 `GREATEST(…, 0)` 로 바닥을 둔다 — 장부가 어긋나도 **덜 지우는 쪽**으로 기운다(프로젝터와 같은 규칙). 휴지통 · 영구
 * 삭제는 내리지 않는다 — 이미지 블록과 같다(물리 삭제는 `purged_at` 이후 GC 의 몫).
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { iconFileId, type PageIcon } from '../block/page-icon.ts'
import { ALLOWED_IMAGE_MIME } from './limits.ts'

/**
 * 아이콘으로 쓸 수 있는 파일인가 — **이 워크스페이스의 이미지**여야 한다. 다른 워크스페이스의 파일 · 없는 id 는 쓸 수 없다(보이지도
 * 않는다 — 파일 경로가 워크스페이스로 한정된다). 지금 받는 형식은 전부 이미지지만 파일 표는 형식을 가리지 않으므로 함께 묻는다.
 */
export async function isIconFile(tx: Tx, ctx: SessionContext, fileId: string): Promise<boolean> {
  const row = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM file WHERE id = $1 AND workspace_id = $2 AND mime = ANY($3::text[])`,
    [fileId, ctx.workspaceId, [...ALLOWED_IMAGE_MIME]],
  )
  return row !== null
}

/** 아이콘이 `before` 에서 `after` 로 바뀔 때 파일 참조를 옮긴다 — 같은 파일이면 아무것도 하지 않는다. */
export async function moveIconFileReference(
  tx: Tx,
  ctx: SessionContext,
  before: PageIcon | null,
  after: PageIcon | null,
): Promise<void> {
  const from = iconFileId(before)
  const to = iconFileId(after)
  if (from === to) return
  if (from !== null) await adjust(tx, ctx, from, -1)
  if (to !== null) await adjust(tx, ctx, to, 1)
}

/** 아이콘을 하나 더 만들었다(복제) — 그 파일의 참조를 하나 올린다. 파일 아이콘이 아니면 아무것도 하지 않는다. */
export async function addIconFileReference(tx: Tx, ctx: SessionContext, icon: PageIcon | null): Promise<void> {
  const fileId = iconFileId(icon)
  if (fileId !== null) await adjust(tx, ctx, fileId, 1)
}

async function adjust(tx: Tx, ctx: SessionContext, fileId: string, delta: number): Promise<void> {
  // 워크스페이스로 한정한다 — 다른 워크스페이스의 id 를 적어 넣어도 그 카운터는 움직이지 않는다(프로젝터와 같다).
  await tx.query(`UPDATE file SET ref_count = GREATEST(ref_count + $3, 0) WHERE id = $1 AND workspace_id = $2`, [
    fileId,
    ctx.workspaceId,
    delta,
  ])
}
