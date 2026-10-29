/**
 * 공개 화면의 읽기 — 토큰으로 연 페이지의 제목 · 본문 · 열 수 있는 링크 (게시 · 공유 6a-2a · F-06-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ①~④ · [정정] 웹 게시 ③
 *       마스터 §5.3 *"공개 렌더러는 앱 렌더러와 분리된 읽기 전용 SSR. 내부 조회 함수 재사용 금지"*
 *
 * `SessionContext` 가 없다 — 판정은 `resolvePublicPageIn` 하나이고, 같은 스냅샷에서 이 파일의 질의로 읽는다. 앱의 조회 함수(페이지 ·
 * 본문 · 권한)는 부르지 않는다. 함께 쓰는 것은 순수 부품뿐이다(`rowsToDoc` · `readTitle` · 아이콘 읽기).
 *
 * 공개 밖을 가리킨 것은 **이 파일에서** 걸러진다 — 화면은 받은 지도(`pages`)에 없는 페이지를 그리지 않는다:
 *   · 하위 페이지 참조 — 열 수 없는 것은 문서에서 뺀다
 *   · 페이지 멘션 — 열 수 없는 것은 지도에 없다(화면이 "비공개 페이지"로 가린다 · 제목을 싣지 않는다)
 *   · 사람 멘션 — 이 워크스페이스의 사람만 이름을 준다(멘션의 id 는 저장된 값이다 — 밖의 사람 이름을 조회하는 길로 쓰이지 않게)
 */

import { readTitle } from '../block/page.ts'
import { pageIconOfFormat, readPageIcon, type PageIcon } from '../block/page-icon.ts'
import { cellsOf } from '../block/table.ts'
import { codeCaptionRuns } from '../block/code.ts'
import { DATABASE_TYPE, PAGE_TYPE, isRefType } from '../block/types.ts'
import { customEmojiIdOfRun, mentionTarget, type RichTextRun } from '../contracts/rich-text.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { rowsToDoc, type BodyRow, type EditorBlock, type EditorDoc } from '../editor/document.ts'
import { openablePagesIn, resolvePublicPageIn, type PublicAccessFailure, type PublicTarget } from './public-access.ts'
import { publicTableOf, readPublicRowPropertiesIn, readPublicTableIn, type PublicRowProperties, type PublicTable } from './public-database.ts'
import { resolveSiteTokenIn, siteBasePath } from './site.ts'

/** 공개 화면 하나를 그릴 재료. */
export type PublicPageView = {
  readonly token: string
  /**
   * 화면 안의 링크가 붙는 기준 경로 — 토큰 주소면 `/p/{token}`, 사이트 주소로 열었으면 `/s/{주소}/{슬러그}`(6c-1 · 정본 [보강] 사이트 주소
   * ⑤). 루트는 이 경로 그대로, 하위는 `{기준}/{pageId}`.
   */
  readonly base: string
  readonly target: PublicTarget
  readonly title: readonly RichTextRun[]
  /** 페이지 아이콘 — 이모지 · 이미지(파일이면 공개 파일 경로로 · 6a-2b). */
  readonly icon: PageIcon | null
  readonly doc: EditorDoc
  /** 이 토큰으로 열 수 있는 페이지의 제목 — 사슬 · 하위 페이지 참조 · 페이지 멘션. **없는 id 는 열 수 없다**(가린다). */
  readonly pages: ReadonlyMap<string, readonly RichTextRun[]>
  /** 멘션된 이 워크스페이스 사람의 이름. */
  readonly people: ReadonlyMap<string, string>
  /**
   * 문서(본문 · 페이지 제목)에 나오는 커스텀 이모지의 이름(7c-3c) — id(소문자) → `{ name, deleted }`. 지운 것도 이름을 준다(`:이름:`
   * 글자로 그린다). 이 워크스페이스에 없는 id 는 없다(그리지 않는다). 정본 §3.4 [보강] 커스텀 이모지 ⑨.
   */
  readonly emoji: ReadonlyMap<string, { readonly name: string; readonly deleted: boolean }>
  /** 게시된 데이터베이스를 여는 화면이면 그 표(6a-2c-2 — 본문 대신). 아니면 null. */
  /**
   * 본문 안의 인라인 데이터베이스(I-4b)마다 그 공개 표 — 열 수 있는 것만(없는 id 의 참조는 이미 문서에서 뺐다). 이름은 `pages` 에 있다.
   */
  readonly databases: ReadonlyMap<string, PublicTable>
  readonly table: PublicTable | null
  /** 연 페이지가 데이터베이스의 행이면 그 속성 묶음(6a-2c-2 — 제목 아래). 아니면 null. */
  readonly rowProperties: PublicRowProperties | null
}

