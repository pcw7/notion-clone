/**
 * 공개 API 의 사용자 지정 이모지 목록 — `GET /v1/custom_emojis` (API-10 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑭ ② · §3.4 [보강] 커스텀 이모지
 *
 * 앱의 목록(`listCustomEmoji` — 살아 있는 것 · 이름 순 · 워크스페이스의 누구나)을 노션의 모양 `{ id, name, url }` 으로. `url` 은 올린 이미지의
 * 서명 주소(⑪ — 1시간). `name` 은 정확히 같은 이름(앱의 이름 규칙으로 고친 뒤 — 앞뒤의 `:` · 대문자) · 쪽은 묶인 커서(⑩).
 * 내용이 아니라 내보내기 정책 게이트는 걸지 않는다(사용자 목록과 같다).
 */

import { listCustomEmoji } from '../emoji/custom-emoji.ts'
import { normalizeEmojiName } from '../emoji/custom-emoji-rules.ts'
import { apiLinks, invalid } from './pages.ts'
import { v1Ok, type V1Handler } from './v1.ts'
import { API_MAX_PAGE_SIZE, decodeBoundCursor, encodeBoundCursor, parsePageSize, shownValue } from './v1-protocol.ts'

/** `GET /v1/custom_emojis` — `name` · `page_size`(≤ 100) · `start_cursor`. */
export const listApiCustomEmojis: V1Handler = async ({ ctx, request }) => {
  const query = new URL(request.url).searchParams
  const pageSize = parsePageSize(query.get('page_size'))
  if (pageSize === null) {
    return invalid(`query failed validation: query.page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(query.get('page_size'))}.`)
  }
  const rawName = query.get('name')
  // 이름의 모양이 아니면 맞는 것이 없다(거부하지 않는다 — 노션의 거르기와 같다)
  const name = rawName === null || rawName.trim() === '' ? null : (normalizeEmojiName(rawName) ?? '')
  const binding = `custom_emojis:${name ?? '*'}`
  const offset = decodeBoundCursor(binding, query.get('start_cursor'))
  if (offset === null) return invalid('query failed validation: query.start_cursor is not a valid cursor.')

  const all = (await listCustomEmoji(ctx)).filter((e) => name === null || e.name === name)
  const links = apiLinks(ctx, request)
  const slice = all.slice(offset, offset + pageSize)
  const next = offset + pageSize < all.length ? encodeBoundCursor(binding, offset + pageSize) : null
  return v1Ok({
    object: 'list',
    results: slice.map((e) => ({ id: e.id, name: e.name, url: links.fileUrl(e.fileId).url })),
    next_cursor: next,
    has_more: next !== null,
    type: 'custom_emoji',
    custom_emoji: {},
  })
}
