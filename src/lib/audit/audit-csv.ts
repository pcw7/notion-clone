/**
 * 감사 로그 CSV (게시 · 공유 6d-2 · F-11-12 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.8 끝 [보강] 감사 로그 ⑥
 *
 * 화면과 같은 말(`audit-labels.ts`) · 모든 칸에 수식 막기(`textTableToCsv` — 이름 · 메일 · 설정 값은 남이 쓴 글자다).
 */

import { textTableToCsv } from '../export/csv.ts'
import { AUDIT_TYPE_LABEL, auditActor, auditDetail } from './audit-labels.ts'
import type { AuditRow } from './audit-types.ts'

export function auditCsv(rows: readonly AuditRow[]): string {
  return textTableToCsv(
    ['시각', '종류', '누가', '대상', '세부', 'IP'],
    rows.map((row) => [
      row.occurredAt,
      AUDIT_TYPE_LABEL[row.type],
      auditActor(row),
      row.target === null ? '' : `${row.target.type} ${row.target.id}`,
      auditDetail(row),
      row.ip ?? '',
    ]),
  )
}
