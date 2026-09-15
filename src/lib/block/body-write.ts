/**
 * 페이지 본문을 바꾸는 한 단위 — 서버 명령 경로 ② · 참여자 경로 ①(판결 V-5) · F-05-01 · CRDT 4b조각 · 5a조각 · 5b조각
 *
 * 정본: 판결 X-1(본문 순서의 정본은 Y.Doc, `order_key` 는 프로젝터가 쓰는 파생) · X-3 · V-5(명령 1건 = 원자성 단위)
 *
 * 본문의 정본은 페이지의 Y.Doc 이고 `block` 행은 그 투영이다. 그래서 본문을 바꾸는 쓰기 — 본문 저장 · 하위 페이지
 * 생성 · 휴지통 · 복원 · 이동, 그리고 참여자가 보낸 update — 는 모두 이 순서를 한 DB 트랜잭션 안에서 따른다.
 *
 *   ① (호출자) 본문을 가진 페이지 행을 `FOR UPDATE` 로 잡는다 — 잠금 순서는 **페이지 행 → 스냅샷** 한 방향이다
 *   ② `openPageBody` — 스냅샷을 잠그고, 처음이면 행에서 옮기고, 본문을 연다
 *   ③ (호출자) 행을 쓴다(하위 페이지 행 넣기 · lifecycle · 경로)
 *   ④ `change` — 참조 노드를 넣고 빼는 ProseMirror 변경(`page-refs.ts`) · 또는 `applyUpdate` — 참여자가 보낸 update
 *   ⑤ `finish` — 바뀐 본문을 행으로 **투영하고**, 받아들여지면 로그에 **쌓는다**
 *
 * ②를 ③보다 먼저 한다. 처음 여는 세션은 그 순간의 행으로 본문을 옮기므로(`doc-store.db.test.ts` ⑦), 행을 먼저 쓰면 옮기기가
 * 그 결과(새 하위 페이지 · 되살린 페이지의 참조)를 이미 담는다. 그래도 **참조가 둘이 되지는 않는다** — ④의 넣기가 이미 있는
 * 참조를 넣지 않는다(`page-refs.ts`). 하위 페이지 생성의 순서를 뒤집는 반사실에서 검사가 전부 통과했다 — 둘이 되는 것을 막는
 * 것은 이 순서가 아니라 넣기의 멱등성이다. 순서는 "명령이 자기가 바꾼 것을 자기가 쓴다"를 지키려고 둔다.
 *
 * ⑤에서 투영이 먼저인 이유: 투영이 거부하면(자식 페이지 누락 · 깊이 초과 · 버릴 권한 없음) 로그에 아무것도 쌓지 않아야 한다.
 * 프로젝터는 거부를 savepoint 로 되돌리므로 행도 그대로다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { EditorChange } from '../collab/body-edit.ts'
import { MAX_DOC_UPDATE_BYTES, openBodyDoc, type BodyCommit, type DocOrigin } from '../collab/doc-store.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import type { EditorDoc } from '../editor/document.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import {
  projectBodyRows,
  type MissingPageRefs,
  type ProjectablePage,
  type ProjectBodyResult,
} from './save-page-body.ts'

/** 투영이 받아들이면 로그에 쌓은 결과(`commit`)까지, 거부하면 거부만. */
export type BodyWriteResult =
  | (Extract<ProjectBodyResult, { ok: true }> & { readonly commit: BodyCommit })
  | Exclude<ProjectBodyResult, { ok: true }>

export type FinishOptions = {
  /** 압축 기준. 없으면 `COMPACT_EVERY`. */
  readonly compactEvery?: number
  /** 본문에서 빠진 살아 있는 하위 페이지를 어떻게 하는가. 없으면 거부(`refuse`) — `save-page-body.ts` `MissingPageRefs`. */
  readonly missingPageRefs?: MissingPageRefs
}

export type PageBodyWrite = {
  readonly pageId: string
  /** 연 순간의 마지막 seq. */
  readonly seq: string
  /** 이 단위가 본문을 바꿨는가. */
  readonly changed: boolean
  /** 지금 본문(이 단위의 변경까지). */
  read(): EditorDoc
  change(change: EditorChange): void
  /** 참여자가 보낸 update 를 적용한다(`appendDocUpdate`). 실패를 돌려주면 이 단위는 끝낼 수 없다. */
  applyUpdate(update: Uint8Array): 'applied' | 'invalid_update' | 'missing_dependencies'
  /** 바뀐 본문을 행으로 투영하고, 받아들여지면 로그에 쌓는다. 거부면 아무것도 쌓지 않고 거부를 돌려준다. */
  finish(options?: FinishOptions): Promise<BodyWriteResult>
}

/**
 * 페이지 본문을 연다(②). 호출자가 이 페이지 행을 이미 `FOR UPDATE` 로 잡았다.
 *
 * @param origin 로그에 남길 쓰기의 출처. 에디터가 보낸 편집(본문 저장 · 참여자 update)은 `'editor'`, 그 밖의 명령은
 *   `'api'`(정본 V-5 의 경로 ②).
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
    seq: session.seq,
    get changed() {
      return session.changed
    },
    read: () => session.read().doc,
    change: (change) => session.change(change),
    applyUpdate: (update) => session.applyUpdate(update),
    async finish(options = {}) {
      // ③의 행 쓰기가 페이지 행을 바꿨을 수 있다(경로 · 버전) — 잠근 행을 다시 읽는다.
      const page = await tx.queryOne<ProjectablePage>(
        `SELECT id, ancestor_path, perm_scope_id, version, properties
           FROM block WHERE id = $1 AND workspace_id = $2`,
        [pageId, ctx.workspaceId],
      )
      const result = await projectBodyRows(tx, ctx, page, session.read().doc, {
        missingPageRefs: options.missingPageRefs,
      })
      if (!result.ok) return result
      const commit = await session.commit({ actorId: ctx.userId, origin, compactEvery: options.compactEvery })
      return { ...result, commit }
    },
  }
}

/**
 * 거부를 기대하지 않는 명령의 ⑤. 거부면 던진다 — 트랜잭션이 통째로 되돌아간다.
 *
 * 하위 페이지 생성 · 휴지통 · 복원 · 이동은 참조 노드 하나만 넣고 뺀다. 그 결과가 투영에서 거부된다면 행과 Y.Doc 이 이미
 * 어긋나 있었다는 뜻이라, 조용히 넘기지 않는다.
 */
