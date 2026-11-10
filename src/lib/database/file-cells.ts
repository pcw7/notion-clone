/**
 * 파일 칸(`files`)의 파일 확인 — 파일과 미디어 속성 PT-4조각 (F-03-04)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 PT-1] ⑧ · §3.10 `file`(불변식 FS1)
 *
 * 칸이 가리키는 파일은 **이 워크스페이스의 파일**이어야 한다. 칸 가드(0139)가 마지막 문이고, 여기서는 쓰기 전에 읽어 필드별 오류를 준다
 * (가드가 던지면 사용자는 "왜 저장이 안 되는지" 모르는 500 을 본다). 참조 수(`file.ref_count`)는 DB 트리거(0139 `tg_ppv_files_refs`)가
 * 센다 — 칸을 쓰는 모든 길(셀 쓰기 · 템플릿 · 데이터베이스 복제 · 영구 삭제의 CASCADE)이 같은 장부를 지나게.
 */

import type { Tx } from '../db/tx.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'
import { fileIdsOf, type CellValue } from './property-types.ts'

/** 칸들이 가리키는 파일 가운데 이 워크스페이스에 없는 것의 오류. 쓰기 트랜잭션에서 부른다. */
export async function fileIssuesIn(
  tx: Tx,
  workspaceId: string,
  cells: readonly { readonly propertyId: string; readonly value: CellValue }[],
): Promise<ValidationIssue[]> {
  const wanted = cells.flatMap((cell) => fileIdsOf(cell.value).map((id) => id.toLowerCase()))
  if (wanted.length === 0) return []
  const known = await tx.query<{ id: string }>(`SELECT id FROM file WHERE id = ANY($1::uuid[]) AND workspace_id = $2`, [
    [...new Set(wanted)],
    workspaceId,
  ])
  const ok = new Set(known.map((row) => row.id))
  const issues: ValidationIssue[] = []
  for (const cell of cells) {
    for (const [i, id] of fileIdsOf(cell.value).entries()) {
      if (!ok.has(id.toLowerCase())) issues.push({ path: `cells.${cell.propertyId}.files[${i}].id`, message: '이 워크스페이스의 파일이 아닙니다' })
    }
  }
  return issues
}
