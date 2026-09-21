/**
 * 페이지 복제 — 복제 6a조각 (F-02-09 · F-08-01 의 복제 엔진)
 *
 * 정본: 02-page-workspace.md F-02-09 · 08-templates-automation.md F-08-01 · 마스터 문서 §5.2-6
 *       판결 X-1(본문 순서의 정본은 Y.Doc) · §3.11(권한 스코프)
 *
 * 서브트리를 통째로 새 id 로 다시 만든다. 템플릿(F-08-01 · F-08-02)이 전부 이 엔진 위에 올라간다 — 08 문서가
 * *"다른 모든 템플릿 기능이 이 복제 엔진 위에 올라간다"* 고 적은 그대로다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 안쪽은 사본을, 바깥은 원본을 가리킨다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 되돌리기 비싼 규칙은 이것 하나다. 규칙 자체는 `duplicate-remap.ts`(DB 를 모르는 모듈)에 있고 여기서는 **무엇이
 * 서브트리 안인가**를 정한다 — 복제한 페이지의 맵이 곧 "안"이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 본문은 Y.Doc 에서 읽어 Y.Doc 으로 쓴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 본문의 정본은 페이지의 Y.Doc 이다(X-1). 행에서 읽으면 협업 서버가 아직 투영하지 않은 편집이 빠진다(투영은 1초 창에서
 * 한 번 · `body-write.ts`). 그래서 원본도 `openPageBody(...).read()` 로 읽고, 사본도 본문 세션으로 쓴다 — 그러면
 * **행 투영 · 검색 색인 · 멘션 역인덱스 · 파일 `ref_count` 가 전부 따라온다**(프로젝터가 하는 일이다). 이미지는
 * 재업로드하지 않고 같은 파일을 가리킨다 — 08 의 권고 *"스토리지 객체 참조 공유(복사 아님)"* 이고, 투영이 새 블록의
 * 참조만큼 `ref_count` 를 올린다.
 *
 * 순서가 중요하다.
 *
 *   ① 원본 서브트리의 페이지 행을 **id 순으로** 잠그고 본문을 읽는다 — 교착을 피하는 한 방향
 *   ② 사본 페이지를 **위에서 아래로** 만든다(`createPageIn`) — 부모가 있어야 자식을 만든다
 *   ③ 사본 본문을 쓴다 — 이 시점에 하위 페이지 사본이 **모두 있으므로** 참조를 담은 문서가 투영을 통과한다
 *
 * ②와 ③을 섞으면 안 된다. 본문을 먼저 쓰면 아직 만들지 않은 사본을 가리키는 참조가 문서에 들어가고, 투영은 그 자리에
 * 페이지가 아닌 새 블록 행을 만들어 버린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 볼 수 없는 하위 페이지는 복제하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 02 F-02-09 의 *"권한 없는 자식 페이지 포함 → 해당 자식은 복제에서 제외"* 다. 사본의 본문에서는 그 참조가 **빠진다**
 * (`remapBody`) — 남의 페이지를 사본의 본문에 매달 수는 없다. 그 하위 페이지의 자손도 함께 빠진다: 부모가 빠졌는데
 * 자손만 복제하면 붙을 자리가 없다.
 *
 * 몇 개가 빠졌는지는 돌려준다(`skipped`) — 화면이 "일부는 복제하지 못했습니다"를 말할 수 있게. 제목은 말하지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 상한 — v1 은 동기 복제다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 08 의 현실적 대안: *"1차는 동기 복제 + 블록 수 상한을 두고, 초과 시 비동기 큐로 넘긴다."* 큐는 아직 없으므로 상한을
 * 넘으면 **거부한다**(`too_large`). 반쯤 복제하고 멈추는 것보다 낫다 — 트랜잭션 하나라 거부하면 아무것도 남지 않는다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { asBlockId, type BlockId } from '../ids.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { wrapUnknownTypes, type EditorDoc } from '../editor/document.ts'
import { createPageIn, readTitle, type PageDetail } from './page.ts'
import { openPageBody, ownerPageOf } from './body-write.ts'
import { duplicateTitle, remapBody } from './duplicate-remap.ts'
import { MAX_TREE_DEPTH, PAGE_TYPE } from './types.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'

/** 한 번에 복제할 수 있는 페이지 수(자기 포함). 넘으면 거부한다 — 비동기 잡은 아직 없다(머리말). */
export const MAX_DUPLICATE_PAGES = 50

