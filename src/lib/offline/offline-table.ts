/**
 * 내려받은 데이터베이스를 표로 — 껍데기가 그릴 것을 정하는 순수한 부분 (OF-4 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑤)
 *
 * 내려받은 데이터베이스는 **첫 뷰의 처음 50행을 읽기 전용으로**(노션과 같은 상한) 둔다. 서버(`offline-database.ts`)가 행을 고르고 칸을 보이는
 * 글자로 바꿔 보내므로 여기는 그 글자를 열 차례대로 늘어놓고 알릴 말을 정하기만 한다 — DOM 없이 검사한다(`offline-table.test.ts`).
 *
 *   - 50행에서 끊겼으면 "처음 50행" 을 말한다 · 행을 그리는 뷰가 없었으면(폼 · 대시보드뿐) 열이 없다 — 그렇다고 말한다
 *   - 제목 칸이 비었으면 "제목 없음"(표 화면과 같다)
 *   - 행을 눌러도 행 페이지는 열지 않는다 — 받지 않았다(온라인에서만)
 */

import type { OfflineDatabaseRecord } from './offline-store.ts'

/** 내려받는 행 수의 상한 — 노션과 같다. 서버가 이만큼 읽고, 더 있으면 `truncated`. */
export const OFFLINE_DATABASE_ROWS = 50

/** 행을 눌렀을 때 — 행 페이지는 받지 않았다. */
export const ROW_ONLINE_ONLY = '행 페이지는 온라인에서 열 수 있습니다.'

const UNTITLED = '제목 없음'

export type OfflineTable = {
  readonly columns: readonly { readonly id: string; readonly name: string }[]
  /** 칸은 열 차례대로. */
  readonly rows: readonly { readonly id: string; readonly cells: readonly string[] }[]
  /** 50행에서 끊겼다는 말 — 아니면 null. */
  readonly note: string | null
  /** 그릴 행이 없을 때의 말 — 있으면 null. */
  readonly empty: string | null
}

export function offlineTable(record: Pick<OfflineDatabaseRecord, 'columns' | 'rows' | 'truncated'>): OfflineTable {
  const note = record.truncated ? `처음 ${OFFLINE_DATABASE_ROWS}행만 내려받았습니다 — 나머지는 온라인에서 볼 수 있습니다.` : null
  if (record.columns.length === 0) {
    return { columns: [], rows: [], note: null, empty: '표로 볼 수 있는 뷰가 없어 내려받은 행이 없습니다.' }
  }
  const columns = record.columns.map((c) => ({ id: c.id, name: c.name }))
  const rows = record.rows.map((row) => ({
    id: row.id,
    cells: record.columns.map((c) => {
      const text = row.cells[c.id] ?? ''
      return c.type === 'title' && text === '' ? row.title || UNTITLED : text
    }),
  }))
  return { columns, rows, note, empty: rows.length === 0 ? '이 뷰에 보이는 행이 없습니다.' : null }
}
