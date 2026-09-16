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
import { hasUnknownBodyContent } from '../collab/repair.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { MAX_TREE_DEPTH, PAGE_TYPE } from './types.ts'
import {
  projectBodyRows,
  readBodyScope,
  type BodyScopeRow,
  type MissingPageRefs,
  type ProjectablePage,
  type ProjectBodyResult,
  type SaveBodyResult,
} from './save-page-body.ts'

/** 투영이 받아들이면 로그에 쌓은 결과(`commit`)까지, 거부하면 거부만. */
export type BodyWriteResult =
  | (Extract<ProjectBodyResult, { ok: true }> & { readonly commit: BodyCommit })
  | Exclude<ProjectBodyResult, { ok: true }>
  | Extract<SaveBodyResult, { reason: 'page_ref_unknown' }>

export type FinishOptions = {
  /** 압축 기준. 없으면 `COMPACT_EVERY`. */
  readonly compactEvery?: number
  /** 본문에서 빠진 살아 있는 하위 페이지를 어떻게 하는가. 없으면 거부(`refuse`) — `save-page-body.ts` `MissingPageRefs`. */
  readonly missingPageRefs?: MissingPageRefs
  /**
   * 하위 페이지 참조가 그 서브트리를 깊이 상한 밖으로 보내는 자리에 있으면 어떻게 하는가(HANDOFF §3.2-23). 없으면 거부(`refuse`) —
   * 투영이 `page_ref_too_deep` 를 돌려준다.
   *
   *   - `refuse` — 본문 저장(PUT) · 명령. 받은 문서를 고치지 않고 거부를 알린다(정본 "초과 시 명시적 에러")
   *   - `lift` — 참여자 update. 그 update 는 참여자 로컬에 이미 들어가 있어 거부하면 연결을 닫는 것밖에 없다. 들어갈 수 있는
   *     깊이까지 올려(`normalize.ts` `page_ref_lifted`) 투영하고, 같은 올리기를 수선으로 같은 seq 에 쌓는다
   */
  readonly deepPageRefs?: 'refuse' | 'lift'
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
      // 투영이 읽는 범위를 여기서 한 번 읽어 넘긴다 — 본문에 둘 수 있는 하위 페이지를 정하는 것도 같은 행이다.
      const scope = await readBodyScope(tx, ctx, pageId)
      // 본문에 둘 수 있는 하위 페이지는 이 본문 범위의 살아 있는 페이지뿐이다(§3.2-24). 다른 참조(같은 참조를 둘이 동시에 옮겨 생긴
      // 둘째 · 휴지통에 간 페이지 · 다른 본문으로 간 페이지 · 없는 페이지)는 읽기가 빼고 수선이 Y.Doc 에서 뺀다 — 투영은 페이지
      // 행을 만들거나 옮기지 않는다.
      const pageRefs = new Set(scope.filter((r) => r.type === PAGE_TYPE && r.lifecycle === 'live').map((r) => r.id))
      const first = session.read({ pageRefs })
      const dropping = first.fixes.includes('page_ref_dropped')
      const limits =
        options.deepPageRefs === 'lift' ? await pageRefDepthLimits(tx, ctx, page, scope, first.doc) : new Map<string, number>()
      // 고친 것을 Y.Doc 에 쓰지 못하면 행과 Y.Doc 이 달라진다 — 수선은 모르는 노드가 있으면 쓰지 않는다(`repair.ts`).
      // 이때만 거부한다. 모르는 노드는 새 버전 클라이언트가 넣으므로 스키마 버전 게이트가 들어오면 닿지 않는다(HANDOFF §7).
      if ((dropping || limits.size > 0) && hasUnknownBodyContent(session.ydoc)) {
        if (dropping) return { ok: false, reason: 'page_ref_unknown' } as const
        const [tooDeep] = limits.keys()
        return {
          ok: false,
          reason: 'page_ref_too_deep',
          pageId: tooDeep,
          message: '본문에 모르는 블록이 있어 깊이 상한을 넘는 하위 페이지를 올릴 수 없습니다.',
        } as const
      }
      const pageRefDepth = limits.size > 0 ? limits : undefined
      const doc = pageRefDepth === undefined ? first.doc : session.read({ pageRefs, pageRefDepth }).doc
      const result = await projectBodyRows(tx, ctx, page, doc, scope, {
        missingPageRefs: options.missingPageRefs,
      })
      if (!result.ok) return result
      // 수선은 투영이 읽은 것과 같은 것으로 고친다 — 그래야 올리거나 뺀 참조가 행과 Y.Doc 에서 같다.
      const commit = await session.commit({ actorId: ctx.userId, origin, compactEvery: options.compactEvery, pageRefDepth, pageRefs })
      return { ...result, commit }
    },
  }
}