/** 한 번에 복제할 수 있는 블록 수(본문 블록 + 하위 페이지). 08 의 "예를 들어 1,000 블록"보다 넉넉히 잡았다. */
export const MAX_DUPLICATE_BLOCKS = 2000

export type DuplicateErrorCode =
  /** 원본이 없거나 다른 워크스페이스거나 휴지통에 있거나 **볼 수 없다**. */
  | 'not_found'
  /** 대상 부모가 없거나 거기에 하위 페이지를 둘 수 없다. */
  | 'target_not_found'
  /** 사본을 **자기 자신 또는 자기 자손 안**에 두려 했다 — 08 의 "새 부모가 복제 대상 서브트리 내부면 거부". */
  | 'cycle'
  /** 복제하면 어딘가가 깊이 상한을 넘는다. */
  | 'too_deep'
  /** 상한을 넘는다(머리말). */
  | 'too_large'

export class DuplicateError extends Error {
  readonly code: DuplicateErrorCode

  constructor(code: DuplicateErrorCode, message: string) {
    super(message)
    this.name = 'DuplicateError'
    this.code = code
  }
}

export type DuplicateOptions = {
  /** 사본을 둘 부모. **생략하면 원본과 같은 자리**다(원본 바로 뒤 형제 · F-02-09). `null` 은 워크스페이스 최상위다. */
  readonly parentPageId?: BlockId | null
  /** 사본의 제목. 생략하면 원본 제목 뒤에 꼬리표를 붙인다(`duplicateTitle`). */
  readonly title?: readonly RichTextRun[]
}

export type DuplicateResult = {
  readonly page: PageDetail
  /** 만든 페이지 수(사본 자신 포함). */
  readonly pages: number
  /** 볼 수 없어서 복제하지 않은 하위 페이지 수(그 자손 포함). */
  readonly skipped: number
}

export type SubtreeRow = {
  id: string
  parent_id: string
  ancestor_path: string[]
  properties: { title?: unknown } | null
  format: Record<string, unknown> | null
}

/**
 * **사본의 뿌리를 만드는 방법** — 이 엔진에서 호출자가 정하는 유일한 것.
 *
 * 페이지를 복제하면 뿌리도 페이지다(`createPageIn`). 그런데 **데이터베이스 템플릿**(F-08-02)의 사본은 페이지가
 * 아니라 **행**이다(`parent_type='data_source'` · `createRowIn` · 제목이 셀이다). 자손 · 본문 · 재매핑 · 권한 ·
 * 상한은 둘이 똑같으므로, 갈라지는 그 한 줄만 주입으로 뽑았다.
 *
 * 뿌리를 만든 **뒤에** 자손을 만든다 — 순서는 엔진이 지킨다(머리말 ②).
 */
export type DuplicateRoot = {
  /** 사본 뿌리가 놓일 자리의 조상 경로 길이. 만들기 **전에** 깊이 상한을 재는 데 쓴다(`0` = 워크스페이스 최상위). */
  readonly depth: number
  /** 사본 뿌리를 만들고 그 id 를 돌려준다. */
  readonly create: (title: readonly RichTextRun[]) => Promise<string>
  /** 사본 뿌리의 제목. 생략하면 원본 제목 뒤에 꼬리표를 붙인다(`duplicateTitle`). */
  readonly title?: readonly RichTextRun[]
  /** 이 id 가 복제 대상 서브트리 **안**이면 거부한다(자기 자신 안으로 복제 · `cycle`). */
  readonly forbidInside?: string | null
  /**
   * 서브트리 말고 **함께 잠글** 행들. 엔진의 잠금과 **한 문장**에서 id 순으로 잠근다.
   *
   * 템플릿이 relation 을 미리 채워 두면 사본도 같은 대상에 엣지를 단다(F-08-02) — 그 대상 행들이 여기 온다.
   * 따로 잠그면 잠금 획득이 두 번이 되어, 같은 행들을 id 순으로 한 번에 잠그는 `linkRows` 와 **교착**할 수 있다.
   */
  readonly alsoLock?: readonly string[]
}

