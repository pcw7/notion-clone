/**
 * 사이드바 페이지 트리 — F-02-03 / F-07-16
 *
 * 정본: 02-page-workspace.md F-02-03, 07-search-navigation.md F-07-16
 *
 * ──────────────────────────────────────────────────────────────────────
 * 본문은 절대 싣지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-02-03 데이터 모델 함의: *"아이콘·제목·`has_children` 만 반환하고 본문은
 * 절대 싣지 않는다(**사이드바가 페이지 본문을 끌고 오면 즉시 성능이 무너진다**)."*
 * 그래서 `properties` 에서 제목만 꺼내고 나머지는 버린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 트리의 부모는 `parent_id` 가 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * PR #23 이후 하위 페이지는 **본문 블록 안에 중첩될 수 있다**(토글 안의 하위
 * 페이지). 그때 `parent_id` 는 토글이고, 토글은 페이지가 아니다. `parent_id`
 * 로 트리를 엮으면 그 페이지가 **사이드바에서 통째로 사라진다** — 부모를 찾지
 * 못해 고아가 되기 때문이다.
 *
 * 사이드바가 보여줘야 하는 것은 **페이지 계층**이므로, 트리의 부모는
 * `ancestor_path` 상의 **가장 가까운 페이지 조상**이다. 그 계산은 순수 함수라
 * DB 없이 테스트한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * MVP 범위
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-02-03 클론 대안: *"MVP는 가상화 없이 **전체 트리 일괄 로드**(페이지 500개
 * 이하 가정)."* 그대로 한다. 레벨별 지연 로드(`?parent_id=&limit=`)로 바꿀 때
 * 필요한 것은 `hasChildren` 를 SQL 에서 계산하는 것뿐이고, 지금은 전체를
 * 들고 있으므로 트리에서 파생한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 노드는 자기 teamspace 를 싣는다 (7c-2)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 사이드바의 Teamspaces 섹션은 **파생 뷰**다(F-07-16: "섹션 = 권한 상태의 파생 뷰이지
 * 저장된 분류가 아니다"). 트리는 여기서 한 벌로 엮고, 레이아웃이 루트를 teamspace 별로
 * 가른다(`groupRootsByTeamspace`). 그러려면 루트가 어느 teamspace 의 것인지 알아야 한다.
 * 가르기는 서버에서 한다 — 화면에는 내가 멤버인 teamspace 의 id 만 간다.
 *
 * teamspace 는 `ancestor_path` 에 없다(판결문 C-9 · HANDOFF §3.3-189) — 어느 노드의
 * teamspace 는 **루트 블록의 부모**다. 판정(`effective.ts` 의 `ChainRow`)과 같은 방법으로
 * 같은 질의에서 루트를 붙여 읽는다. 한 서브트리의 노드는 루트가 같으므로 teamspace 도 같다.
 *
 * Shared · Private 섹션(7c-7)도 같은 자리에서 가른다 — 판결문 C-9: *"Private/Teamspace/Shared 를 `parent_type` +
 * `owner_user_id` 로"*. 루트 블록이 워크스페이스 부모이고 주인이 나면 **개인 페이지**, 주인이 남이면 **공유됨**(그
 * 사람이 따로 줬을 때만 보인다), 주인이 없으면 **워크스페이스 페이지**다. 그리고 트리를 엮고 나서야 아는 종류가
 * 하나 있다 — 조상이 보이지 않아 **트리 중간에서 루트가 된 노드**(따로 공유받은 하위 페이지)도 공유됨이다. 화면에는
 * 주인의 id 를 보내지 않는다(`rootKind` 는 세 값뿐이다 — `SidebarNode` 의 규칙과 같다 · §3.3-192).
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { asBlockId } from '../ids.ts'
import { withReadTransaction } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'

/**
 * 트리에 서는 블록의 종류. 풀페이지 데이터베이스도 사이드바의 한 줄이다(F-04-14:
 * *"풀페이지: 페이지 전체가 데이터베이스이며 … 사이드바 항목명도 동일 폴백"*).
 * 화면은 이것으로 링크를 고른다 — 데이터베이스는 페이지 라우트로 열 수 없다.
 */
