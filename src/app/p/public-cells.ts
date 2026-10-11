/**
 * 공개 표 · 공개 행의 칸 — 값을 사람의 글로 (게시 · 공유 6a-2c-2 · F-06-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ⑩
 *
 * 값은 행의 캐시(`properties_cache`) 그대로 온다 — 모양이 틀린 값은 빈 칸이다(던지지 않는다 · 공개 화면이 한 칸 때문에 서지 않으면 안
 * 된다). 글(제목 · 글)은 서식을 지닌 글자라 컴포넌트가 그린다 — 여기서는 그 글자를 꺼내기만 한다.
 */

import type { RichTextRun } from '../../lib/contracts/rich-text.ts'
import { formatUniqueId } from '../../lib/database/unique-id-format.ts'
import type { PublicColumn, PublicOption } from '../../lib/publish/public-database.ts'

/** 칸 하나를 그릴 재료 — 글자(서식 있음) · 옵션 칩 · 체크 · 평문. 없으면 빈 칸. */
export type PublicCell =
  | { readonly kind: 'runs'; readonly runs: readonly RichTextRun[] }
  | { readonly kind: 'option'; readonly option: PublicOption }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'empty' }

const EMPTY: PublicCell = { kind: 'empty' }

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const runsOf = (value: unknown): readonly RichTextRun[] | null => (Array.isArray(value) ? (value as RichTextRun[]) : null)

/** 칸의 재료. 고유 ID 는 값이 칸에 없고 행의 번호다(`uniqueSeq`). */
export function publicCell(column: PublicColumn, value: unknown, uniqueSeq: number | null): PublicCell {
  if (column.type === 'unique_id') return uniqueSeq === null ? EMPTY : { kind: 'text', text: formatUniqueId(column.prefix, uniqueSeq) }
  const cell = record(value)
  if (cell === null) return column.type === 'checkbox' ? { kind: 'checkbox', checked: false } : EMPTY
  switch (column.type) {
    case 'title':
    case 'rich_text': {
      const runs = runsOf(cell[column.type])
      return runs !== null && runs.length > 0 ? { kind: 'runs', runs } : EMPTY
    }
    case 'number':
      return typeof cell.number === 'number' && Number.isFinite(cell.number) ? { kind: 'text', text: numberText(cell.number) } : EMPTY
    case 'select':
    case 'status': {
      const ref = record(cell[column.type])
      const option = typeof ref?.id === 'string' ? column.options.find((o) => o.id === ref.id) : undefined
      // 지운 옵션을 가리키는 값은 빈 칸 — 이름을 지어내지 않는다
      return option === undefined ? EMPTY : { kind: 'option', option }
    }
    case 'checkbox':
      return { kind: 'checkbox', checked: cell.checkbox === true }
    case 'date': {
      const text = dateText(record(cell.date))
      return text === null ? EMPTY : { kind: 'text', text }
    }
  }
}

/** 숫자 — 천 단위 쉼표(한국어). */
export function numberText(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 10 })
}

/** 날짜 — `YYYY-MM-DD` 또는 `YYYY-MM-DD HH:mm`(시각이 있으면) · 끝이 있으면 `→`. 모양이 틀리면 null. */
export function dateText(date: Record<string, unknown> | null): string | null {
  if (date === null || typeof date.start !== 'string') return null
  const one = (s: string): string | null => {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(s)
    return m === null ? null : m[2] === undefined ? m[1]! : `${m[1]} ${m[2]}`
  }
  const start = one(date.start)
  if (start === null) return null
  const end = typeof date.end === 'string' ? one(date.end) : null
  return end === null ? start : `${start} → ${end}`
}

/** 체크박스의 이름(스크린 리더 — 모양만으로 말하지 않는다 · F-12-12). */
export function checkboxLabel(checked: boolean): string {
  return checked ? '체크됨' : '체크 안 됨'
}
