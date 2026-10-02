/**
 * 페이지의 경로(breadcrumb) — 페이지 머리와 본문의 breadcrumb 블록이 같은 줄을 그린다 (잔여 묶음 8b-2 · F-01-16 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] breadcrumb(`type='breadcrumb'`) — 내용을 저장하지 않고 그릴 때 계산한다
 *       01-block-editor.md F-01-16 *"`/breadcrumb` 삽입 → 페이지의 조상 경로가 링크로 표시"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 누가 무엇을 보는가 — 이미 판결했다(다시 판단하지 않는다)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   · 조상은 **볼 수 있는 것만** 싣고 볼 수 없는 조상은 건너뛴다(HANDOFF §3.3-100 · #76 — 사이드바가 같은 페이지를 가장 가까운
 *     볼 수 있는 조상 밑에 두는 것과 같은 규칙). F-01-16 의 *"제목 숨김"* 보다 덜 샌다 — 자리 표시를 두면 위에 무엇이 있다는
 *     것과 그 개수를 알려 준다. 조상을 읽는 것은 `listAncestors`(권한으로 거른 질의)다
 *   · teamspace 는 **멤버에게만** 세운다(§3.3-194 · #120 — 그 링크가 가는 화면은 멤버가 아니면 404 다)
 *
 * 이 모듈은 그 결과를 줄로 옮기기만 한다 — 머리(서버 렌더)와 블록(편집기의 노드 뷰)이 같은 함수를 지나므로 둘이 갈리지 않는다.
 */

/** breadcrumb 블록의 타입 이름(`block.type` · 공개 API 와 같다). */
export const BREADCRUMB_TYPE = 'breadcrumb'

/** 제목이 빈 페이지의 이름 — 머리 · 사이드바와 같은 글자. */
export const UNTITLED_PAGE = '제목 없음'

/** 맨 앞의 이름. */
export const WORKSPACE_LABEL = '워크스페이스'

export type BreadcrumbItem = {
  readonly kind: 'workspace' | 'teamspace' | 'database' | 'page' | 'current'
  readonly id: string
  readonly label: string
  /** 누르면 갈 곳 — 지금 페이지(`current`)는 링크가 아니다. */
  readonly href: string | null
}

/** 경로의 줄 — 워크스페이스 · (teamspace) · 볼 수 있는 조상 · 지금 페이지. */
export type BreadcrumbTrail = readonly BreadcrumbItem[]

export type BreadcrumbInput = {
  readonly workspaceId: string
  /** 루트 페이지의 teamspace — 멤버일 때만 준다(§3.3-194). */
  readonly teamspace: { readonly id: string; readonly name: string } | null
  /** 볼 수 있는 조상 — 위에서 아래로(`listAncestors`). */
  readonly ancestors: readonly { readonly id: string; readonly plainTitle: string }[]
  readonly page: { readonly id: string; readonly plainTitle: string }
}

export function breadcrumbTrail(input: BreadcrumbInput): BreadcrumbTrail {
  const { workspaceId } = input
  return [
    { kind: 'workspace', id: workspaceId, label: WORKSPACE_LABEL, href: `/w/${workspaceId}` },
    ...(input.teamspace === null
      ? []
      : [{ kind: 'teamspace' as const, id: input.teamspace.id, label: input.teamspace.name, href: `/w/${workspaceId}/teamspaces/${input.teamspace.id}` }]),
    ...input.ancestors.map((a) => ({ kind: 'page' as const, id: a.id, label: a.plainTitle || UNTITLED_PAGE, href: `/w/${workspaceId}/${a.id}` })),
    { kind: 'current', id: input.page.id, label: input.page.plainTitle || UNTITLED_PAGE, href: null },
  ]
}

/** 데이터베이스 템플릿 편집 화면의 경로 — 워크스페이스 · 그 표 · 템플릿(행은 페이지 트리에 서지 않는다 · §3.3-179). */
export function templateTrail(input: {
  readonly workspaceId: string
  readonly database: { readonly id: string; readonly name: string }
  readonly templateId: string
}): BreadcrumbTrail {
  const { workspaceId } = input
  return [
    { kind: 'workspace', id: workspaceId, label: WORKSPACE_LABEL, href: `/w/${workspaceId}` },
    { kind: 'database', id: input.database.id, label: input.database.name || UNTITLED_PAGE, href: `/w/${workspaceId}/db/${input.database.id}` },
    { kind: 'current', id: input.templateId, label: '템플릿', href: null },
  ]
}

/** 같은 경로인가 — 서버가 다시 그릴 때마다 새 배열이 온다. 같으면 지난 객체를 쓴다(노드 뷰가 다시 그리지 않게). */
export function sameTrail(a: BreadcrumbTrail | null, b: BreadcrumbTrail | null): boolean {
  if (a === b) return true
  if (a === null || b === null || a.length !== b.length) return false
  return a.every((item, i) => item.kind === b[i].kind && item.id === b[i].id && item.label === b[i].label && item.href === b[i].href)
}
