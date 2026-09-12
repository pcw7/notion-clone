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
 * Favorites / Teamspaces / Shared / Private 섹션은 만들지 않는다 — teamspace 도
 * `acl_entry` 도 아직 없어서 그 구분이 **파생될 근거가 없다**(F-07-16: "섹션 =
 * 권한 상태의 파생 뷰이지 저장된 분류가 아니다"). W6 에서 권한이 들어오면 생긴다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { asBlockId } from '../ids.ts'
import { withReadTransaction } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'

/** 트리를 엮는 데 필요한 최소 정보. 본문은 없다. */
export type PageTreeRow = {
  readonly id: string
  readonly title: string
  /** 루트→부모까지의 **블록** id. 본문 블록도 들어 있다 [X-7]. */
  readonly ancestorPath: readonly string[]
  readonly orderKey: string
}

export type PageTreeNode = {
  readonly id: BlockId
  readonly title: string
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
      properties: { title?: unknown } | null
      ancestor_path: string[]
      order_key: string
    }>(
      `SELECT id, properties, ancestor_path, order_key
         FROM live_block
        WHERE workspace_id = $1 AND type = 'page' AND perm_scope_id = ANY($2::uuid[])
        ORDER BY order_key, id`,
      [ctx.workspaceId, scopes],
    )
  })

  return buildPageTree(
    rows.map((row) => {
      const raw = row.properties?.title
      return {
        id: row.id,
        // 읽기는 관대하게 — 제목 하나가 망가졌다고 사이드바 전체가 500 이 되면
        // 사용자가 어디로도 이동할 수 없다.
        title: Array.isArray(raw) ? toPlainText(raw as RichTextRun[]) : '',
        ancestorPath: row.ancestor_path,
        orderKey: row.order_key,
      }
    }),
  )
}