export type PageTreeKind = 'page' | 'database'

/** 트리를 엮는 데 필요한 최소 정보. 본문은 없다. */
export type PageTreeRow = {
  readonly id: string
  readonly title: string
  readonly kind: PageTreeKind
  /** 루트→부모까지의 **블록** id. 본문 블록도 들어 있다 [X-7]. */
  readonly ancestorPath: readonly string[]
  readonly orderKey: string
  /** 루트 블록의 부모가 teamspace 면 그 id, 워크스페이스 직속이면 null. */
  readonly teamspaceId: string | null
  /** 루트 블록이 워크스페이스 부모일 때 — 공용 · 내 개인 · 남의 개인(7c-7). teamspace 면 null. */
  readonly rootKind: RootKind | null
}

/** 워크스페이스 부모 루트의 세 종류. 주인의 id 는 화면에 보내지 않는다 — 종류만 싣는다. */
export type RootKind = 'workspace' | 'private_mine' | 'private_other'

export type PageTreeNode = {
  readonly id: BlockId
  readonly title: string
  readonly kind: PageTreeKind
  /** 이 노드가 속한 teamspace — 루트 블록의 부모. 워크스페이스 직속 서브트리면 null. */
  readonly teamspaceId: string | null
  /** 루트 블록이 워크스페이스 부모일 때의 종류(7c-7). teamspace 서브트리면 null. */
  readonly rootKind: RootKind | null
  /** 진짜 최상위인가 — `ancestor_path` 가 비어 있다. 트리 중간에서 루트가 된 노드(공유받은 하위 페이지)를 가른다. */
  readonly trueRoot: boolean
  /** 트리상의 부모(가장 가까운 페이지 조상). 최상위면 null. */
  readonly parentId: BlockId | null
  readonly hasChildren: boolean
  readonly children: PageTreeNode[]
}

/**
 * 평평한 행 목록을 페이지 트리로 엮는다. **순수 함수.**
 *
 * 부모는 `ancestorPath` 를 **뒤에서부터** 훑어 처음 만나는 페이지다. 본문
 * 블록(토글 등)은 페이지 집합에 없으므로 자연히 건너뛴다.
 *
 * 형제 정렬은 `order_key, id` 다(B7). ⚠ 본문 안에 중첩된 하위 페이지는
 * `order_key` 가 **다른 형제 이름공간**(그 토글의 자식들)에 속하므로, 페이지
 * 직속 형제들과 섞였을 때 순서가 본문에 보이는 순서와 다를 수 있다. 결정적이긴
 * 하다. 본문 순서까지 맞추려면 페이지가 아니라 블록 트리 전체를 읽어야 하고,
 * 그건 "본문을 싣지 않는다"와 정면으로 충돌한다.
 */
