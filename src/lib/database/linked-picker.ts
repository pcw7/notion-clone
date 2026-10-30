/**
 * 연결할 원본 고르기 — 검색어 다듬기 · 항목 이름 (27번 트랙 L-2 · F-04-13 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 L-1] ⑤
 *
 * 본문의 `/연결된 데이터베이스` 고르개와 데이터베이스 목록 라우트(`GET /databases?q=`)가 함께 쓴다. 목록은 상한(`MAX_DATABASE_LIST`)이
 * 있어 데이터베이스가 많은 워크스페이스에서는 찾는 것이 목록 밖에 있다 — 이름으로 서버에서 거른다(HANDOFF §7 "고르개에 검색이 없다").
 */

import type { DatabaseListItem } from './database.ts'

/** 검색어의 상한 — 이름 검색이라 길 까닭이 없다. */
export const DATABASE_QUERY_MAX = 100

/** 이름 없는 데이터베이스의 글자 — 본문의 노드 뷰와 같다. */
export const UNTITLED_DATABASE = '제목 없는 데이터베이스'

/** 검색어 — 앞뒤 공백을 떼고 NFC(한글 조합형 · 완성형을 같게) · 상한까지. 비었으면 null(거르지 않는다). */
export function normalizeDatabaseQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.normalize('NFC').trim().slice(0, DATABASE_QUERY_MAX)
  return text === '' ? null : text
}

/** 고르개의 한 줄 — 데이터베이스 이름(소스가 여럿이면 "이름 · 소스"). */
export function linkedSourceLabel(item: Pick<DatabaseListItem, 'name' | 'sourceName'>): string {
  const name = item.name.trim() === '' ? UNTITLED_DATABASE : item.name
  return item.sourceName === null ? name : `${name} · ${item.sourceName}`
}
