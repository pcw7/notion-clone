/**
 * 인라인 데이터베이스의 미리보기 — 본문 안의 표 (26번 트랙 I-3 · F-04-14 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 I-1] ⑥
 *
 * 편집기의 데이터베이스 참조 노드 뷰가 그리는 작은 표의 모양을 정한다. 데이터는 그 데이터베이스의 **첫 뷰**(탭 순서)의 행 읽기
 * (`GET /views/{id}/rows`)가 주는 것 그대로다 — 그 뷰의 필터 · 정렬 · 보이는 열 · 수동 순서를 따른다. 여기서는 그것을 머리와 칸의 글자로만
 * 바꾼다(DOM 을 모른다).
 *
 *   - **처음 몇 행만** — 04 F-04-14 *"인라인: 세로 공간이 제한적이라 load limit 설정(10/25/50/100)이 함께 제공된다"*. 더 있으면 "더 보기" 로
 *     데이터베이스 화면을 연다. 본문 안에서 페이지를 넘기지 않는다(v1).
 *   - **칸 값이 있는 열만 · 몇 개만** — 제목 · 글 · 숫자 · 선택 · 상태 · 체크 · 날짜. 사람(이름을 따로 읽어야 한다) · relation · rollup ·
 *     수식 · 고유 ID · 단추는 뺀다 — 미리보기에 틀린 글자(\"떠난 사용자\" 등)를 그리느니 그리지 않는다. 칸을 고치는 것은 데이터베이스 화면에서다.
 */

import { cellText, readCell } from './cell-format.ts'
import type { RowJson } from './http.ts'
import { isCellColumn, type ViewColumn } from './view-columns.ts'

/** 본문 안에 그리는 행 수 — 04 의 load limit 의 가장 작은 값. */
export const INLINE_PREVIEW_ROWS = 10
/** 그리는 열 수의 상한 — 본문 폭에 맞춘다(제목 포함). */
export const INLINE_PREVIEW_COLUMNS = 5

const PREVIEW_TYPES: ReadonlySet<string> = new Set(['title', 'rich_text', 'number', 'select', 'status', 'checkbox', 'date'])

export type InlinePreview = {
  /** 머리 — 열 이름. */
  readonly headers: readonly string[]
  /** 행마다 id(누르면 그 행 페이지)와 칸의 글자(머리와 같은 차례). */
  readonly rows: readonly { readonly id: string; readonly cells: readonly string[] }[]
  /** 누르면 그 행 페이지를 여는 칸의 차례 — 제목 열(없으면 첫 열). */
  readonly openAt: number
  /** 그린 것보다 더 있다(첫 뷰의 다음 페이지가 있다). */
  readonly more: boolean
}

/** 행 읽기의 응답(보이는 열 · 행 · 더 있는가) → 미리보기. 보이는 열 중 칸 값이 있는 것을 순서대로, 상한까지. */
export function inlinePreviewOf(columns: readonly ViewColumn[], rows: readonly RowJson[], hasMore: boolean): InlinePreview {
  const shown = columns.filter((c) => c.visible && isCellColumn(c) && PREVIEW_TYPES.has(c.type)).slice(0, INLINE_PREVIEW_COLUMNS)
  const picked = rows.slice(0, INLINE_PREVIEW_ROWS)
  return {
    headers: shown.map((c) => c.name),
    rows: picked.map((row) => ({
      id: row.id,
      cells: shown.map((column) => {
        if (column.type === 'title') return row.title || '제목 없음'
        if (!isCellColumn(column)) return ''
        return cellText(readCell(column.type, row.properties[column.propertyId]), column.options)
      }),
    })),
    openAt: Math.max(0, shown.findIndex((c) => c.type === 'title')),
    more: hasMore || rows.length > INLINE_PREVIEW_ROWS,
  }
}

/** 같은 데이터베이스를 다시 읽지 않는 시간 — 맵이 바뀌어 노드 뷰가 모두 다시 만들어질 때(`setProps({ nodeViews })`) 왕복이 늘지 않게. */
export const INLINE_PREVIEW_FRESH_MS = 15_000

/** 노드 뷰가 쓰는 미리보기 출처 — 이미 읽은 것(`peek`)과 읽기(`load`). */
export type InlinePreviewSource = {
  /** 마지막으로 읽은 것 — 다시 만들어진 노드 뷰가 곧바로 그린다(표가 비었다 다시 차지 않게). 읽은 적 없으면 undefined. */
  readonly peek: (databaseId: string) => InlinePreview | null | undefined
  /** 읽는다 — 방금(`freshMs` 안에) 읽었거나 읽는 중이면 그것을 돌려준다. 실패(null)는 기억하지 않는다(다음에 다시 읽는다). */
  readonly load: (databaseId: string) => Promise<InlinePreview | null>
}

/** 읽기 함수에 짧은 캐시를 씌운다. 페이지(편집기)마다 하나 — 페이지를 다시 열면 새로 읽는다. */
export function inlinePreviewSource(
  fetchPreview: (databaseId: string) => Promise<InlinePreview | null>,
  now: () => number = Date.now,
  freshMs: number = INLINE_PREVIEW_FRESH_MS,
): InlinePreviewSource {
  const entries = new Map<string, { at: number; value: InlinePreview | null | undefined; promise: Promise<InlinePreview | null> }>()
  return {
    peek: (databaseId) => entries.get(databaseId)?.value,
    load: (databaseId) => {
      const hit = entries.get(databaseId)
      if (hit !== undefined && now() - hit.at < freshMs) return hit.promise
      // 다시 읽는 동안에도 peek 는 앞의 것을 준다
      const entry: { at: number; value: InlinePreview | null | undefined; promise: Promise<InlinePreview | null> } = {
        at: now(),
        value: hit?.value,
        promise: Promise.resolve(null),
      }
      entry.promise = fetchPreview(databaseId)
        .catch(() => null)
        .then((value) => {
          entry.value = value
          if (value === null) entry.at = Number.NEGATIVE_INFINITY
          return value
        })
      entries.set(databaseId, entry)
      return entry.promise
    },
  }
}
