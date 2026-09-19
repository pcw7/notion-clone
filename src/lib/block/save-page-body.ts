/**
 * 페이지 본문 투영 · 통째 저장 — 프로젝터
 *
 * ⚠ **통째 저장(`savePageBody`)을 부르는 화면은 더 이상 없다**(CRDT 6e). 본문 편집은 협업 서버로만 가고(F-05-01), 본문 저장 API(PUT)는
 * 걷어냈다 — 문서를 통째로 받는 쓰기는 그 사이의 동시 편집을 되돌리기 때문이다(§7 이 그렇게 적었다). 남아 있는 부르는 곳은
 * **검사와 e2e 준비**이고, 그것들은 서버 명령 경로를 그대로 부른다. 투영(`projectBodyRows`)은 협업 경로가 계속 쓴다.
 *
 * 정본: 판결 X-1 (본문 순서의 정본은 Y.Doc, `order_key` 는 파생 / 프로젝터가
 *       유일한 쓰기자), X-3 · B2 · B5 (비페이지 블록은 lifecycle 축이 없다),
 *       X-6 (`block.version` 은 페이지 단위 변경 카운터)
 *       마스터 문서 §5.1 "Phase 0 은 페이지 단위 LWW"
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 함수가 프로젝터다
 * ──────────────────────────────────────────────────────────────────────
 *
 * X-1 은 `parent_type='block'` 인 블록의 `order_key` 를 "프로젝터가 쓰는 파생"
 * 이라고 정하고, 그 대가로 "프로젝터가 유일한 쓰기자이므로
 * `UNIQUE(parent_id, order_key)` 충돌이 구조적으로 발생하지 않는다"를 얻었다.
 *
 * Phase 0 에는 Y.Doc 이 없다. 상류가 문서(`EditorDoc`)이고, 이 함수가 그
 * 문서를 `block` 행으로 투영한다. **Phase 1 에서 바뀌는 것은 상류뿐이다** —
 * `doc_update` 로그를 머지해 문서를 만들고 같은 투영을 돌린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 비페이지 블록의 삭제는 물리 삭제다
 * ──────────────────────────────────────────────────────────────────────
 *
 * X-3 이 `lifecycle` 을 `type='page'` 만의 축으로 못박았고
 * (`ck_lifecycle_page` CHECK 이 실제로 막는다), B5 는 "비페이지 블록은 소속
 * Y.Doc 안에 있으므로 건드리지 않는다"고 한다. 즉 문단은 휴지통에 가지 않는다
 * (§9-Q8 의 잠정 결정과 일치: "나타나지 않음"). 문서에서 사라진 본문 블록은
 * **행을 지운다.** 복원은 `page_version` 이 담당한다(Phase 1).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자식 페이지는 프로젝터가 소유하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 문서에는 `type='page'` 참조 노드가 들어오지만, 프로젝터는 그 행의 **위치만**
 * 건드린다(순서, 그리고 부모). 제목·properties·lifecycle 은 그 페이지 자신의 것이다.
 *
 * 부모가 바뀌는 경우 — 하위 페이지를 토글 안으로 끌어다 놓는 것 — 는
 * `order_key` 만 고쳐서는 안 된다. 그 페이지 **서브트리 전체의 `ancestor_path`
 * 와 `perm_scope_id`** 를 다시 써야 한다 [X-7 / §3.11 ④]. 그 일은
 * `move-page.ts` 의 `relocateSubtree` 가 하고, 여기서는 부르기만 한다 —
 * 두 벌로 만들면 한쪽만 고쳐져 권한이 조용히 틀어진다.
 *
 * 반대로 문서에 **이 본문의 살아 있는 자식 페이지가 아닌 참조**가 있으면 — 없는 페이지 · 다른 본문의 페이지 · 휴지통에 간
 * 페이지 · 같은 참조를 둘이 동시에 옮겨 새 id 를 받은 둘째 — 투영에 오기 전에 뺀다(`body-write.ts` 의 `pageRefs` · HANDOFF
 * §3.2-24). 투영은 그런 참조를 받으면 던진다. 한때 본문 블록처럼 넣어 제목 없는 페이지 행을 만들었고(유령 페이지), 다른 본문의
 * 페이지면 PK 위반으로 던졌고, 휴지통 페이지면 그 자리를 옮겼다(B2 위반) — 검사가 넷 다 재현했다.
 *
 * 그리고 문서에서 살아 있는 자식 페이지가 빠져 있으면 **어디서 온 문서인가**로 가른다(CRDT 5b · HANDOFF §3.2-19).
 *
 *   - 통째 저장 · 명령 — **거부한다.** 문서를 통째로 받으므로 낡은 탭 하나가 그 사이 생긴 하위 페이지를
 *     모른 채 보내면 "지웠다"와 "몰랐다"를 가를 수 없다. 하위 페이지 삭제는 휴지통 API 로 한다
 *   - 참여자 update — **휴지통으로 보낸다**(정본 프로젝터). Yjs update 의 삭제는 보낸 쪽이 본 항목만 가리키므로 빠졌다는
 *     것은 지웠다는 것이다. 휴지통 명령과 같은 쓰기 · 같은 권한이다(`trash-rows.ts`)
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { PAGE_TYPE } from './types.ts'
import { plainTitleOf } from './page.ts'
import { indexPageText } from '../search/index-page.ts'
import { notifyMentions } from '../notification/fanout.ts'
import { projectLinkEdges } from './link-edges.ts'
import { countFileReferences, fileReferenceDelta } from './image.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { orderKeyBetween } from './order-key.ts'
import { relocateSubtree, MoveError } from './move-page.ts'
import { pageChangeAccess, trashSubtreeRows } from './trash-rows.ts'
import { openPageBody } from './body-write.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import {
  projectDocument,
  rowsToDoc,
  validateDoc,
  wrapUnknownTypes,
  type BodyRow,
  type DocIssue,
  type EditorDoc,
  type ProjectedBlock,
} from '../editor/document.ts'

// ── 결과 ──────────────────────────────────────────────────────────────

export type SaveWriteCounts = {
  readonly inserted: number
  readonly updated: number
  readonly deleted: number
  readonly reordered: number
}

export type SaveBodyResult =
  | {
      readonly ok: true
      /** 저장 후 `block.version` [X-6]. 다음 저장의 `expectedVersion` 으로 쓴다. */
      readonly version: string
      readonly writes: SaveWriteCounts
    }
  | { readonly ok: false; readonly reason: 'not_found' }
  /** 볼 수는 있지만 고칠 수 없다(F-06-01 `edit_content`). */
  | { readonly ok: false; readonly reason: 'forbidden' }
  | { readonly ok: false; readonly reason: 'invalid_document'; readonly issues: DocIssue[] }
  | {
      readonly ok: false
      readonly reason: 'version_conflict'
      /** 서버의 현재 버전. 클라이언트가 이 값으로 다시 읽어 병합한다. */
      readonly currentVersion: string
    }
  | {
      readonly ok: false
      readonly reason: 'page_ref_missing'
      /** 문서에서 빠진 자식 페이지들. */
      readonly missing: readonly string[]
    }
  | {
      readonly ok: false
      readonly reason: 'page_ref_too_deep'
      /** 옮기려던 자식 페이지. 그 서브트리가 깊이 상한을 넘는다. */
      readonly pageId: string
      readonly message: string
    }
  /**
   * 본문에 둘 수 없는 하위 페이지 참조를 빼야 하는데 본문(Y.Doc)에 모르는 노드가 있어 뺄 수 없다(`body-write.ts` · HANDOFF §3.2-24).
   * 모르는 노드는 협업 참여자만 넣으므로 본문 저장에서는 드물다.
   */
  | { readonly ok: false; readonly reason: 'page_ref_unknown' }

