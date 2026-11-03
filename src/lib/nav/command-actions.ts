/**
 * 커맨드 팔레트의 작업 — 목록 · 맞추기 (35번 트랙 CP-1 · F-07-11 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 CP-1] 검색 오버레이의 작업
 *
 * 07 F-07-11 클론 대안 *"별도 팔레트를 만들지 말고, F-07-01 검색 오버레이 결과 상단에 \"Actions\" 섹션을 얹는 방식으로 통합. 액션 5~8개
 * (새 페이지, 링크 복사, 즐겨찾기, 테마 전환, 사이드바 토글)면 충분"* · 데이터 모델 함의 *"검색은 클라이언트 로컬 fuzzy 매칭. 서버 왕복
 * 없음"*. 서버에 저장하는 것이 없다 — 작업은 이미 있는 길(페이지 만들기 · 설정 · 화면 이동)을 부른다.
 *
 * 맞추기는 이름과 낱말(한국어 · 영어)을 **공백 없이 · 대소문자 없이** 부분 일치로 본다. 차례는 이름이 앞으로 맞는 것 → 이름 안 → 낱말이
 * 앞으로 → 낱말 안, 같으면 이 목록의 차례. 입력이 비면 작업을 보이지 않는다(빈 입력은 "이동 모드" — 최근 방문이다 · F-07-01).
 */

export const COMMAND_ACTION_IDS = ['new-page', 'copy-link', 'toggle-theme', 'toggle-sidebar', 'open-settings', 'open-inbox', 'go-home'] as const
export type CommandActionId = (typeof COMMAND_ACTION_IDS)[number]

/** 단축키(학습 유도 — 07 *"각 항목에 해당 단축키 표시"*) — 화면이 쓰는 기기(⌘ · Ctrl)에 맞춰 적는다. */
export type CommandShortcut = { readonly mod: true; readonly shift?: boolean; readonly key: string }

export type CommandAction = {
  readonly id: CommandActionId
  readonly label: string
  /** 맞출 낱말 — 한국어 · 영어(노션의 영어 이름으로 찾는 사람도 있다). */
  readonly keywords: readonly string[]
  readonly shortcut: CommandShortcut | null
  /** 지금 페이지가 있어야 하는가 — 없으면 목록에서 숨긴다(07 *"컨텍스트에 맞지 않는 액션은 숨김"*). */
  readonly needsPage: boolean
}

export const COMMAND_ACTIONS: readonly CommandAction[] = [
  { id: 'new-page', label: '새 페이지', keywords: ['만들기', '추가', 'new page', 'create'], shortcut: null, needsPage: false },
  { id: 'copy-link', label: '링크 복사', keywords: ['주소', 'url', 'copy link', '공유'], shortcut: null, needsPage: true },
  { id: 'toggle-theme', label: '테마 바꾸기(밝게 · 어둡게)', keywords: ['다크 모드', '어둡게', '밝게', 'theme', 'dark mode'], shortcut: { mod: true, shift: true, key: 'L' }, needsPage: false },
  { id: 'toggle-sidebar', label: '사이드바 접기 · 펴기', keywords: ['사이드바', '숨기기', 'sidebar', 'toggle sidebar'], shortcut: { mod: true, key: '\\' }, needsPage: false },
  { id: 'open-settings', label: '설정 열기', keywords: ['설정', '환경설정', 'settings', 'preferences'], shortcut: null, needsPage: false },
  { id: 'open-inbox', label: '인박스 열기', keywords: ['알림', '받은 편지', 'inbox', 'notifications'], shortcut: null, needsPage: false },
  { id: 'go-home', label: '홈으로', keywords: ['처음', '시작', 'home'], shortcut: null, needsPage: false },
]

export type CommandContext = {
  /** 지금 열린 페이지 — 없으면(홈 · 설정 · 데이터베이스 화면) null. */
  readonly pageId: string | null
}

/** 견줄 글 — 공백을 빼고 소문자로(유니코드 정규화 — 조합형 한글도 같게). */
export function normalizeCommandText(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, '')
}

/** 맞출 수 있는 것 — 앱의 작업 · 페이지의 작업(CP-2 · 단추가 등록한다)이 같은 규칙으로 맞는다. */
export type Matchable = { readonly label: string; readonly keywords: readonly string[] }

/** 입력에 맞는 것만 차례대로 — 이름 앞 → 이름 안 → 낱말 앞 → 낱말 안, 같으면 받은 차례. 입력이 비면 없다. */
export function rankByQuery<T extends Matchable>(query: string, items: readonly T[]): T[] {
  const q = normalizeCommandText(query)
  if (q === '') return []
  const scored: { item: T; score: number; order: number }[] = []
  items.forEach((item, order) => {
    const label = normalizeCommandText(item.label)
    const words = item.keywords.map(normalizeCommandText)
    const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : words.some((w) => w.startsWith(q)) ? 2 : words.some((w) => w.includes(q)) ? 3 : -1
    if (score >= 0) scored.push({ item, score, order })
  })
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((s) => s.item)
}

/** 지금 맥락에서 쓸 수 있는 앱의 작업 — 페이지가 없으면 "링크 복사" 같은 것은 숨긴다. */
export function appActionsFor(ctx: CommandContext): CommandAction[] {
  return COMMAND_ACTIONS.filter((action) => !action.needsPage || ctx.pageId !== null)
}

/** 입력에 맞는 앱의 작업 — 차례대로. 입력이 비면 없다 · 지금 맥락에 맞지 않는 작업은 숨긴다. */
export function matchCommandActions(query: string, ctx: CommandContext): CommandAction[] {
  return rankByQuery(query, appActionsFor(ctx))
}

/** 단축키를 글로 — 맥은 ⌘ · ⇧, 다른 기기는 Ctrl+ · Shift+. */
export function formatCommandShortcut(shortcut: CommandShortcut, mac: boolean): string {
  return mac ? `⌘${shortcut.shift === true ? '⇧' : ''}${shortcut.key}` : `Ctrl+${shortcut.shift === true ? 'Shift+' : ''}${shortcut.key}`
}
