/**
 * 사이드바의 모양 — 디자인-3(노션 앱 실측 · `docs/design/notion-measurements.md` 의 "앱 화면 · 사이드바")
 *
 * 노션의 사이드바: 바탕 `rgb(249, 248, 247)` · 오른쪽 1px 선 `rgb(240, 239, 237)` · 줄 높이 30px · 좌우 안쪽 8px · 둥글기 6px ·
 * 글자 14px `rgb(95, 94, 89)` · 아이콘 20px `rgb(142, 139, 134)`(단색 — 무료 아이콘 묶음 Lucide · ISC) · 마우스를 올리면 따뜻한 회색 5% ·
 * 섹션 머리 12px · 500 · `rgb(161, 158, 153)`. 사이드바의 바로가기 · 섹션 줄 · 트리 줄 · 가져오기 · 휴지통이 이것을 쓴다.
 */

/** 바로가기 · 섹션 줄(검색 · 홈 · 인박스 · 즐겨찾기 · 최근 …). */
export const SIDEBAR_ROW =
  'flex h-[30px] w-full flex-none items-center gap-2 rounded-md px-2 text-left text-sm text-[rgb(95,94,89)] hover:bg-[rgba(33,27,23,0.05)] dark:text-neutral-400 dark:hover:bg-white/5'

/** 지금 페이지의 줄 — 바탕이 남고 글자가 짙다. */
export const SIDEBAR_ROW_CURRENT = 'bg-[rgba(33,27,23,0.05)] font-medium text-[rgb(44,44,43)] dark:bg-white/5 dark:text-neutral-100'

/** 줄 아이콘(20px 단색). Lucide 아이콘의 `className` 으로 준다. */
export const SIDEBAR_ICON = 'size-5 flex-none text-[rgb(142,139,134)] dark:text-neutral-500'

/** 아이콘의 선 굵기 — 노션의 가는 선에 맞춘다(Lucide 기본 2). */
export const SIDEBAR_ICON_STROKE = 1.75

/** 섹션 머리(Teamspaces · 즐겨찾기 · 개인 페이지 …). */
export const SIDEBAR_SECTION_HEAD = 'text-xs font-medium text-[rgb(161,158,153)] dark:text-neutral-500'
