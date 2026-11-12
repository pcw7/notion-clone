/**
 * 공개 표 · 공개 행의 칸 — 값을 사람의 글로 (게시 · 공유 6a-2c-2 · F-06-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ⑩
 *
 * 값은 행의 캐시(`properties_cache`) 그대로 온다 — 모양이 틀린 값은 빈 칸이다(던지지 않는다 · 공개 화면이 한 칸 때문에 서지 않으면 안
 * 된다). 글(제목 · 글)은 서식을 지닌 글자라 컴포넌트가 그린다 — 여기서는 그 글자를 꺼내기만 한다.
 */

import type { RichTextRun } from '../../lib/contracts/rich-text.ts'
import { contactHref } from '../../lib/database/contact-links.ts'
import type { ContactType } from '../../lib/database/property-types.ts'
import { formatUniqueId } from '../../lib/database/unique-id-format.ts'
import type { PublicColumn, PublicOption } from '../../lib/publish/public-database.ts'

/** 칸 하나를 그릴 재료 — 글자(서식 있음) · 옵션 칩 · 체크 · 평문. 없으면 빈 칸. */
export type PublicCell =
  | { readonly kind: 'runs'; readonly runs: readonly RichTextRun[] }
  | { readonly kind: 'option'; readonly option: PublicOption }
  /** 다중 선택(PT-1) — 고른 차례의 옵션 칩들. */
  | { readonly kind: 'options'; readonly options: readonly PublicOption[] }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  | { readonly kind: 'text'; readonly text: string }
  /** URL · 이메일 · 전화(PT-2) — `href` 는 걸 수 있는 글일 때만(아니면 글로 그린다). */
  | { readonly kind: 'contact'; readonly type: ContactType; readonly text: string; readonly href: string | null }
  /** 파일과 미디어(PT-4) — 이름만. 공개 파일 길은 블록 단위라 칸의 파일은 아직 열 수 없다(링크 없이 글로). */
  | { readonly kind: 'files'; readonly names: readonly string[] }
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
    case 'multi_select': {
      const list = Array.isArray(cell.multi_select) ? cell.multi_select : []
      // 지운 옵션을 가리키는 id 는 뺀다 — 이름을 지어내지 않는다
      const options = list.flatMap((ref) => {
        const found = typeof record(ref)?.id === 'string' ? column.options.find((o) => o.id === record(ref)!.id) : undefined
        return found === undefined ? [] : [found]
      })
      return options.length === 0 ? EMPTY : { kind: 'options', options }
    }
    case 'url':
    case 'email':
    case 'phone_number': {
      const text = typeof cell[column.type] === 'string' ? (cell[column.type] as string) : ''
      return text === '' ? EMPTY : { kind: 'contact', type: column.type, text, href: contactHref(column.type, text) }
    }
    case 'files': {
      const names = (Array.isArray(cell.files) ? cell.files : []).flatMap((f) => {
        const name = record(f)?.name
        return typeof name === 'string' && name !== '' ? [name] : []
      })
      return names.length === 0 ? EMPTY : { kind: 'files', names }
    }
    // 장소(MP-1) — 이름만(글로)
    case 'place': {
      const name = record(cell.place)?.name
      return typeof name === 'string' && name !== '' ? { kind: 'text', text: name } : EMPTY
    }
    // 만든 · 마지막 편집 시각(PT-3) — 값은 행 페이지 블록의 열이다(읽을 때 끼운 `{type, <type>: ISO}`). 공개 화면은 보는 사람의 시간대를
    // 모르므로(쿠키를 읽으면 같은 게시 페이지가 보는 사람마다 달라진다) UTC 로 적고 그렇다고 밝힌다. 사람 둘은 공개 열이 아니다
    case 'created_time':
    case 'last_edited_time': {
      // 날짜 칸의 시각 있는 모양(`YYYY-MM-DD HH:mm`)과 같다
      const text = dateText({ start: typeof cell[column.type] === 'string' ? (cell[column.type] as string) : '' })
      return text === null ? EMPTY : { kind: 'text', text: `${text} UTC` }
    }
    case 'checkbox':
      return { kind: 'checkbox', checked: cell.checkbox === true }
    case 'date': {
      const text = dateText(record(cell.date))
      return text === null ? EMPTY : { kind: 'text', text }
    }
    case 'verification':
      return verificationBadge(cell)
    // 공개 열이 아닌 타입(만든 · 마지막 편집 **사람** 등 — 회원의 신원)은 값이 와도 그리지 않는다
    default:
      return EMPTY
  }
}

/** 검증 배지 — `✓ 검증됨 · ~2026-12-01까지` · `✓ 검증됨` · `만료`. 이름은 없다(공개 방문자에게 회원의 신원을 보이지 않는다 · VF-2b). 검증 안 됨은 빈 칸. */
export function verificationBadge(cell: Record<string, unknown>): PublicCell {
  if (cell.state !== 'verified') return EMPTY
  if (cell.expired === true) return { kind: 'text', text: '만료' }
  const until = typeof cell.expires_at === 'string' ? cell.expires_at.slice(0, 10) : null
  return { kind: 'text', text: until === null ? '✓ 검증됨' : `✓ 검증됨 · ~${until}까지` }
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