export function buildPageTree(rows: readonly PageTreeRow[]): PageTreeNode[] {
  const pageIds = new Set(rows.map((r) => r.id))

  const nearestPageAncestor = (row: PageTreeRow): string | null => {
    for (let i = row.ancestorPath.length - 1; i >= 0; i -= 1) {
      const candidate = row.ancestorPath[i]
      if (pageIds.has(candidate)) return candidate
    }
    return null
  }

  // 조립하는 동안은 가변으로 다룬다. 밖으로 나갈 때 readonly 타입이 씌워진다 —
  // 캐스팅으로 readonly 를 뚫는 것보다 이쪽이 읽기 쉽다.
  type Building = {
    id: BlockId
    title: string
    kind: PageTreeKind
    teamspaceId: string | null
    rootKind: RootKind | null
    trueRoot: boolean
    parentId: BlockId | null
    hasChildren: boolean
    children: Building[]
  }

  // 정렬 키는 **노드 밖에** 둔다. 노드에 얹으면 `PageTreeNode` 에 선언하지 않은
  // 필드가 런타임에 남아 클라이언트까지 직렬화된다(테스트가 실제로 잡았다).
  const orderKeyById = new Map<string, string>(rows.map((r) => [r.id, r.orderKey]))

  const nodes = new Map<string, Building>(
    rows.map((row) => [
      row.id,
      {
        id: asBlockId(row.id),
        title: row.title,
        kind: row.kind,
        teamspaceId: row.teamspaceId,
        rootKind: row.rootKind,
        trueRoot: row.ancestorPath.length === 0,
        parentId: null,
        hasChildren: false,
        children: [],
      },
    ]),
  )

  const roots: Building[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)
    if (!node) continue

    const parentId = nearestPageAncestor(row)
    const parent = parentId === null ? null : nodes.get(parentId)
    if (parent) {
      node.parentId = asBlockId(parentId as string)
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const finish = (list: Building[]): void => {
    list.sort((a, b) => {
      const ka = orderKeyById.get(a.id) ?? ''
      const kb = orderKeyById.get(b.id) ?? ''
      if (ka !== kb) return ka < kb ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    for (const node of list) {
      node.hasChildren = node.children.length > 0
      finish(node.children)
    }
  }
  finish(roots)

  return roots
}

/**
 * 루트를 사이드바의 섹션으로 가른다 — Teamspaces · 공유됨 · 개인 페이지 · 워크스페이스 페이지(7c-2 · 7c-7 · F-07-16).
 * **순수 함수.**
 *
 * `teamspaces` 는 **내가 멤버인** teamspace 다(`listMyTeamspaces` — 그 순서 그대로 선다). 페이지가 없어도 선다 — 그 자리의
 * `+` 가 첫 페이지를 만든다. 나머지는 판결문 C-9 의 정의대로 간다:
 *
 *   · **개인 페이지** — 루트가 내 개인 최상위(`private_mine`)
 *   · **공유됨** — 남의 개인 최상위(`private_other`), 멤버가 아닌 teamspace 의 페이지(묶어 세우면 그 teamspace 의
 *     존재가 드러난다 — 낱개로 선다 · §3.3-192), 그리고 조상이 보이지 않아 **트리 중간에서 루트가 된** 페이지(따로
 *     공유받은 하위 페이지 — 진짜 루트는 공용이어도 내 눈에는 조각이다)
 *   · **워크스페이스 페이지** — 진짜 최상위이고 주인이 없는 루트
 */
export function groupSidebarRoots<T extends { readonly id: string }>(
  roots: readonly PageTreeNode[],
  teamspaces: readonly T[],
): {
  teamspaces: { teamspace: T; pages: PageTreeNode[] }[]
  privatePages: PageTreeNode[]
  shared: PageTreeNode[]
  workspacePages: PageTreeNode[]
} {
  const byId = new Map(teamspaces.map((t) => [t.id, [] as PageTreeNode[]]))
  const privatePages: PageTreeNode[] = []
  const shared: PageTreeNode[] = []
  const workspacePages: PageTreeNode[] = []
  for (const root of roots) {
    if (root.teamspaceId !== null) {
      const bucket = byId.get(root.teamspaceId)
      if (bucket) bucket.push(root)
      else shared.push(root)
    } else if (root.rootKind === 'private_mine') {
      privatePages.push(root)
    } else if (root.rootKind === 'private_other' || !root.trueRoot) {
      shared.push(root)
    } else {
      workspacePages.push(root)
    }
  }
  return { teamspaces: teamspaces.map((t) => ({ teamspace: t, pages: byId.get(t.id) ?? [] })), privatePages, shared, workspacePages }
}

/**
 * 워크스페이스의 살아 있는 페이지 전부. **제목과 위치만.**
 *
 * `live_block` 뷰를 쓴다 — 휴지통·영구삭제 페이지가 사이드바에 나타나면
 * 안 된다(정본 §3.4: "개별 쿼리에서 lifecycle 조건을 빼먹는 것이 1순위 버그").
 *
 * TODO(W6 / F-06-*): 권한 필터. F-02-03 은 *"접근 권한 없는 페이지 →
 * 사이드바에 렌더하지 않음(**존재도 노출 금지**)"* 이라고 못박는다. 지금은
 * 워크스페이스 멤버 전원이 모든 페이지를 보므로 `workspace_id` 가 전부다.
 */
export async function listPageTree(ctx: SessionContext): Promise<PageTreeNode[]> {
  // ★ W6-b: 볼 수 없는 페이지는 **제목도 나가지 않는다.**
  //
  // F-02-03: *"접근 권한 없는 페이지 → **존재도 노출 금지**."* 사이드바는 제목을
  // 그대로 보여주므로, 여기서 거르지 않으면 권한 검사를 아무리 해도 제목이 샌다.
  //
  // 페이지마다 판정하지 않고 **볼 수 있는 스코프 목록**으로 한 번에 거른다
  // (`readableScopes` 머리말 — 같은 스코프의 노드는 정의상 권한이 같다).
  const rows = await withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    return tx.query<{
      id: string
      type: string
      properties: { title?: unknown } | null
      ancestor_path: string[]
      order_key: string
      teamspace_id: string | null
      root_kind: RootKind | null
    }>(
      // ★ W8: 풀페이지 데이터베이스를 넣고, DB 행은 뺀다.
      //   행도 `type='page'` 블록이라(C-3) 타입만 보면 섞이고, 행의 조상인
      //   컨테이너가 이 집합에 없던 동안에는 행이 전부 **최상위 노드**가 됐다.
      //   컨테이너를 넣은 지금도 행은 빼야 한다 — 표 하나가 사이드바를 행 수만큼
      //   늘린다. 행은 표가 보여준다.
      // ★ 7c-2: 루트 블록(`r`)을 붙여 teamspace 를 읽는다(머리말).
      // ★ 7c-7: 워크스페이스 부모 루트의 종류(공용 · 내 개인 · 남의 개인)도 함께 읽는다 — 주인의 id 는 내보내지 않는다.
      `SELECT b.id, b.type, b.properties, b.ancestor_path, b.order_key,
              CASE WHEN r.parent_type = 'teamspace' THEN r.parent_id END AS teamspace_id,
              CASE WHEN r.parent_type <> 'workspace' THEN NULL
                   WHEN r.owner_user_id IS NULL THEN 'workspace'
                   WHEN r.owner_user_id = $3 THEN 'private_mine'
                   ELSE 'private_other' END AS root_kind
         FROM live_block b
         JOIN block r ON r.id = COALESCE(b.ancestor_path[1], b.id)
        WHERE b.workspace_id = $1 AND b.type IN ('page', 'database') AND b.parent_type <> 'data_source'
          AND b.perm_scope_id = ANY($2::uuid[])
        ORDER BY b.order_key, b.id`,
      [ctx.workspaceId, scopes, ctx.userId],
    )
  })

  return buildPageTree(
    rows.map((row) => {
      const raw = row.properties?.title
      return {
        id: row.id,
        kind: row.type === 'database' ? 'database' : 'page',
        // 읽기는 관대하게 — 제목 하나가 망가졌다고 사이드바 전체가 500 이 되면
        // 사용자가 어디로도 이동할 수 없다.
        title: Array.isArray(raw) ? toPlainText(raw as RichTextRun[]) : '',
        ancestorPath: row.ancestor_path,
        orderKey: row.order_key,
        teamspaceId: row.teamspace_id,
        rootKind: row.root_kind,
      }
    }),
  )
}