export async function finishOrThrow(write: PageBodyWrite): Promise<Extract<BodyWriteResult, { ok: true }>> {
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

// ── 참여자 경로 ① ─────────────────────────────────────────────────────

export type AppendFailure =
  | 'not_found'
  /** 볼 수는 있지만 고칠 수 없다(`edit_content` 없음). */
  | 'forbidden'
  | 'too_large'
  /** Yjs update 로 읽히지 않는다. */
  | 'invalid_update'
  /** 앞선 update 가 없어 전부 적용되지 않는다. 보낸 쪽이 state vector 로 다시 맞춰야 한다. */
  | 'missing_dependencies'
  /** 투영이 받지 않는다 — 참조를 지운 살아 있는 하위 페이지를 버릴 권한이 없다(§3.2-18). */
  | 'page_ref_forbidden'
  /** 투영이 받지 않는다 — 자리를 옮긴 하위 페이지의 서브트리가 깊이 상한을 넘는다. */
  | 'page_ref_too_deep'

export type AppendDocResult =
  | {
      readonly ok: true
      /** 쌓았으면 새 seq, 바뀐 것이 없어 쌓지 않았으면 지금의 마지막 seq. */
      readonly seq: string
      readonly appended: boolean
      /**
       * 합친 본문의 구조 위반을 고친 update — 같은 seq 에 함께 쌓였다. 보낸 쪽은 이것을 갖고 있지 않다. 고칠 것이
       * 없었으면 null.
       */
      readonly repair: Uint8Array | null
    }
  | { readonly ok: false; readonly reason: AppendFailure }

export type AppendOptions = {
  readonly origin: DocOrigin
  /** 압축 기준. 없으면 `COMPACT_EVERY`. */
  readonly compactEvery?: number
}

/**
 * 참여자가 보낸 update 를 쌓는다 — 쓰기 경로 ①. 협업 서버가 update 마다 부른다(`collab/collab-server.ts`).
 *
 * 명령과 같은 한 단위다(머리말): 페이지 행 잠금 → 권한 → 본문 세션에 적용 → **투영하고, 받아들여지면 쌓는다**. 본문 행은
 * Y.Doc 의 투영이므로 투영 없이 쌓는 길을 두지 않는다 — 5a 에서 `collab/doc-store.ts` 에서 투영과 함께 옮겨 왔다.
 *
 *   - 권한을 쓰기마다 본다(F-05-19 "매 mutation 서버 재검사")
 *   - 바뀐 것이 없으면(이미 받은 것의 재전송) 투영을 건너뛴다 — 빠른 길일 뿐이다. 빼도 투영은 아무것도 쓰지 않고 쌓기는
 *     쌓지 않아 결과가 같다(반사실에서 검사가 전부 통과했다)
 *   - 살아 있는 하위 페이지의 참조가 빠진 update 는 **그 페이지를 휴지통으로 보낸다**(정본 프로젝터 · 5b · §3.2-19) — 휴지통
 *     명령과 같은 쓰기 · 같은 권한이고, 버릴 권한이 없으면 거부한다(`page_ref_forbidden`)
 *   - 투영이 거부하면 아무것도 쌓지 않고 거부를 돌려준다. 참여자의 로컬 문서에는 이미 들어가 있으므로 협업 서버는 그 연결을
 *     닫는다
 */
export async function appendDocUpdate(
  ctx: SessionContext,
  pageId: string,
  update: Uint8Array,
  options: AppendOptions,
): Promise<AppendDocResult> {
  if (update.byteLength > MAX_DOC_UPDATE_BYTES) return { ok: false, reason: 'too_large' }
  if (!isUuid(pageId)) return { ok: false, reason: 'not_found' }

  return withTransaction(async (tx) => {
    // ① 페이지 행을 먼저 잡는다 — 명령과 같은 줄에 서고, 잠금 순서(페이지 행 → 스냅샷)도 같다.
    const page = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (page === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_content')) return { ok: false, reason: 'forbidden' } as const

    const body = await openPageBody(tx, ctx, pageId, options.origin)
    const applied = body.applyUpdate(update)
    if (applied !== 'applied') return { ok: false, reason: applied } as const
    if (!body.changed) return { ok: true, seq: body.seq, appended: false, repair: null } as const

    const result = await body.finish({ compactEvery: options.compactEvery, missingPageRefs: 'trash' })
    if (!result.ok) {
      if (result.reason === 'page_ref_missing') throw new Error(`휴지통으로 보내는 투영이 빠진 참조를 거부했다: ${pageId}`)
      return { ok: false, reason: result.reason } as const
    }
    const { commit } = result
    return commit.appended
      ? ({ ok: true, seq: commit.seq, appended: true, repair: commit.repair } as const)
      : ({ ok: true, seq: commit.seq, appended: false, repair: null } as const)
  })
}
