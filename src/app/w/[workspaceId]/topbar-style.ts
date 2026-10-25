/**
 * 상단 바의 단추 모양 — 디자인-2a(노션 실측 · `docs/design/notion-measurements.md` 의 "앱 화면")
 *
 * 노션의 상단 바 단추는 테두리가 없다: 높이 28px · 둥글기 6px · 글자 14px · 마우스를 올리면 따뜻한 회색 5% 바탕. 아이콘 단추는 28×28.
 * 페이지 · 데이터베이스 화면의 머리 단추(잠금 · 즐겨찾기 · 코멘트 · 공유 · 옮기기 · 기록 · 업데이트 · 내보내기 · 복제 · 삭제)가 이 둘을 쓴다 —
 * 한 곳에서 바꾸면 모두 따라간다.
 */

/** 글자 단추(공유 · 코멘트 …). */
export const TOPBAR_BUTTON =
  'inline-flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-md px-2 text-sm text-[rgb(44,44,43)] hover:bg-[rgba(33,27,23,0.05)] disabled:opacity-40 aria-expanded:bg-[rgba(33,27,23,0.05)] dark:text-neutral-200 dark:hover:bg-white/5 dark:aria-expanded:bg-white/5'

/** 아이콘 단추(즐겨찾기 …) — 28×28. */
export const TOPBAR_ICON_BUTTON =
  'inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-base text-[rgb(44,44,43)] hover:bg-[rgba(33,27,23,0.05)] disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-white/5'