export type PublicRead =
  | { readonly ok: true; readonly value: PublicPageView }
  | { readonly ok: false; readonly reason: PublicAccessFailure }

type ScopeRow = BodyRow & { lifecycle: string }

/** 토큰(과 하위 페이지 id)으로 공개 화면의 재료를 읽는다 — 판정과 같은 스냅샷에서. */
export async function readPublicPage(token: string, pageId?: string, options: { readonly base?: string } = {}): Promise<PublicRead> {
  return withReadTransaction(async (tx) => {
    const access = await resolvePublicPageIn(tx, token, pageId)
    if (!access.ok) return access
    const target = access.value

    const page = await tx.queryOne<{ type: string; properties: Record<string, unknown> | null; format: Record<string, unknown> | null }>(
      `SELECT type, properties, format FROM block WHERE id = $1`,
      [target.pageId],
    )
    // 게시된 데이터베이스(6a-2c-2) — 본문이 없고 표다. 아이콘은 데이터베이스의 칸(`database.icon` · 8c-3b)이다.
    const isDatabase = page.type === 'database'
    const databaseIcon = isDatabase
      ? readPageIcon((await tx.queryMaybe<{ icon: unknown }>(`SELECT icon FROM database WHERE id = $1`, [target.pageId]))?.icon ?? null)
      : null
    const scope = isDatabase ? [] : await readScope(tx, target.workspaceId, target.pageId)

    // 하위 페이지 · 인라인 데이터베이스(I-4b) 참조 · 페이지 멘션 중 이 토큰으로 열 수 있는 것
    const refIds = scope.filter((row) => isRefType(row.type)).map((row) => row.id)
    const draft = rowsToDoc(target.pageId, scope.filter((row) => row.lifecycle === 'live'))
    const mentions = mentionsOf(draft.blocks)
    const openable = await openablePagesIn(tx, target.workspaceId, target.rootId, [...refIds, ...mentions.pages])
    const doc: EditorDoc = { blocks: withoutClosedRefs(draft.blocks, openable) }
    // 본문 안의 인라인 데이터베이스(I-4b) — 열 수 있는 것마다 공개 표(공개 표와 같은 규칙 · 서버가 한 번에 그린다)
    const inlineDatabases = new Map<string, PublicTable>()
    for (const row of scope) {
      if (row.type === DATABASE_TYPE && row.lifecycle === 'live' && openable.has(row.id)) inlineDatabases.set(row.id, await publicTableOf(tx, row.id))
    }

    const titled = [...new Set([...target.chain, ...openable])]
    const titles = await tx.query<{ id: string; properties: Record<string, unknown> | null }>(
      `SELECT id, properties FROM block WHERE id = ANY($1::uuid[])`,
      [titled],
    )
    const emojiIds = [...new Set([...mentions.emoji, ...emojiIdsOf(readTitle(page.properties))])]
    const emoji =
      emojiIds.length === 0
        ? []
        : await tx.query<{ id: string; name: string; deleted: boolean }>(
            `SELECT id, name, deleted_at IS NOT NULL AS deleted FROM custom_emoji WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
            [target.workspaceId, emojiIds],
          )
    const people =
      mentions.people.length === 0
        ? []
        : await tx.query<{ id: string; name: string }>(
            `SELECT u.id, u.name FROM "user" u
               JOIN workspace_member m ON m.user_id = u.id AND m.workspace_id = $2
              WHERE u.id = ANY($1::uuid[])`,
            [mentions.people, target.workspaceId],
          )

    return {
      ok: true,
      value: {
        token,
        base: options.base ?? `/p/${token}`,
        target,
        title: readTitle(page.properties),
        icon: await liveIconIn(tx, target.workspaceId, isDatabase ? databaseIcon : pageIconOfFormat(page.format)),
        doc,
        pages: new Map(titles.map((row) => [row.id, readTitle(row.properties)])),
        people: new Map(people.map((row) => [row.id, row.name])),
        emoji: new Map(emoji.map((row) => [row.id, { name: row.name, deleted: row.deleted }])),
        table: isDatabase ? await readPublicTableIn(tx, target) : null,
        databases: inlineDatabases,
        rowProperties: isDatabase ? null : await readPublicRowPropertiesIn(tx, target),
      },
    } as const
  })
}

/**
 * 공개 화면에 세울 아이콘 — 지운 커스텀 이모지(7c-2a)는 없는 것으로 내린다. 앱은 그림이 못 오면 클라이언트 부품이 기본 글리프로
 * 바꾸지만(`page-icon-image.tsx`) 공개 화면은 서버가 그린 `<img>` 뿐이라 깨진 그림이 선다 — 판정을 서버로 당긴다(정본 [보강] 커스텀
 * 이모지 ⑤ · 공개 파일 경로도 살아 있는 것만 준다).
 */
async function liveIconIn(tx: Tx, workspaceId: string, icon: PageIcon | null): Promise<PageIcon | null> {
  if (icon?.type !== 'custom_emoji') return icon
  const live = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM custom_emoji WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [icon.custom_emoji.id, workspaceId],
  )
  return live === null ? null : icon
}

/**
 * 이 페이지의 문서 범위 — 재귀가 페이지에서 멈춘다(자식 페이지의 본문은 그 페이지의 것). 앱의 본문 읽기와 같은 규칙을 이 파일의 질의로
 * 쓴다(머리말 — 앱의 조회 함수를 부르지 않는다).
 */
async function readScope(tx: Tx, workspaceId: string, pageId: string): Promise<ScopeRow[]> {
  return tx.query<ScopeRow>(
    `WITH RECURSIVE doc_scope AS (
         SELECT b.id, b.type, b.parent_id, b.order_key, b.properties, b.format, b.lifecycle
           FROM block b
          WHERE b.parent_id = $1 AND b.workspace_id = $2 AND b.parent_type = 'block'
       UNION ALL
         SELECT c.id, c.type, c.parent_id, c.order_key, c.properties, c.format, c.lifecycle
           FROM block c
           JOIN doc_scope s ON c.parent_id = s.id
          WHERE s.type <> $3 AND c.workspace_id = $2 AND c.parent_type = 'block'
     )
     SELECT * FROM doc_scope`,
    [pageId, workspaceId, PAGE_TYPE],
  )
}

/** 열 수 없는 하위 페이지 · 인라인 데이터베이스 참조를 뺀다 — 자식까지(참조는 자식이 없지만 계약 밖의 값에도 안전하게). */
function withoutClosedRefs(blocks: readonly EditorBlock[], openable: ReadonlySet<string>): EditorBlock[] {
  return blocks
    .filter((block) => !isRefType(block.type) || openable.has(block.id))
    .map((block) => (block.children && block.children.length > 0 ? { ...block, children: withoutClosedRefs(block.children, openable) } : block))
}

/** 문서의 모든 글자(제목 · 표 셀 · 코드 캡션)에서 멘션의 대상을 모은다. */
/** 런들에 나오는 커스텀 이모지 id(소문자) — 7c-3c. */
function emojiIdsOf(runs: readonly RichTextRun[]): string[] {
  return runs.map(customEmojiIdOfRun).filter((id): id is string => id !== null).map((id) => id.toLowerCase())
}

function mentionsOf(blocks: readonly EditorBlock[]): { pages: string[]; people: string[]; emoji: string[] } {
  const pages = new Set<string>()
  const people = new Set<string>()
  const emoji = new Set<string>()
  const visitRuns = (runs: readonly RichTextRun[]): void => {
    for (const id of emojiIdsOf(runs)) emoji.add(id)
    for (const run of runs) {
      const target = mentionTarget(run)
      if (target?.kind === 'page') pages.add(target.id)
      else if (target?.kind === 'user') people.add(target.id)
    }
  }
  const visit = (block: EditorBlock): void => {
    visitRuns(block.title ?? [])
    const properties = (block.properties ?? {}) as Record<string, unknown>
    for (const cell of cellsOf(properties)) visitRuns(cell)
    visitRuns(codeCaptionRuns(properties))
    for (const child of block.children ?? []) visit(child)
  }
  for (const block of blocks) visit(block)
  return { pages: [...pages], people: [...people], emoji: [...emoji] }
}

/**
 * 사이트 주소로 연다(6c-1 · 정본 [보강] 사이트 주소 ②) — 주소 → 그 링크의 토큰 → 토큰과 같은 판정 · 같은 읽기. 화면 안의 링크는 사이트
 * 주소로 만든다(⑤). 없거나 해제됐으면 `not_found`(이유를 말하지 않는다).
 */
export async function readSitePage(domain: string, slug: string, pageId?: string): Promise<PublicRead> {
  const token = await withReadTransaction((tx) => resolveSiteTokenIn(tx, domain, slug))
  if (token === null) return { ok: false, reason: 'not_found' }
  return readPublicPage(token, pageId, { base: siteBasePath(domain, slug) })
}