export type SubtreeCopy = {
  readonly rootId: string
  /** 만든 페이지 수(사본 뿌리 포함). */
  readonly pages: number
  /** 볼 수 없어서 복제하지 않은 하위 페이지 수(그 자손 포함). */
  readonly skipped: number
}

export async function duplicatePage(
  ctx: SessionContext,
  pageId: BlockId,
  options: DuplicateOptions = {},
): Promise<DuplicateResult> {
  return withTransaction(async (tx) => {
    const source = await tx.queryMaybe<SubtreeRow & { parent_type: string }>(
      `SELECT id, parent_type, parent_id, ancestor_path, properties, format
         FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    // 볼 수 없는 페이지는 없는 페이지와 같다(§3.3-31).
    if (source === null || !can(await effectiveCaps(tx, ctx, pageId), 'view')) {
      throw new DuplicateError('not_found', '페이지를 찾을 수 없습니다.')
    }

    // ── 어디에 둘까 ──
    // 생략하면 원본과 같은 자리다. 원본의 부모는 본문 안의 블록일 수 있으므로(토글 안의 하위 페이지) 그 블록을 가진
    // **페이지**를 찾는다 — 사본의 참조는 그 본문에 들어간다.
    const sameParent = options.parentPageId === undefined
    const targetParentId = sameParent
      ? source.parent_type === 'block'
        ? await ownerPageOf(tx, ctx, source.parent_id)
        : null
      : options.parentPageId
    // teamspace 의 최상위 페이지를 같은 자리에 복제하면 사본도 그 teamspace 의 최상위다(7c-1). 전에는 부모가 블록이
    // 아니면 워크스페이스 직속으로 보냈다 — teamspace 가 없던 때는 그것이 같은 자리였다.
    const targetTeamspaceId = sameParent && source.parent_type === 'teamspace' ? source.parent_id : null

    // 깊이는 **만들기 전에** 잰다 — 대상 부모가 없으면 여기서 걸린다.
    let rootDepth = 0
    if (targetParentId !== null) {
      const parent = await tx.queryMaybe<{ ancestor_path: string[] }>(
        `SELECT ancestor_path FROM block WHERE id = $1 AND workspace_id = $2 AND type = $3 AND lifecycle = 'live'`,
        [targetParentId, ctx.workspaceId, PAGE_TYPE],
      )
      if (parent === null) throw new DuplicateError('target_not_found', '복제할 위치를 찾을 수 없습니다.')
      rootDepth = parent.ancestor_path.length + 1
    }

    let root: PageDetail | null = null
    const copied = await duplicateSubtree(tx, ctx, source, {
      depth: rootDepth,
      forbidInside: targetParentId,
      ...(options.title === undefined ? {} : { title: options.title }),
      create: async (title) => {
        const created = await createPageIn(tx, ctx, {
          parentPageId: targetParentId === null ? null : asBlockId(targetParentId),
          teamspaceId: targetTeamspaceId,
          title,
          // 사본은 원본 **바로 뒤**에 선다 — 같은 자리에 복제할 때만(F-02-09). 자식은 본문이 자리를 정하므로 맨 뒤여도 된다.
          ...(sameParent && targetParentId !== null ? { at: pageId } : {}),
        }).catch(rethrowAsDuplicate)
        root = created
        return created.id
      },
    })
    if (root === null) throw new Error(`복제할 원본이 서브트리에 없다: ${pageId}`)

    return { page: root, pages: copied.pages, skipped: copied.skipped }
  })
}

/**
 * 복제의 안쪽 — **뿌리를 만드는 방법만 호출자가 정한다**(`DuplicateRoot`).
 *
 * 순서 세 단계(머리말)가 여기에 있다. 트랜잭션 안쪽이므로 부르는 쪽이 커밋을 쥔다 — 템플릿으로 행을 만드는 명령은
 * 셀 쓰기 · 엣지 쓰기를 **같은 트랜잭션**에서 이어 한다(F-08-02).
 */
export async function duplicateSubtree(
  tx: Tx,
  ctx: SessionContext,
  source: SubtreeRow,
  root: DuplicateRoot,
): Promise<SubtreeCopy> {
  // ── 서브트리 ──
  const { subtree, totalPages } = await readSubtree(tx, ctx, source)
  const copies = new Map<string, string>(subtree.map((row) => [row.id, randomUUID()]))
  if (root.forbidInside != null && copies.has(root.forbidInside)) {
    throw new DuplicateError('cycle', '페이지를 자기 자신 안으로 복제할 수 없습니다.')
  }

  const blocks = await countBlocks(tx, ctx, subtree)
  if (subtree.length > MAX_DUPLICATE_PAGES || blocks > MAX_DUPLICATE_BLOCKS) {
    throw new DuplicateError(
      'too_large',
      `한 번에 복제할 수 있는 크기를 넘었습니다(페이지 ${MAX_DUPLICATE_PAGES}개 · 블록 ${MAX_DUPLICATE_BLOCKS}개).`,
    )
  }
  const height = Math.max(...subtree.map((r) => r.ancestor_path.length)) - source.ancestor_path.length
  if (root.depth + height + 1 > MAX_TREE_DEPTH) {
    throw new DuplicateError('too_deep', `페이지 깊이가 상한(${MAX_TREE_DEPTH})에 도달했습니다.`)
  }

  // ── ① 원본 본문을 id 순으로 잠그고 읽는다(머리말) ──
  // `ORDER BY id` 가 잠그는 **순서**를 정한다 — 배열만 정렬해 넘기면 Postgres 가 그 순서로 잠근다는 보장이 없다.
  // 함께 잠글 행(`alsoLock` — relation 대상)도 같은 문장에 넣는다: 잠금 획득이 둘이면 그 사이에 끼어든
  // `linkRows` 와 교착할 수 있다.
  const ordered = [...subtree].sort((a, b) => (a.id < b.id ? -1 : 1))
  await tx.query(`SELECT id FROM block WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [
    [...new Set([...ordered.map((r) => r.id), ...(root.alsoLock ?? [])])],
  ])
  const bodies = new Map<string, EditorDoc>()
  for (const row of ordered) {
    bodies.set(row.id, (await openPageBody(tx, ctx, row.id)).read())
  }

  // ── ② 사본을 위에서 아래로 만든다 ──
  const byDepth = [...subtree].sort((a, b) => a.ancestor_path.length - b.ancestor_path.length)
  let rootId: string | null = null
  for (const row of byDepth) {
    const isRoot = row.id === source.id
    const title = isRoot ? (root.title ?? duplicateTitle(readTitle(row.properties))) : readTitle(row.properties)
    const created = isRoot
      ? await root.create(title)
      : (
          await createPageIn(tx, ctx, {
            parentPageId: asBlockId(parentCopyOf(row, copies)),
            title,
          }).catch(rethrowAsDuplicate)
        ).id
    // 사본의 id 는 만든 쪽이 정한다 — 미리 잡아 둔 자리를 그것으로 바꾼다.
    copies.set(row.id, created)
    if (isRoot) rootId = created
    // 아이콘 · 커버는 제목과 달리 `format` 에 있다. 사본은 원본과 같은 모습이어야 한다.
    if (row.format !== null && Object.keys(row.format).length > 0) {
      await tx.query(`UPDATE block SET format = $2::jsonb WHERE id = $1`, [created, JSON.stringify(row.format)])
    }
  }
  if (rootId === null) throw new Error(`복제할 원본이 서브트리에 없다: ${source.id}`)

  // ── ③ 사본 본문을 쓴다 ──
  for (const row of byDepth) {
    const body = bodies.get(row.id)
    if (body === undefined) continue
    const remapped = remapBody(body, copies, randomUUID)
    // 빈 본문에 빈 문서를 쓰면 바뀌는 것이 없다 — 세션을 열 이유도 없다.
    if (remapped.blocks.length === 0) continue
    const write = await openPageBody(tx, ctx, copies.get(row.id) as string)
    const next = docToPm(wrapUnknownTypes(remapped))
    write.change((tr) => {
      tr.replaceWith(0, tr.doc.content.size, next.content)
    })
    const result = await write.finish()
    if (!result.ok) {
      if (result.reason === 'page_ref_too_deep') {
        throw new DuplicateError('too_deep', `페이지 깊이가 상한(${MAX_TREE_DEPTH})에 도달했습니다.`)
      }
      throw new Error(`사본 본문의 투영이 거부됐다(${result.reason}): ${copies.get(row.id)}`)
    }
  }

  return { rootId, pages: subtree.length, skipped: totalPages - subtree.length }
}

/** 이 행의 부모 **페이지**의 사본. 부모가 본문 안의 블록이면 조상 경로에서 가장 가까운 복제 대상이 부모다. */
function parentCopyOf(row: SubtreeRow, copies: ReadonlyMap<string, string>): string {
  const direct = copies.get(row.parent_id)
  if (direct !== undefined) return direct
  for (let i = row.ancestor_path.length - 1; i >= 0; i -= 1) {
    const copy = copies.get(row.ancestor_path[i])
    if (copy !== undefined) return copy
  }
  throw new Error(`복제 대상의 부모를 찾지 못했다: ${row.id}`)
}

function rethrowAsDuplicate(error: unknown): never {
  // `createPageIn` 은 자기 어휘로 던진다(`PageError`). 부모를 못 찾는 것과 깊이는 복제의 말로 바꿔 준다.
  const code = (error as { code?: unknown }).code
  if (code === 'parent_not_found') throw new DuplicateError('target_not_found', '복제할 위치를 찾을 수 없습니다.')
  if (code === 'too_deep') throw new DuplicateError('too_deep', `페이지 깊이가 상한(${MAX_TREE_DEPTH})에 도달했습니다.`)
  throw error
}

/**
 * 복제할 페이지들 — 원본과 그 **볼 수 있는** 자손. 부모가 빠지면 자손도 빠진다(머리말).
 *
 * 목록 필터와 같은 축으로 거른다(`readableScopes` · §3.3-32) — 노드마다 판정하지 않는다.
 */
async function readSubtree(
  tx: Tx,
  ctx: SessionContext,
  source: SubtreeRow,
): Promise<{ subtree: SubtreeRow[]; totalPages: number }> {
  // 권한을 **걸지 않고** 먼저 읽는다 — 누가 누구의 부모인지는 볼 수 없는 페이지까지 알아야 정해진다(아래).
  // 제목 · 내용은 읽지 않는다: 여기서 쓰는 것은 구조와 "볼 수 있는가"뿐이다.
  const rows = await tx.query<SubtreeRow & { readable: boolean }>(
    `SELECT id, parent_id, ancestor_path, properties, format,
            (perm_scope_id = ANY($4::uuid[])) AS readable
       FROM block
      WHERE workspace_id = $1 AND type = $2 AND lifecycle = 'live'
        AND ancestor_path @> ARRAY[$3]::uuid[]
      ORDER BY array_length(ancestor_path, 1), order_key COLLATE "C"`,
    [ctx.workspaceId, PAGE_TYPE, source.id, await readableScopes(tx, ctx)],
  )

  // ★ **바로 위 페이지**가 빠지면 함께 빠진다. "조상 중 하나라도 남았으면 남긴다"로 쓰면, 볼 수 없는 부모 아래의 볼 수
  //   있는 손자가 **조부모의 사본에 붙는다** — 원본에 없던 부모-자식이 생기고, 그 사본의 본문에는 그 참조가 없어
  //   투영이 거부한다(반사실이 이 자리를 짚었다).
  const inSubtree = new Set<string>([source.id, ...rows.map((r) => r.id)])
  const kept = new Map<string, SubtreeRow>([[source.id, source]])
  for (const row of rows) {
    if (!row.readable) continue
    const parentPage = [...row.ancestor_path].reverse().find((id) => inSubtree.has(id))
    if (parentPage !== undefined && kept.has(parentPage)) kept.set(row.id, row)
  }
  // 빠진 수는 여기서 바로 나온다 — 다시 세지 않는다(제목은 읽지 않았다 · 개수만 말한다).
  return { subtree: [...kept.values()], totalPages: rows.length + 1 }
}

/** 서브트리의 살아 있는 블록 수 — 본문 블록까지. 상한 검사용이라 세기만 한다. */
async function countBlocks(tx: Tx, ctx: SessionContext, subtree: readonly SubtreeRow[]): Promise<number> {
  const counted = await tx.queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM block
      WHERE workspace_id = $1 AND lifecycle = 'live' AND ancestor_path && $2::uuid[]`,
    [ctx.workspaceId, subtree.map((r) => r.id)],
  )
  return Number(counted.n)
}
