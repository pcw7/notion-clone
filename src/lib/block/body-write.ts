/**
 * 서버 명령이 페이지 본문을 바꾸는 한 단위 — 서버 명령 경로 ②(판결 V-5) · F-05-01 · CRDT 4b조각
 *
 * 정본: 판결 X-1(본문 순서의 정본은 Y.Doc, `order_key` 는 프로젝터가 쓰는 파생) · X-3 · V-5(명령 1건 = 원자성 단위)
 *
 * 본문의 정본은 페이지의 Y.Doc 이고 `block` 행은 그 투영이다. 그래서 본문 행을 바꾸는 명령 — 본문 저장 · 하위 페이지
 * 생성 · 휴지통 · 복원 · 이동 — 은 모두 이 순서를 한 DB 트랜잭션 안에서 따른다.
 *
 *   ① (호출자) 본문을 가진 페이지 행을 `FOR UPDATE` 로 잡는다 — 잠금 순서는 **페이지 행 → 스냅샷** 한 방향이다
 *   ② `openPageBody` — 스냅샷을 잠그고, 처음이면 행에서 옮기고, 본문을 연다
 *   ③ (호출자) 행을 쓴다(하위 페이지 행 넣기 · lifecycle · 경로)
 *   ④ `change` — 참조 노드를 넣고 빼는 ProseMirror 변경(`page-refs.ts`)
 *   ⑤ `finish` — 바뀐 본문을 행으로 **투영하고**, 받아들여지면 로그에 **쌓는다**
 *
 * ②를 ③보다 먼저 한다. 처음 여는 세션은 그 순간의 행으로 본문을 옮기므로(`doc-store.db.test.ts` ⑦), 행을 먼저 쓰면 옮기기가
 * 그 결과(새 하위 페이지 · 되살린 페이지의 참조)를 이미 담는다. 그래도 **참조가 둘이 되지는 않는다** — ④의 넣기가 이미 있는
 * 참조를 넣지 않는다(`page-refs.ts`). 하위 페이지 생성의 순서를 뒤집는 반사실에서 검사가 전부 통과했다 — 둘이 되는 것을 막는
 * 것은 이 순서가 아니라 넣기의 멱등성이다. 순서는 "명령이 자기가 바꾼 것을 자기가 쓴다"를 지키려고 둔다.
 *
 * ⑤에서 투영이 먼저인 이유: 투영이 거부하면(자식 페이지 누락 · 깊이 초과) 로그에 아무것도 쌓지 않아야 한다. 프로젝터는
 * 거부를 savepoint 로 되돌리므로 행도 그대로다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { EditorChange } from '../collab/body-edit.ts'
import { openBodyDoc, type DocOrigin } from '../collab/doc-store.ts'
import type { Tx } from '../db/tx.ts'
import type { EditorDoc } from '../editor/document.ts'
import { projectBodyRows, type ProjectablePage, type ProjectBodyResult } from './save-page-body.ts'

export type PageBodyWrite = {
  readonly pageId: string
  /** 지금 본문(이 단위의 변경까지). */
  read(): EditorDoc
  change(change: EditorChange): void
  /** 바뀐 본문을 행으로 투영하고, 받아들여지면 로그에 쌓는다. 거부면 아무것도 쌓지 않고 거부를 돌려준다. */
  finish(): Promise<ProjectBodyResult>
}

/**
 * 페이지 본문을 연다(②). 호출자가 이 페이지 행을 이미 `FOR UPDATE` 로 잡았다.
 *
 * @param origin 로그에 남길 쓰기의 출처. 에디터가 보낸 본문 저장은 `'editor'`, 그 밖의 명령은 `'api'`(정본 V-5 의 경로 ②).
 */
export async function openPageBody(
  tx: Tx,
  ctx: SessionContext,
  pageId: string,
  origin: DocOrigin = 'api',
): Promise<PageBodyWrite> {
  const session = await openBodyDoc(tx, ctx, pageId)
  return {
    pageId,
    read: () => session.read().doc,
    change: (change) => session.change(change),
    async finish() {
      // ③의 행 쓰기가 페이지 행을 바꿨을 수 있다(경로 · 버전) — 잠근 행을 다시 읽는다.
      const page = await tx.queryOne<ProjectablePage>(
        `SELECT id, ancestor_path, perm_scope_id, version, properties
           FROM block WHERE id = $1 AND workspace_id = $2`,
        [pageId, ctx.workspaceId],
      )
      const result = await projectBodyRows(tx, ctx, page, session.read().doc)
      if (result.ok) await session.commit({ actorId: ctx.userId, origin })
      return result
    },
  }
}

/**
 * 거부를 기대하지 않는 명령의 ⑤. 거부면 던진다 — 트랜잭션이 통째로 되돌아간다.
 *
 * 하위 페이지 생성 · 휴지통 · 복원 · 이동은 참조 노드 하나만 넣고 뺀다. 그 결과가 투영에서 거부된다면 행과 Y.Doc 이 이미
 * 어긋나 있었다는 뜻이라, 조용히 넘기지 않는다.
 */
export async function finishOrThrow(write: PageBodyWrite): Promise<Extract<ProjectBodyResult, { ok: true }>> {
  const result = await write.finish()
  if (!result.ok) throw new Error(`본문 투영이 명령을 거부했다(${result.reason}): ${write.pageId}`)
  return result
}

/**
 * `parentId` 의 자식이 사는 본문을 가진 페이지 — 부모가 페이지면 그 페이지, 본문 블록(토글 같은 컨테이너)이면 가장
 * 가까운 페이지 조상. 어느 페이지 본문에도 속하지 않으면(워크스페이스 직속 데이터베이스 같은 것) null.
 */
export async function ownerPageOf(tx: Tx, ctx: SessionContext, parentId: string): Promise<string | null> {
  const parent = await tx.queryMaybe<{ id: string; type: string; ancestor_path: string[] }>(
    `SELECT id, type, ancestor_path FROM block WHERE id = $1 AND workspace_id = $2`,
    [parentId, ctx.workspaceId],
  )
  if (parent === null) return null
  if (parent.type === 'page') return parent.id
  if (parent.ancestor_path.length === 0) return null
  const pages = await tx.query<{ id: string }>(
    `SELECT id FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page'`,
    [parent.ancestor_path, ctx.workspaceId],
  )
  const pageIds = new Set(pages.map((p) => p.id))
  for (let i = parent.ancestor_path.length - 1; i >= 0; i -= 1) {
    if (pageIds.has(parent.ancestor_path[i])) return parent.ancestor_path[i]
  }
  return null
}