// ── 안정 비교 ─────────────────────────────────────────────────────────

/**
 * 키 순서에 무관한 JSON 직렬화.
 *
 * `properties`/`format` 이 실제로 바뀌었는지 판단하는 데 쓴다. `JSON.stringify`
 * 를 그냥 쓰면 키 순서가 다른 같은 값이 "변경됨"으로 잡혀서, 아무것도 고치지
 * 않은 저장이 페이지 전체를 다시 쓴다 — 마스터 문서 §9-Q1(프로젝터 쓰기 증폭)이
 * 경계하는 그 지점이다.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
}

// ── 본문 범위 조회 ────────────────────────────────────────────────────

type ScopeRow = BodyRow & { lifecycle: string; ancestor_path: string[]; perm_scope_id: string }

/** 본문 범위의 행 — `readBodyScope`. 투영하는 쪽이 읽어 `projectBodyRows` 에 넘긴다. */
export type BodyScopeRow = ScopeRow

/**
 * 투영이 읽는 이 페이지의 문서 범위(`readScope`). 투영하는 단위(`body-write.ts` `finish`)가 **행을 다 쓴 뒤에** 읽어, 본문에 둘 수 있는
 * 하위 페이지를 정하고 같은 행을 투영에 넘긴다 — 두 번 읽지 않고, 두 판단이 다른 행을 보지 않는다.
 */
export async function readBodyScope(tx: Tx, ctx: SessionContext, pageId: string): Promise<readonly BodyScopeRow[]> {
  return readScope(tx, ctx, pageId)
}

/**
 * 이 페이지의 **문서 범위**에 있는 행을 읽는다.
 *
 * 재귀는 `type='page'` 에서 멈춘다. 자식 페이지의 본문은 그 페이지의 문서이므로
 * 이 문서의 범위가 아니다. `ancestor_path @> ARRAY[pageId]` 로 뽑으면 자식
 * 페이지의 자손까지 딸려 와서 **다른 문서의 블록을 지우게 된다.**
 */
async function readScope(tx: Tx, ctx: SessionContext, pageId: string): Promise<ScopeRow[]> {
  return tx.query<ScopeRow>(
    `WITH RECURSIVE doc_scope AS (
         SELECT b.id, b.type, b.parent_id, b.order_key, b.properties, b.format,
                b.lifecycle, b.ancestor_path, b.perm_scope_id
           FROM block b
          WHERE b.parent_id = $1 AND b.workspace_id = $2
       UNION ALL
         SELECT c.id, c.type, c.parent_id, c.order_key, c.properties, c.format,
                c.lifecycle, c.ancestor_path, c.perm_scope_id
           FROM block c
           JOIN doc_scope s ON c.parent_id = s.id
          WHERE s.type <> $3 AND c.workspace_id = $2
     )
     SELECT * FROM doc_scope`,
    [pageId, ctx.workspaceId, PAGE_TYPE],
  )
}

/**
 * **이 트랜잭션에서** 페이지 본문을 행으로부터 읽는다. 권한은 호출자가 이미 확인했다.
 *
 * `loadPageBody` 와 Y.Doc 옮기기(`collab/doc-store.ts`)가 같은 규칙으로 읽는다 — 두 벌이면 "편집기에서 본
 * 본문과 옮겨진 본문이 다른" 페이지가 생긴다. 옮기기는 Y.Doc 을 쓰는 트랜잭션 안에서 읽어야 하므로
 * (따로 읽으면 그 사이의 저장이 빠진다) 트랜잭션을 받는다.
 *
 * 휴지통에 있는 자식 페이지는 문서에 넣지 않는다. 다만 그 키는 점유된 상태로 남아 있고(B2), 저장 시
 * `assignSiblingKeys` 가 비켜간다.
 */
