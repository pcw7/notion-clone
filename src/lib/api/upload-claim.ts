/**
 * 붙이기 전의 업로드 세션 검사 — API 로 올린 파일을 블록 · 속성 · 아이콘 · 커버에 붙일 때 (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪ · §3.10 `api_file_upload`
 *
 * 검사는 **세션 → 앱** 차례다. 여기는 앞의 것 — 받은 id 가운데 `api_file_upload` 의 것만 본다:
 *   · 붙은 적 있으면 묻지 않는다(그 뒤로는 보통의 워크스페이스 파일 · 노션도 같은 id 를 여러 곳에 붙인다)
 *   · 아니면 주인(토큰의 사람)이고 · `uploaded` 이고 · 만료 전이어야 한다 — 남의 것은 모르는 id 와 같은 글(있는지 새지 않는다)
 * 받으면 **같은 트랜잭션에서** 붙인 표시를 한다(`attached_at` · 만료를 비운다) — 뒤의 쓰기가 거부되면 함께 되돌린다(명령 트랜잭션).
 * 세션이 없는 id(앱에서 올린 파일 · 옛 `file_upload {id}`)는 그대로 지나 앱의 검사(이 워크스페이스의 파일인가 · 형식)가 본다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'

/** 붙이려는 파일 하나 — 오류 글의 자리(`body.children[0].image.file_upload.id`). */
export type UploadClaim = { readonly id: string; readonly path: string }

type SessionRow = { id: string; user_id: string; status: string; attached: boolean; expired: boolean }

/** 거부면 그 까닭(영어 · 노션의 말투 — 부르는 쪽이 `body failed validation: ` 을 붙인다) · 받으면 null(붙인 표시까지 했다). */
export async function claimApiUploadsIn(tx: Tx, ctx: SessionContext, claims: readonly UploadClaim[]): Promise<string | null> {
  if (claims.length === 0) return null
  const ids = [...new Set(claims.map((c) => c.id))]
  const rows = new Map(
    (
      await tx.query<SessionRow>(
        `SELECT id, user_id, status, attached_at IS NOT NULL AS attached,
                (attached_at IS NULL AND expires_at <= clock_timestamp()) AS expired
           FROM api_file_upload WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
        [ids, ctx.workspaceId],
      )
    ).map((r) => [r.id, r] as const),
  )
  const fresh: string[] = []
  for (const claim of claims) {
    const row = rows.get(claim.id)
    if (row === undefined || row.attached) continue
    if (row.user_id !== ctx.userId) return `${claim.path} should be a file uploaded to this workspace, instead was "${claim.id}".`
    if (row.expired) return `${claim.path}: the file upload "${claim.id}" has expired. Create a new file upload and send the file again.`
    if (row.status !== 'uploaded') return `${claim.path}: the file upload "${claim.id}" has not been sent yet (status "${row.status}"). Send the file first.`
    fresh.push(claim.id)
  }
  if (fresh.length > 0) {
    await tx.query(
      `UPDATE api_file_upload
          SET attached_at = clock_timestamp(), expires_at = NULL, last_edited_at = clock_timestamp()
        WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND attached_at IS NULL AND status = 'uploaded'`,
      [[...new Set(fresh)], ctx.workspaceId],
    )
  }
  return null
}
