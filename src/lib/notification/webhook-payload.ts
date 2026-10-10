/**
 * 웹훅 본문 — 받는 쪽에 보낼 JSON (히스토리 · 활동 4e-2 · F-11-19 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 ⑥ · 보내기 ⓕ
 *
 *   - `text` — Slack 이 그리는 한 줄. 걸린 페이지의 제목(링크) · 누가 · 무엇을 몇 번 · 아래 페이지가 섞였으면 그 수.
 *     예: `<https://…|‘회의록’> — 홍길동 · 김철수: 편집 3 · 코멘트 1`
 *   - `notion_clone` — 기계가 읽을 것. 판 · 배달 id(받는 쪽의 멱등 키) · 페이지 · 이벤트(앞의 100개) · 전체 수.
 *
 * 사람이 쓴 글(본문 · 코멘트)은 싣지 않는다 — 이벤트의 payload 가 id 만인 것과 같은 까닭이다. 제목 · 이름은 Slack 의 mrkdwn 이 읽는
 * `& < >` 를 바꿔 둔다(`<…|…>` 링크를 깨거나 멘션을 만들지 못하게).
 */

import { PAGE_ACTIVITY_TYPES, type PageActivityType } from './page-activity-types.ts'

/** 본문에 싣는 이벤트의 상한 — 넘으면 앞의 것만 · 전체 수는 `event_count`. */
export const MAX_PAYLOAD_EVENTS = 100
/** `text` 에 이름을 이만큼까지 — 넘으면 "외 N명". */
const MAX_ACTOR_NAMES = 3

export type PayloadEvent = {
  readonly id: string
  readonly type: PageActivityType
  readonly pageId: string
  /** 시스템이면 null. */
  readonly actor: { readonly id: string; readonly name: string; readonly deleted: boolean } | null
  readonly at: Date
}

export type WebhookPayload = {
  readonly text: string
  readonly notion_clone: {
    readonly version: 1
    readonly delivery_id: string
    readonly page: { readonly id: string; readonly url: string }
    readonly events: readonly { readonly id: string; readonly type: string; readonly page_id: string; readonly actor_id: string | null; readonly at: string }[]
    readonly event_count: number
  }
}

const LABEL: Record<PageActivityType, string> = {
  'page.created': '새 페이지',
  'page.moved': '옮김',
  'page.trashed': '휴지통',
  'block.updated': '편집',
  'property.updated': '속성',
  'comment.created': '코멘트',
}

/** Slack mrkdwn 이 읽는 글자를 바꾼다. */
export const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const actorLabel = (actor: PayloadEvent['actor']) =>
  actor === null ? '시스템' : actor.deleted ? '삭제된 사용자' : actor.name || '이름 없음'

export function buildWebhookPayload(input: {
  readonly deliveryId: string
  readonly workspaceId: string
  readonly page: { readonly id: string; readonly title: string }
  /** 시간순. */
  readonly events: readonly PayloadEvent[]
  readonly appUrl: string
}): WebhookPayload {
  const url = `${input.appUrl.replace(/\/+$/, '')}/w/${input.workspaceId}/${input.page.id}`

  const actors = new Map<string, string>()
  for (const e of input.events) actors.set(e.actor?.id ?? 'system', actorLabel(e.actor))
  const names = [...actors.values()].map(escapeSlack)
  const who = names.length <= MAX_ACTOR_NAMES ? names.join(' · ') : `${names.slice(0, MAX_ACTOR_NAMES).join(' · ')} 외 ${names.length - MAX_ACTOR_NAMES}명`

  const counts = PAGE_ACTIVITY_TYPES.map((type) => [type, input.events.filter((e) => e.type === type).length] as const)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${LABEL[type]} ${n}`)
    .join(' · ')
  const below = new Set(input.events.filter((e) => e.pageId !== input.page.id).map((e) => e.pageId)).size

  return {
    text: `<${url}|‘${escapeSlack(input.page.title || '제목 없음')}’> — ${who}: ${counts}${below > 0 ? ` (아래 페이지 ${below}곳 포함)` : ''}`,
    notion_clone: {
      version: 1,
      delivery_id: input.deliveryId,
      page: { id: input.page.id, url },
      events: input.events.slice(0, MAX_PAYLOAD_EVENTS).map((e) => ({
        id: e.id,
        type: e.type,
        page_id: e.pageId,
        actor_id: e.actor?.id ?? null,
        at: e.at.toISOString(),
      })),
      event_count: input.events.length,
    },
  }
}