export async function readLiveBody(tx: Tx, ctx: SessionContext, pageId: string): Promise<EditorDoc> {
  const scope = await readScope(tx, ctx, pageId)
  return rowsToDoc(pageId, scope.filter((r) => r.lifecycle === 'live'))
}

// ── order_key 할당 ────────────────────────────────────────────────────

/**
 * 문서 밖 형제가 점유한 키를 피해 형제 키를 매긴다.
 *
 * 문서 밖 형제는 **휴지통에 있는 자식 페이지**다. B2 가 "삭제 시 parent_id ·
 * order_key 를 절대 변경하지 않는다"고 정했으므로 그 키를 밀어낼 수 없다.
 * 그래서 우리 쪽이 비켜간다 — 점유된 키가 나오면 한 칸 더 나아간다.
 *
 * 점유가 없으면(보통) 결과는 `a0, a1, …` 로 **결정론적**이다. 그래서 문서가
 * 안 바뀌면 키도 그대로고 저장이 쓰기 0건이 된다.
 */
function assignSiblingKeys(count: number, occupied: ReadonlySet<string>): string[] {
  const keys: string[] = []
  let prev: string | null = null
  for (let i = 0; i < count; i += 1) {
    let key = orderKeyBetween(prev, null)
    while (occupied.has(key)) key = orderKeyBetween(key, null)
    keys.push(key)
    prev = key
  }
  return keys
}

// ── 저장 ──────────────────────────────────────────────────────────────

export type SavePageBodyOptions = {
  /**
   * 클라이언트가 읽었을 때의 `block.version`.
   *
   * 주면 낙관적 잠금이 된다 — 그 사이 누가 저장했으면 `version_conflict` 다.
   * Phase 0 의 대체안이 "페이지 단위 LWW + 다른 사람이 편집 중 배너"(§5.1)이고,
   * 배너를 띄우려면 충돌을 **알아야** 한다. 생략하면 무조건 덮어쓴다(순수 LWW).
   */
  readonly expectedVersion?: string
}

