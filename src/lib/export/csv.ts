/**
 * 데이터베이스 → CSV — F-09-14 (Markdown & CSV 익스포트)
 *
 * 정본: 09-api-integrations.md F-09-14 — *"풀페이지 데이터베이스당 `.csv` 1개"*
 *       04-database-views.md F-04-26 엣지 케이스 — 빈 결과 · 빈 칸
 *
 * ──────────────────────────────────────────────────────────────────────
 * 값은 표 화면과 같은 함수로 읽는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `properties_cache` 의 칸은 계약을 어겼을 수 있다(타입 변환 이전의 옛 셀). `readCell` 이 그런
 * 칸을 빈 값으로 읽고, 표 화면(`database-table.tsx`)도 같은 함수를 쓴다. 규칙을 두 벌로 두면
 * **"표에는 빈 칸인데 CSV 에는 값이 있는"** 파일이 나온다.
 *
 * select 는 옵션 **id** 를 이름으로 바꾼다(HANDOFF §3.2-8 — 셀은 id 를 담는다). 지워진 옵션은 빈
 * 칸이다(F-03-04). 날짜는 적힌 ISO 그대로 쓴다 — 화면용 `formatDate`("2026년 9월 13일")는 다시
 * 읽을 수 없다. 체크박스는 노션 CSV 와 같은 `Yes` · `No` 다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 사람이 Excel 로 여는 파일이다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - **BOM** 을 붙인다. 없으면 Excel 이 UTF-8 을 시스템 코드페이지로 읽어 한글이 깨진다
 *   - 줄 끝은 **CRLF**(RFC 4180). 칸 안의 줄바꿈은 따옴표 안에 그대로 둔다
 *   - **수식 주입.** `=` `+` `-` `@` 탭 · CR 로 시작하는 칸은 Excel 이 수식으로 실행한다.
 *     워크스페이스의 다른 멤버가 쓴 칸(`=HYPERLINK(...)`)이 내보낸 사람의 PC 에서 실행되는
 *     경로다. 사용자가 쓴 글자(제목 · 글 · select 이름 · 열 이름)에만 `'` 를 앞에 붙이고 센다
 *     (OWASP CSV Injection 권고). 우리가 만드는 값(숫자 `-5` · 날짜)에는 붙이지 않는다 —
 *     `-5` 는 수식이 아니라 숫자이고, 붙이면 숫자 열이 글자 열이 된다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 어떤 열 · 어떤 행을 담을지는 호출자가 정한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-26(뷰 단위 내보내기)은 *"뷰 설정이 곧 파일 스키마"* 라고 하지만 그건 **뷰를 내보내는**
 * 기능이다. 백업(F-09-14)에 뷰의 필터를 걸면 행이 조용히 빠진다. 그 판단은 조립 단계의 몫이고
 * 이 파일은 받은 열과 행만 직렬화한다.
 */

import { toPlainText } from '../contracts/rich-text.ts'
import { readCell } from '../database/cell-format.ts'
import { optionIdOf, type MvpPropertyType, type SelectOption } from '../database/property-types.ts'

export type CsvColumn = {
  readonly propertyId: string
  readonly name: string
  readonly type: MvpPropertyType
  /** select 의 옵션. 셀은 id 를 담으므로 이름을 여기서 찾는다. */
  readonly options?: readonly SelectOption[]
}

export type CsvRow = {
  /** `properties_cache` — 프로퍼티 id → 셀 봉투. */
  readonly cells: Readonly<Record<string, unknown>>
}

export type CsvResult = {
  readonly csv: string
  /** 수식으로 실행되지 않게 `'` 를 붙인 칸 수(열 이름 포함). 익스포트 보고서가 싣는다. */
  readonly guardedFormulas: number
}

const BOM = '\uFEFF'
const FORMULA_LEAD = /^[=+\-@\t\r]/

/**
 * 열과 행을 CSV 파일 내용으로.
 *
 * 행이 없어도 헤더 줄은 쓴다 — 파일이 비어 있으면 사용자는 실패로 읽는다(F-04-26).
 */
export function tableToCsv(columns: readonly CsvColumn[], rows: readonly CsvRow[]): CsvResult {
  let guardedFormulas = 0
  const userText = (value: string): string => {
    if (!FORMULA_LEAD.test(value)) return value
    guardedFormulas += 1
    return `'${value}`
  }

  const lines = [columns.map((column) => field(userText(column.name))).join(',')]
  for (const row of rows) {
    const cells = columns.map((column) => {
      const text = cellPlainText(column, row.cells[column.propertyId])
      return field(USER_TEXT.has(column.type) ? userText(text) : text)
    })
    lines.push(cells.join(','))
  }
  return { csv: `${BOM}${lines.join('\r\n')}\r\n`, guardedFormulas }
}

/** 사용자가 쓴 글자를 담는 타입. 수식 막기는 이것에만 건다(머리말). */
const USER_TEXT: ReadonlySet<MvpPropertyType> = new Set(['title', 'rich_text', 'select', 'status'])

/**
 * 칸 하나의 글자. CSV 와 행 Markdown 의 속성 줄(`plan.ts`)이 **같은 규칙**을 쓴다.
 *
 * 수식 막기는 여기 없다 — Excel 이 여는 CSV 만의 일이다.
 */
export function cellPlainText(column: CsvColumn, raw: unknown): string {
  const value = readCell(column.type, raw)
  switch (value.type) {
    case 'title':
      return toPlainText(value.title)
    case 'rich_text':
      return toPlainText(value.rich_text)
    case 'number':
      return value.number === null ? '' : String(value.number)
    case 'select':
    case 'status': {
      const id = optionIdOf(value)
      return id === null ? '' : (column.options?.find((option) => option.id === id)?.name ?? '')
    }
    case 'checkbox':
      return value.checkbox ? 'Yes' : 'No'
    case 'date':
      if (value.date === null) return ''
      // 범위는 노션 CSV 처럼 ` → ` 로 잇는다. `end: null` 과 `end` 없음은 같은 뜻이다.
      return value.date.end ? `${value.date.start} → ${value.date.end}` : value.date.start
  }
}

/**
 * RFC 4180. 따옴표 · 쉼표 · 줄바꿈이 있으면 따옴표로 감싸고 안의 `"` 는 둘로 쓴다.
 *
 * 앞뒤 공백은 감싸지 않는다 — RFC 4180 은 공백을 필드의 일부로 본다. 처음에는 공백도 감쌌는데
 * 그 규칙을 빼도 python csv 가 같은 칸을 읽었고, 감싸지 않은 공백을 지우는 도구를 실제로 확인하지
 * 못했다. 증명하지 못한 규칙은 남기지 않았다.
 */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
