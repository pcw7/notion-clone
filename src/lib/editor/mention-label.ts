/**
 * 멘션이 화면에 보일 글자 — 멘션 칩(`node-views.ts`)과 목차의 줄(`toc-plugin.ts`)이 같은 규칙을 쓴다 (DOM 없음)
 *
 * 멘션 노드에는 id 뿐이다(정본 §3.9 `link_edge` 절) — 이름은 서버가 권한으로 거른 맵에서 읽고(`mentionLabel`), 그 답 셋을 글자로
 * 옮기는 것이 여기다: 볼 수 있으면 이름, 볼 수 없으면(`null`) 그렇다고, 아직 모르면(`undefined`) 자리 표시.
 */

export type MentionKind = 'user' | 'page'

export type MentionDisplay = {
  readonly text: string
  /** 볼 수 없는 페이지 — 열리지 않는다. */
  readonly denied: boolean
}

export function mentionDisplay(kind: MentionKind, label: string | null | undefined): MentionDisplay {
  if (kind === 'user') return { text: `@${label ?? (label === null ? '알 수 없는 사용자' : '…')}`, denied: false }
  if (label === null) return { text: '볼 수 없는 페이지', denied: true }
  return { text: label === undefined ? '페이지' : label || '제목 없음', denied: false }
}

/** 멘션 attr 이 가리키는 대상 — 노션 공개 API 모양(`mention.user.id` · `mention.page.id`). 그 밖의 멘션(날짜 …)이면 null. */
export function mentionTargetOf(attrs: unknown): { kind: MentionKind; id: string } | null {
  const m = attrs as { type?: unknown; user?: { id?: unknown }; page?: { id?: unknown } } | null
  if (m?.type === 'user' && typeof m.user?.id === 'string') return { kind: 'user', id: m.user.id }
  if (m?.type === 'page' && typeof m.page?.id === 'string') return { kind: 'page', id: m.page.id }
  return null
}

/**
 * 커스텀 이모지 멘션(7c-3a)이 그릴 이름 — 서버의 이름 맵(`loadMentionLabels` 의 `emoji`). 지운 이모지도 이름을 준다(정본 §3.4 [보강]
 * 커스텀 이모지 ③ "이름만"). 사람 · 페이지와 달리 권한으로 거르지 않는다(목록은 워크스페이스의 누구나 본다).
 */
export type EmojiLabel = { readonly name: string; readonly deleted: boolean }

/** 멘션 attr 이 커스텀 이모지면 그 id — 노션 API 모양(`mention.custom_emoji.id`). 아니면 null. */
export function customEmojiIdOf(attrs: unknown): string | null {
  const m = attrs as { type?: unknown; custom_emoji?: { id?: unknown } } | null
  return m?.type === 'custom_emoji' && typeof m.custom_emoji?.id === 'string' ? m.custom_emoji.id.toLowerCase() : null
}

/**
 * 커스텀 이모지를 그림 대신 글자로 그릴 때(지웠다 · 그림을 못 불러왔다 · 이 워크스페이스에 없다 · 아직 모른다)의 글자 — 이름을 알면
 * `:이름:`, 이 워크스페이스에 없으면(`null`) "이모지", 아직 모르면(`undefined`) `:…:`.
 */
export function customEmojiText(label: EmojiLabel | null | undefined): string {
  if (label === null) return '이모지'
  return label === undefined ? ':…:' : `:${label.name}:`
}