export async function savePageBody(
  ctx: SessionContext,
  pageId: BlockId,
  doc: EditorDoc,
  options: SavePageBodyOptions = {},
): Promise<SaveBodyResult> {
  const issues = validateDoc(doc)
  if (issues.length > 0) return { ok: false, reason: 'invalid_document', issues }

  return withTransaction(async (tx) => {
    // 페이지 행을 잠근다. 프로젝터가 유일한 쓰기자라는 X-1 의 전제를
    // 동시 저장 두 건에 대해서도 성립시키는 것이 이 잠금이다.
    const page = await tx.queryMaybe<{
      id: string
      ancestor_path: string[]
      perm_scope_id: string
      version: string
      // 검색 색인의 `title_text` 용. 프로젝터는 페이지 제목을 **쓰지 않지만**
      // (소유자는 그 페이지 자신이다), 색인 행의 제목이 비어 있을 수 있어서
      // 읽어서 함께 넣는다 — 마이그레이션 0012 의 백필이 `title_text` 를 NULL 로
      // 남겼으므로, 본문을 한 번 저장하면 제목까지 검색 가능해진다.
      properties: { title?: unknown } | null
    }>(
      `SELECT id, ancestor_path, perm_scope_id, version, properties
         FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (!page) return { ok: false, reason: 'not_found' } as const

    // W6-b: 볼 수만 있는 사람은 저장할 수 없다. **못 보는 사람에게는 `not_found`**
    // 다 — "권한이 없다"고 답하면 그 페이지의 존재를 알려주게 된다.
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_content')) return { ok: false, reason: 'forbidden' } as const

    if (options.expectedVersion !== undefined && options.expectedVersion !== page.version) {
      return { ok: false, reason: 'version_conflict', currentVersion: page.version } as const
    }

    // 본문의 정본은 Y.Doc 이다(CRDT 4b · 판결 X-1). 받은 문서를 Y.Doc 에 옮기고 — `updateYFragment` 가 같은 부분은
    // 건너뛰므로 바뀐 블록만 쓴다 — 그 결과를 투영하고, 받아들여지면 로그에 쌓는다(`body-write.ts`).
    const body = await openPageBody(tx, ctx, pageId, 'editor')
    // 모르는 타입은 옮기기 전에 감싼다 — ProseMirror 노드에는 원래 타입 이름을 담을 곳이 없다(`wrapUnknownTypes`).
    const next = docToPm(wrapUnknownTypes(doc))
    body.change((tr) => {
      tr.replaceWith(0, tr.doc.content.size, next.content)
    })
    const result = await body.finish()
    if (result.ok) return { ok: true, version: result.version, writes: result.writes }
    // 본문 저장은 빠진 하위 페이지를 거부하므로(`refuse` — 머리말) 버릴 권한을 묻는 거부는 나올 수 없다.
    if (result.reason === 'page_ref_forbidden') throw new Error(`본문 저장의 투영이 휴지통 권한을 물었다: ${pageId}`)
    return result
  })
}

/** 프로젝터가 받는 페이지 행 — 호출자가 같은 트랜잭션에서 `FOR UPDATE` 로 잡은 것. */
export type ProjectablePage = {
  readonly id: string
  readonly ancestor_path: string[]
  readonly perm_scope_id: string
  readonly version: string
  readonly properties: { title?: unknown } | null
}

/** 본문에서 빠진 **살아 있는** 하위 페이지를 어떻게 하는가 — HANDOFF §3.2-19. */
export type MissingPageRefs =
  /**
   * 거부한다(`page_ref_missing`) — 문서를 **통째로** 받는 본문 저장(PUT) · 명령. 낡은 탭은 그 사이 생긴 하위 페이지를 모르고,
   * 통째로 받은 문서에서는 "지웠다"와 "몰랐다"를 가를 수 없다
   */
  | 'refuse'
  /**
   * 휴지통으로 보낸다(정본 프로젝터 · CRDT 5b) — 참여자 update. Yjs update 의 삭제는 보낸 쪽이 **본 항목**만 가리키므로
   * 빠졌다는 것은 지웠다는 것이다. 버릴 권한이 없으면 거부한다(`page_ref_forbidden`)
   */
  | 'trash'

export type ProjectOptions = {
  /** 없으면 `refuse`. */
  readonly missingPageRefs?: MissingPageRefs
}

export type ProjectBodyResult =
  | Extract<SaveBodyResult, { ok: true }>
  | Extract<SaveBodyResult, { reason: 'page_ref_missing' | 'page_ref_too_deep' }>
  /** `trash` 모드에서 빠진 하위 페이지를 버릴 권한(§3.2-18)이 없다. 볼 수 없는 하위 페이지도 같은 이유다. */
  | { readonly ok: false; readonly reason: 'page_ref_forbidden'; readonly pageId: string }

type ProjectRefusal = Exclude<ProjectBodyResult, { ok: true }>

/** 투영의 거부를 savepoint 까지 되돌리려고 던진다. `projectBodyRows` 밖으로 나가지 않는다. */
class ProjectionRefused extends Error {
  readonly result: ProjectRefusal

  constructor(result: ProjectRefusal) {
    super(result.reason)
    this.name = 'ProjectionRefused'
    this.result = result
  }
}

/**
 * 문서를 이 페이지의 `block` 행으로 투영한다 — **프로젝터**(머리말).
 *
 * 권한 · 버전 검사 · 페이지 행 잠금은 호출자가 이미 했다. 4a조각이 `savePageBody` 에서 떼어 냈다. 4b조각이 상류를
 * Y.Doc 으로 바꾸면 서버 명령들이 본문 세션의 결과(`readBodyYDoc`)를 이 함수에 넘긴다 — 머리말의 "Phase 1 에서
 * 바뀌는 것은 상류뿐이다".
 *
 * 본문에서 빠진 살아 있는 하위 페이지는 `options.missingPageRefs` 가 정한다 — 거부(기본) 또는 휴지통 전이(CRDT 5b ·
 * `MissingPageRefs`).
 *
 * **거부하면 아무것도 쓰지 않는다.** 깊이 초과(`page_ref_too_deep`)는 지우기 · 넣기 · 임시 키를 쓴 **뒤에**
 * 알게 되는데, `withTransaction` 은 콜백이 반환하면 커밋한다 — 거부를 반환하던 동안 옮기려던 자식 페이지의
 * `order_key` 가 임시 키(`'~' || id`)로 커밋돼 남았다(검사가 재현했다). 그래서 투영을 savepoint 안에서 돌리고
 * 거부면 던져 되돌린 뒤 거부를 돌려준다 — 호출자가 되돌리기를 잊을 수 없다. 휴지통으로 보낸 하위 페이지도 함께 되돌아간다.
 */
export async function projectBodyRows(
  tx: Tx,
  ctx: SessionContext,
  page: ProjectablePage,
  doc: EditorDoc,
  scope: readonly BodyScopeRow[],
  options: ProjectOptions = {},
): Promise<ProjectBodyResult> {
  try {
    return await tx.savepoint('project_body', async () => {
      const result = await projectRows(tx, ctx, page, doc, scope, options.missingPageRefs ?? 'refuse')
      if (!result.ok) throw new ProjectionRefused(result)
      return result
    })
  } catch (e) {
    if (e instanceof ProjectionRefused) return e.result
    throw e
  }
}

async function projectRows(
  tx: Tx,
  ctx: SessionContext,
  page: ProjectablePage,
  doc: EditorDoc,
  scope: readonly ScopeRow[],
  missingPageRefs: MissingPageRefs,
): Promise<ProjectBodyResult> {
  const pageId = page.id
  const projection = projectDocument(pageId, page.ancestor_path, doc)

  // 문서의 참조는 이 본문 범위의 살아 있는 하위 페이지여야 한다 — 부르는 쪽이 읽기에서 뺐다(`body-write.ts` `pageRefs`). 여기 닿으면
  // 그 거르기가 빠진 것이다. 넣으면 페이지 행을 만들거나(유령 페이지) 휴지통 · 다른 본문의 페이지를 옮기게 된다(머리말). 검사로
  // 강제하지 못한 방어다 — 거르기가 있는 한 닿는 입력이 없어 이 줄을 빼는 반사실에서 검사가 전부 통과했다(HANDOFF §3.3-113).
  const liveChildPages = new Set(scope.filter((r) => r.type === PAGE_TYPE && r.lifecycle === 'live').map((r) => r.id))
  const stray = projection.blocks.find((b) => b.type === PAGE_TYPE && !liveChildPages.has(b.id))
  if (stray !== undefined) throw new Error(`투영에 이 본문의 살아 있는 하위 페이지가 아닌 참조가 왔다: ${stray.id}`)

  // ── 자식 페이지 정합성 ────────────────────────────────────────────
  const docIds = new Set(projection.blocks.map((b) => b.id))
  const livePageRefs = scope.filter((r) => r.type === PAGE_TYPE && r.lifecycle === 'live')

  const missing = livePageRefs.filter((r) => !docIds.has(r.id)).map((r) => r.id)
  if (missing.length > 0 && missingPageRefs === 'refuse') {
    // 낡은 탭이 하위 페이지를 지워버리는 경로를 만들지 않는다.
    return { ok: false, reason: 'page_ref_missing', missing } as const
  }

  // 정본 프로젝터: "type='page' 인데 doc 에 없으면 lifecycle='trashed' 로 전이"(§3.4 · X-3). 참조 노드는 이미 빠졌으므로
  // 행만 버린다 — 휴지통 명령과 같은 쓰기 · 같은 권한(`trash-rows.ts` · §3.2-18). 하나라도 버릴 수 없으면 거부한다 — 일부만
  // 버리고 나머지를 남기면 그 참조가 빠진 Y.Doc 과 살아 있는 행이 어긋난다. 이미 버린 것은 savepoint 가 되돌린다.
  // 버린 페이지의 `order_key` 는 그대로 남아(B2) 아래의 키 재할당이 비켜간다 — 되살리면 원래 자리다.
  for (const id of missing) {
    if ((await pageChangeAccess(tx, ctx, id)) !== 'ok') {
      return { ok: false, reason: 'page_ref_forbidden', pageId: id } as const
    }
    await trashSubtreeRows(tx, ctx, id)
  }

  // ── 자리를 옮긴 자식 페이지 ───────────────────────────────────────
  //
  // 하위 페이지를 토글 안으로 끌어다 놓는 것 같은 조작이다. 부모가 바뀌면
  // `order_key` 만 고쳐서는 안 되고 **그 페이지 서브트리 전체의
  // `ancestor_path` 와 `perm_scope_id`** 를 다시 써야 한다 [X-7 / §3.11 ④].
  // 방치하면 정확히 X-7 이 경계한 "권한이 조용히 틀어지는" 상태가 된다.
  //
  // 그 일은 `move-page.ts` 의 `relocateSubtree` 가 이미 한다. 여기서 다시
  // 구현하지 않고 부른다 — 두 벌이면 한쪽만 고쳐져 어긋난다.
  //
  // 부모가 그대로여도 **경로가 바뀌면** 옮긴 것이다 — 참조를 담은 토글을 다른 블록 밑으로 옮기는 경우다. 한때 부모만 비교해
  // 토글 행의 경로는 따라가고 하위 페이지와 그 서브트리의 경로는 옛 자리에 남았다(검사가 재현했다). 깊이 검사도 건너뛰었다.
  const currentRowOf = new Map(scope.map((r) => [r.id, r]))
  const pageRefMoves = projection.blocks.filter((b) => {
    if (b.type !== PAGE_TYPE) return false
    const row = currentRowOf.get(b.id)
    return row?.parent_id !== b.parentId || stableJson(row.ancestor_path) !== stableJson(b.ancestorPath)
  })

  // ── order_key 재할당 (문서 밖 형제를 피한다) ──────────────────────
  const occupiedByParent = new Map<string, Set<string>>()
  for (const row of scope) {
    if (docIds.has(row.id)) continue
    if (row.type !== PAGE_TYPE) continue // 본문 블록은 지워질 것이므로 비켜줄 필요가 없다
    const set = occupiedByParent.get(row.parent_id) ?? new Set<string>()
    set.add(row.order_key)
    occupiedByParent.set(row.parent_id, set)
  }

  const targets = withReassignedKeys(projection.blocks, occupiedByParent)

  // ── 차집합 ────────────────────────────────────────────────────────
  const existing = new Map(scope.map((r) => [r.id, r]))
  const toDelete = scope
    .filter((r) => !docIds.has(r.id) && r.type !== PAGE_TYPE)
    .map((r) => r.id)

  const toInsert: ProjectedBlock[] = []
  const toUpdate: ProjectedBlock[] = []
  const keyChanges: ProjectedBlock[] = []

  for (const target of targets) {
    const row = existing.get(target.id)
    if (!row) {
      toInsert.push(target)
      continue
    }
    // ★ "키가 바뀌는 행"이 아니라 **(부모, 키) 자리가 바뀌는 행**이다.
    // 키는 위치로 결정론적으로 매겨지므로(a0, a1, …) 루트 첫 블록을 다른 블록의
    // 첫 자식으로 옮기면 키 문자열은 a0 그대로이고 부모만 바뀐다. 키만 비교하면
    // 이 행은 임시 키로 비켜나지 않고 옛 자리 (옛 부모, a0) 에 남는데, 그 자리로
    // 들어오는 형제의 UPDATE 가 먼저 돌면 UNIQUE 에 걸린다. 드래그(F-01-08)의
    // "자식 드롭"이 처음 밟았다 — Tab/Shift+Tab 은 우연히 늘 키도 바뀌었다.
    if (row.order_key !== target.orderKey || row.parent_id !== target.parentId) {
      keyChanges.push(target)
    }
    if (row.type === PAGE_TYPE) {
      // 자식 페이지는 순서(그리고 필요하면 부모)만. 내용은 그 페이지의 것이다.
      continue
    }
    const changed =
      row.type !== target.type ||
      row.parent_id !== target.parentId ||
      row.order_key !== target.orderKey ||
      stableJson(row.ancestor_path) !== stableJson(target.ancestorPath) ||
      stableJson(row.properties ?? {}) !== stableJson(target.properties) ||
      stableJson(row.format ?? {}) !== stableJson(target.format)
    if (changed) toUpdate.push(target)
  }

  // ── 쓰기 ──────────────────────────────────────────────────────────
  //
  // 순서가 중요하다. `ux_block_sibling_order` 는 `CREATE UNIQUE INDEX` 로
  // 만든 **지연 불가** 제약이라, 한 UPDATE 안에서 두 형제의 키를 맞바꾸면
  // 중간 상태에서 충돌한다. 그래서 네 단계로 나눈다.
  //
  //   ① 사라진 본문 블록을 지운다        — 키가 비워진다
  //   ② 키가 바뀌는 행을 임시 키로 옮긴다 — id 기반이라 서로 충돌하지 않고,
  //                                         '~' 로 시작해 최종 키와도 겹치지 않는다
  //   ③ 새 행을 최종 키로 넣는다
  //   ④ ②의 행을 최종 키로 옮긴다

  if (toDelete.length > 0) {
    await tx.query(`DELETE FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2`, [
      toDelete,
      ctx.workspaceId,
    ])
  }

  // 자리를 옮기는 자식 페이지도 임시 키로 비켜둔다. 최종 키를 바로 쓰면
  // 새 형제 그룹에서 아직 임시 키로 옮겨지지 않은 행과 충돌할 수 있다.
  const tempKeyIds = [...new Set([...keyChanges, ...pageRefMoves].map((b) => b.id))]
  if (tempKeyIds.length > 0) {
    await tx.query(
      `UPDATE block SET order_key = '~' || id::text
        WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
      [tempKeyIds, ctx.workspaceId],
    )
  }

  // 개별 문장으로 쓴다. 위의 차집합 계산 덕분에 아무것도 안 바뀐 저장은
  // 여기서 0건이 되고, 보통의 타이핑은 1~3건이다. 한 페이지를 통째로 새로
  // 만드는 경우에만 블록 수만큼 문장이 나가는데, 그때가 문제가 되면
  // unnest 배치로 바꾼다 (§9-Q1 의 관측 대상).
  for (const b of toInsert) {
    await tx.query(
      `INSERT INTO block (
         id, workspace_id, type, parent_type, parent_id, order_key,
         ancestor_path, perm_scope_id, properties, format,
         created_by, created_at, last_edited_by, last_edited_at
       ) VALUES ($1, $2, $3, 'block', $4, $5, $6::uuid[], $7, $8::jsonb, $9::jsonb,
                 $10, now(), $10, now())`,
      [
        b.id,
        ctx.workspaceId,
        b.type,
        b.parentId,
        b.orderKey,
        b.ancestorPath,
        page.perm_scope_id,
        JSON.stringify(b.properties),
        JSON.stringify(b.format),
        ctx.userId,
      ],
    )
  }

  for (const b of toUpdate) {
    await tx.query(
      `UPDATE block
          SET type = $3, parent_id = $4, order_key = $5, ancestor_path = $6::uuid[],
              properties = $7::jsonb, format = $8::jsonb,
              last_edited_by = $9, last_edited_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [
        b.id,
        ctx.workspaceId,
        b.type,
        b.parentId,
        b.orderKey,
        b.ancestorPath,
        JSON.stringify(b.properties),
        JSON.stringify(b.format),
        ctx.userId,
      ],
    )
  }

  // ── 자리를 옮긴 자식 페이지: 서브트리째 재배치 ────────────────────
  //
  // `relocateSubtree` 가 `ancestor_path` · `perm_scope_id` · `version` 을
  // 서브트리 전체에 다시 쓴다. 우리가 계산한 `order_key` 를 넘겨서
  // 문서 위치가 그대로 반영되게 한다.
  //
  // 사이클은 있을 수 없다 — 대상은 **이 페이지의 문서 안 블록**이고, 그 블록이
  // 옮겨지는 자식 페이지의 자손일 수는 없다(자식 페이지의 본문은 별도 문서다).
  // 그래서 `relocateSubtree` 가 던질 수 있는 것은 깊이 초과뿐이다.
  const movedPageIds = new Set(pageRefMoves.map((b) => b.id))
  for (const b of pageRefMoves) {
    const row = existing.get(b.id)
    if (!row) continue
    const parentRow = b.parentId === pageId ? null : existing.get(b.parentId)

    try {
      await relocateSubtree(
        tx,
        ctx,
        {
          id: row.id,
          parent_type: 'block',
          parent_id: row.parent_id,
          ancestor_path: row.ancestor_path,
          perm_scope_id: row.perm_scope_id,
        },
        {
          id: b.parentId,
          type: parentRow?.type ?? 'page',
          ancestor_path: b.ancestorPath.slice(0, -1),
          perm_scope_id: page.perm_scope_id,
        },
        { orderKey: b.orderKey },
      )
    } catch (e) {
      if (e instanceof MoveError && e.code === 'too_deep') {
        return { ok: false, reason: 'page_ref_too_deep', pageId: b.id, message: e.message } as const
      }
      throw e
    }
  }

  // 남은 자식 페이지(순서만 바뀐 것)는 임시 키에 있다. 키만 확정한다.
  const updatedIds = new Set(toUpdate.map((b) => b.id))
  for (const b of keyChanges) {
    if (updatedIds.has(b.id) || movedPageIds.has(b.id)) continue
    await tx.query(
      `UPDATE block SET order_key = $3 WHERE id = $1 AND workspace_id = $2`,
      [b.id, ctx.workspaceId, b.orderKey],
    )
  }

  // ── 파일 참조 카운트 ──────────────────────────────────────────────
  //
  // 정본 F-01-15: *"같은 파일을 여러 블록이 참조 → 참조 카운트로 물리 삭제
  // 제어"*, 불변식 FS1: *"`ref_count > 0` 인 객체를 지우지 않는다."*
  //
  // **이 트랜잭션 안에서 한다.** 블록을 넣고 카운트를 나중에 올리면 그 사이에
  // GC 가 도는 순간 방금 붙인 이미지의 바이트가 사라진다.
  //
  // 자식 페이지는 양쪽 모두에서 뺀다. 그 행의 properties 는 그 페이지의
  // 것이고 이 프로젝터가 쓰지 않으므로, 한쪽에만 세면 저장할 때마다 같은 값이
  // 올라가거나 내려간다.
  const before = countFileReferences(scope.filter((r) => r.type !== PAGE_TYPE))
  const after = countFileReferences(
    projection.blocks.filter((b) => b.type !== PAGE_TYPE).map((b) => ({ properties: b.properties })),
  )
  for (const [fileId, delta] of fileReferenceDelta(before, after)) {
    // 워크스페이스로 한정한다 — 다른 워크스페이스의 파일 id 를 문서에 적어
    // 넣어도 그 카운터는 움직이지 않는다(그 이미지는 어차피 보이지 않는다).
    //
    // 내릴 때 `GREATEST(…, 0)` 로 바닥을 둔다. 장부가 어긋났을 때 저장을
    // 실패시키는 쪽이 더 나빠 보이지만 — 사용자는 자기가 쓴 글을 잃고,
    // 얻는 것은 GC 힌트의 정확도뿐이다. 어긋나면 **덜 지우는 쪽**으로
    // 기울게 둔다(FS1 이 지키려는 것이 그 방향이다).
    await tx.query(
      `UPDATE file SET ref_count = GREATEST(ref_count + $3, 0)
        WHERE id = $1 AND workspace_id = $2`,
      [fileId, ctx.workspaceId, delta],
    )
  }

  const wroteSomething =
    toDelete.length > 0 ||
    toInsert.length > 0 ||
    toUpdate.length > 0 ||
    keyChanges.length > 0 ||
    pageRefMoves.length > 0 ||
    // 휴지통으로 보낸 하위 페이지가 있다 — 본문이 보이는 모양이 바뀌었다. 거부 모드는 빠진 것이 있으면 여기까지 오지 않는다.
    missing.length > 0

  // X-6: `block.version` 은 페이지 단위 단조 변경 카운터이고 검색 인덱스의
  // external version 이다. **바뀐 게 없으면 올리지 않는다** — 올리면
  // 인덱서가 같은 내용을 계속 다시 읽는다.
  let version = page.version
  if (wroteSomething) {
    const bumped = await tx.queryOne<{ version: string }>(
      `UPDATE block
          SET version = version + 1, last_edited_by = $2, last_edited_at = now()
        WHERE id = $1
        RETURNING version`,
      [pageId, ctx.userId],
    )
    version = bumped.version
  }

  // ── 검색 색인 ─────────────────────────────────────────────────────
  //
  // W7 / F-07-06. **같은 트랜잭션에서 동기로** 쓴다 — v0 대안이 "트랜잭션 안에서
  // 자동 갱신되므로 파이프라인·지연·정합성 문제가 전부 사라진다"고 한 그 지점이다.
  //
  // `projection.blocks` 를 그대로 쓴다. 방금 쓴 내용이 메모리에 문서 순서로
  // 있으므로 DB 를 다시 읽지 않는다 — 다시 읽으면 같은 사실의 출처가 둘이 되고,
  // 스니펫 순서가 문서 순서와 어긋날 수 있다.
  //
  // **쓰기가 없었어도 쓴다.** 저장이 쓰기 0건인 경우는 문서가 그대로인 경우지만,
  // 색인 텍스트가 비어 있는 경우(마이그레이션 0012 의 백필 행)가 여기 섞인다.
  // 그때 건너뛰면 그 페이지는 한 번도 저장 내용이 바뀌지 않는 한 영원히 검색되지
  // 않는다. 텍스트 UPDATE 1건은 싸다.
  await indexPageText(tx, pageId, {
    title: plainTitleOf(page.properties),
    blocks: projection.blocks,
  })

  // ── 멘션 역인덱스 (F-07-09 · F-05-09) ──────────────────────────────
  //
  // 색인과 같은 자리 · 같은 이유다 — 행의 투영이고(정본 L1), 같은 트랜잭션이어야 "본문에는 있는데 백링크에는 없는"
  // 상태가 없다. 차분이 낸 "처음 멘션된 사람"이 곧 알림 대상이다(L3). 행위자는 `ctx` — 멘션을 넣은 update 는
  // 미루지 않으므로 그 참여자의 세션이 여기까지 온다(`body-write.ts`).
  const edges = await projectLinkEdges(tx, pageId, projection.blocks)
  if (edges.newUserIds.length > 0) {
    await notifyMentions(tx, ctx, { pageId, blockId: edges.firstBlockId, userIds: edges.newUserIds })
  }

  return {
    ok: true,
    version,
    writes: {
      inserted: toInsert.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
      reordered: keyChanges.length,
    },
  } as const
}

/**
 * 투영 결과의 `order_key` 를 점유 키를 피한 값으로 다시 매긴다.
 *
 * `projectDocument` 는 순수 함수라 DB 상태(휴지통 형제의 키)를 모른다.
 * 그 정보는 여기서만 알 수 있으므로 이 단계를 분리했다.
 */
function withReassignedKeys(
  blocks: readonly ProjectedBlock[],
  occupiedByParent: ReadonlyMap<string, ReadonlySet<string>>,
): ProjectedBlock[] {
  if (occupiedByParent.size === 0) return [...blocks]

  const groups = new Map<string, ProjectedBlock[]>()
  for (const b of blocks) {
    const list = groups.get(b.parentId)
    if (list) list.push(b)
    else groups.set(b.parentId, [b])
  }

  const remapped = new Map<string, string>()
  for (const [parentId, siblings] of groups) {
    const occupied = occupiedByParent.get(parentId)
    if (!occupied || occupied.size === 0) continue
    // position 순 = 문서 순서. projectDocument 가 전위 순회로 매긴 값이다.
    const ordered = [...siblings].sort((a, b) => a.position - b.position)
    const keys = assignSiblingKeys(ordered.length, occupied)
    ordered.forEach((b, i) => remapped.set(b.id, keys[i]))
  }

  return blocks.map((b) => {
    const key = remapped.get(b.id)
    return key === undefined ? b : { ...b, orderKey: key }
  })
}

// ── 조회 ──────────────────────────────────────────────────────────────

export type LoadedBody = {
  readonly doc: EditorDoc
  /** 저장 시 `expectedVersion` 으로 되돌려 보낼 값 [X-6]. */
  readonly version: string
  /**
   * 본문의 하위 페이지 참조가 가리키는 페이지의 제목(평문) — **이 사람이 볼 수 있는 것만.** 볼 수 없으면 `null`.
   *
   * 참조 노드는 제목을 싣지 않는다(`rowsToDoc` · `editor/schema.ts`). 부모를 볼 수 있다고 하위 페이지를 볼 수 있는 것이 아니다 —
   * 상속을 끊고 소유자만 남긴 하위 페이지가 그렇다. 목록과 같은 규칙으로 거른다(`perm_scope_id = ANY(readableScopes)`,
   * HANDOFF §3.3-32). 볼 수 없는 참조도 키는 있다 — 참조의 자리는 이미 본문에 보이고(§3.3-74), 화면이 "접근 권한 없음"을 그린다.
   */
  readonly pageRefTitles: Readonly<Record<string, string | null>>
}

/**
 * 페이지 본문을 문서로 읽는다.
 *
 * 빈 페이지는 `blocks: []` 다. 에디터가 빈 문단 하나를 화면에서 합성한다 —
 * 서버가 미리 넣어두면 "한 번도 열지 않은 페이지"와 "열어서 비운 페이지"가
 * 구분되지 않는다.
 */
export async function loadPageBody(
  ctx: SessionContext,
  pageId: BlockId,
): Promise<LoadedBody | null> {
  return withTransaction(async (tx) => {
    const page = await readableLivePage(tx, ctx, pageId)
    if (!page) return null
    const live = (await readScope(tx, ctx, pageId)).filter((r) => r.lifecycle === 'live')
    return { doc: rowsToDoc(pageId, live), version: page.version, pageRefTitles: await pageRefTitlesOf(tx, ctx, live) }
  })
}

/**
 * 본문의 하위 페이지 참조 제목만 — `LoadedBody.pageRefTitles` 와 같은 맵(CRDT 6b조각).
 *
 * 협업 편집기는 본문을 Y.Doc 으로 받으므로 행으로 만든 문서가 필요 없고, 다른 참여자가 만든 · 되살린 · 옮겨 온 참조를 받으면
 * 그 제목을 모른다(`NodeViewDeps.pageRefTitle` 이 `undefined`). 그때 이것을 다시 읽는다. 참조는 넣거나 지운 update 가 곧바로
 * 투영되므로(§3.2-25) 행에 이미 있다. 볼 수 없는 페이지 · 없는 페이지는 null 이다(`loadPageBody` 와 같다).
 */
export async function loadPageRefTitles(
  ctx: SessionContext,
  pageId: BlockId,
): Promise<LoadedBody['pageRefTitles'] | null> {
  return withReadTransaction(async (tx) => {
    if (!(await readableLivePage(tx, ctx, pageId))) return null
    const live = (await readScope(tx, ctx, pageId)).filter((r) => r.lifecycle === 'live')
    return pageRefTitlesOf(tx, ctx, live)
  })
}

/** 볼 수 있는 살아 있는 페이지 — 없거나 볼 수 없으면 null(둘을 가르지 않는다). */
async function readableLivePage(tx: Tx, ctx: SessionContext, pageId: BlockId): Promise<{ version: string } | null> {
  const page = await tx.queryMaybe<{ version: string }>(
    `SELECT version FROM block
      WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
    [pageId, ctx.workspaceId],
  )
  if (!page) return null
  return can(await effectiveCaps(tx, ctx, pageId), 'view') ? page : null
}

/** 범위의 살아 있는 하위 페이지 → 제목(볼 수 없으면 null). 목록과 같은 규칙이다(`LoadedBody.pageRefTitles`). */
async function pageRefTitlesOf(tx: Tx, ctx: SessionContext, live: readonly ScopeRow[]): Promise<LoadedBody['pageRefTitles']> {
  const refs = live.filter((r) => r.type === PAGE_TYPE)
  const readable = new Set(refs.length === 0 ? [] : await readableScopes(tx, ctx))
  return Object.fromEntries(
    refs.map((r) => [r.id, readable.has(r.perm_scope_id) ? plainTitleOf(r.properties as { title?: unknown } | null) : null]),
  )
}