/**
 * 참조가 놓인 자리 때문에 그 하위 페이지 서브트리가 깊이 상한을 넘는 참조 → 놓일 수 있는 가장 깊은 본문 깊이(최상위 블록 = 1).
 * 넘지 않는 참조는 담지 않는다 — 비었으면 올릴 것이 없다.
 *
 * 규칙은 `relocateSubtree` 의 거부와 같아야 한다 — 올린 자리를 투영이 옮길 때 거부하지 않는다. 본문 깊이 `d` 의 참조는 경로
 * 길이가 `base + d` 이고(`base` = 이 페이지의 경로 길이) 서브트리의 가장 깊은 노드는 거기에 높이 `h` 를 더한다. 그래서
 * `base + d + h < MAX_TREE_DEPTH` 이거나 **지금 행보다 깊어지지 않으면**(`base + d <= 행의 경로 길이`) 놓일 수 있다. 뒤의 것
 * 덕분에 늘 1 이상이다 — 이 페이지 본문의 참조는 행의 경로가 `base + 1` 이상이므로 최상위까지 올리면 반드시 들어간다.
 *
 * 높이는 **더 깊어지는 참조만** 잰다(서브트리 조회) — 빠른 길일 뿐이다. 더 깊어지지 않는 참조는 뒤의 항으로 늘 들어가므로 모든
 * 참조를 재도 결과가 같다(반사실에서 검사가 전부 통과했다). 보통의 편집은 경로 조회 한 번으로 끝난다.
 */
async function pageRefDepthLimits(
  tx: Tx,
  ctx: SessionContext,
  page: ProjectablePage,
  scope: readonly BodyScopeRow[],
  doc: EditorDoc,
): Promise<Map<string, number>> {
  const refs: { readonly id: string; readonly depth: number }[] = []
  const walk = (blocks: readonly EditorBlock[], depth: number): void => {
    for (const b of blocks) {
      if (b.type === PAGE_TYPE) refs.push({ id: b.id, depth })
      walk(b.children ?? [], depth + 1)
    }
  }
  walk(doc.blocks, 1)
  const limits = new Map<string, number>()
  if (refs.length === 0) return limits

  const base = page.ancestor_path.length
  // 문서의 참조는 이미 이 범위의 살아 있는 하위 페이지뿐이다(`pageRefs` 로 읽었다).
  const rowDepthOf = new Map(scope.filter((r) => r.type === PAGE_TYPE).map((r) => [r.id, r.ancestor_path.length]))
  const deepening = refs.filter((r) => {
    const rowDepth = rowDepthOf.get(r.id)
    return rowDepth !== undefined && base + r.depth > rowDepth
  })
  if (deepening.length === 0) return limits

  const heights = await tx.query<{ id: string; deepest: number | null }>(
    `SELECT p.id,
            (SELECT max(cardinality(d.ancestor_path)) FROM block d
              WHERE d.ancestor_path @> ARRAY[p.id] AND d.workspace_id = $2) AS deepest
       FROM unnest($1::uuid[]) AS p(id)`,
    [deepening.map((r) => r.id), ctx.workspaceId],
  )
  const deepestOf = new Map(heights.map((h) => [h.id, h.deepest]))
  for (const ref of deepening) {
    const rowDepth = rowDepthOf.get(ref.id) as number
    const height = (deepestOf.get(ref.id) ?? rowDepth) - rowDepth
    const limit = Math.max(MAX_TREE_DEPTH - 1 - base - height, rowDepth - base)
    if (ref.depth > limit) limits.set(ref.id, limit)
  }
  return limits
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
  /**
   * 하위 페이지 참조를 깊이 상한을 넘는 자리로 옮겼는데 본문에 모르는 노드가 있어 올린 것을 Y.Doc 에 쓸 수 없다. 모르는 노드가
   * 없으면 거부하지 않고 올린다(`FinishOptions.deepPageRefs`).
   */
  | 'page_ref_too_deep'
  /**
   * 본문에 둘 수 없는 하위 페이지 참조(휴지통 · 다른 본문 · 없는 페이지 · 동시에 옮겨 생긴 둘째)가 있는데 본문에 모르는 노드가 있어
   * 뺀 것을 Y.Doc 에 쓸 수 없다. 모르는 노드가 없으면 거부하지 않고 뺀다(§3.2-24).
   */
  | 'page_ref_unknown'

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
 *   - 하위 페이지 참조를 그 서브트리가 깊이 상한을 넘는 자리로 옮긴 update 는 **들어갈 수 있는 깊이까지 올린다**(§3.2-23) —
 *     올린 것은 수선으로 같은 seq 에 쌓여 보낸 쪽도 받는다. 본문에 모르는 노드가 있어 수선을 쓸 수 없을 때만 거부한다
 *   - 이 본문 범위의 살아 있는 하위 페이지가 아닌 참조는 **뺀다**(§3.2-24) — 같은 참조를 둘이 동시에 옮겨 생긴 둘째 · 휴지통 ·
 *     다른 본문으로 간 페이지. 뺀 것도 같은 seq 의 수선이다. 본문에 모르는 노드가 있어 수선을 쓸 수 없을 때만 거부한다
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

    const result = await body.finish({ compactEvery: options.compactEvery, missingPageRefs: 'trash', deepPageRefs: 'lift' })
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
