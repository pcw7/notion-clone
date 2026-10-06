/**
 * 읽기 전용 미리보기의 편집기 의존성 — 버전 기록 화면이 옛 본문을 그린다 (잔여 묶음 8d-2 · F-11-01 · 순수)
 *
 * 미리보기는 협업 없는 문서 상태(`createDocumentState`)를 `editable: false` 로 연 편집기다 — 본문과 같은 노드 뷰가 그리므로 코드 블록 ·
 * 목차 · 이미지 · 하위 페이지 · 멘션이 지금 본문과 같은 모습이다(따로 그리는 길을 두면 두 벌이 어긋난다). 그 노드 뷰들이 묻는 것을
 * 여기서 채운다:
 *
 *   · 이름 · 아이콘 — 미리보기 API 가 준 맵(**지금의 권한으로 거른 것** — `history/version.ts`). 맵에 없으면 모르는 것(`undefined`)
 *   · 바꾸는 일 · 옮겨 가는 일은 아무것도 하지 않는다 — 접기 · 하위 페이지 열기 · 목차로 가기 · 경로 · 코드 메뉴 · 올리기. 미리보기는
 *     그 시점의 본문을 보여 줄 뿐이다(눌러서 다른 화면으로 가면 기록 창이 남는다). 접힌 토글은 모두 펼쳐 보인다 — 접힘은 보는 사람의
 *     화면 상태라 버전에 없다
 *   · 경로 블록은 비운다 — 경로는 지금 페이지의 것이라 그 시점의 것이 아니다
 */

import type { PageIcon } from '../block/page-icon.ts'
import type { EditorDeps } from './create-editor.ts'

export type PreviewLabels = {
  readonly users: Readonly<Record<string, string | null>>
  readonly pages: Readonly<Record<string, string | null>>
  readonly pageIcons: Readonly<Record<string, PageIcon>>
}

function lookup(map: Readonly<Record<string, string | null>>, id: string): string | null | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined
}

export function readOnlyEditorDeps(workspaceId: string, labels: PreviewLabels): EditorDeps {
  const nothing = (): void => undefined
  return {
    workspaceId,
    isCollapsed: () => false,
    toggleCollapsed: nothing,
    openPage: nothing,
    revealBlock: nothing,
    navigate: nothing,
    openCodeLanguageMenu: nothing,
    openCodeCaption: nothing,
    openEquation: nothing,
    openInlineEquation: nothing,
    uploadImage: async () => ({ ok: false, message: '미리보기에서는 올릴 수 없습니다.' }),
    breadcrumbTrail: () => null,
    pageRefTitle: (id) => lookup(labels.pages, id),
    mentionLabel: (kind, id) => lookup(kind === 'user' ? labels.users : labels.pages, id),
    pageIcon: (id) => (Object.hasOwn(labels.pageIcons, id) ? labels.pageIcons[id] : null),
  }
}
