/**
 * 필터 연산자 카탈로그 읽기 — W8-b (F-03-17)
 *
 * 정본: 마이그레이션 0015 `filter_operator` 머리말
 *
 * 필터 패널의 연산자 드롭다운은 **이 함수가 읽은 것을 그린다.** 화면 코드에
 * 연산자 목록을 박지 않는다 — F-03-17 이 카탈로그를 데이터로 두라고 한 이유가
 * *"새 타입을 추가하면 필터 UI 가 자동으로 따라온다"* 이고, 화면이 따로 목록을
 * 들고 있으면 그 효과가 사라진다.
 *
 * 컴파일러(`filter.ts`)가 아는 연산자와 이 표가 같다는 것은 `filter.db.test.ts` 가
 * **이 함수를 통해** 확인한다. 테스트가 SQL 을 따로 쓰면 "테스트는 맞는데 화면이
 * 읽는 경로는 틀린" 구간이 생긴다.
 *
 * 권한을 묻지 않는다. 사용자 데이터가 아니라 제품의 어휘다 — 어느 워크스페이스에서나
 * 같고, 마이그레이션만 이 표를 쓴다.
 */

import { withReadTransaction } from '../db/tx.ts'
import { isMvpPropertyType, type MvpPropertyType } from './property-types.ts'

export type OperatorCatalogEntry = {
  readonly propertyType: MvpPropertyType
  readonly operator: string
  /** 값이 몇 개 필요한가. 0 이면 화면이 값 입력칸을 그리지 않는다. */
  readonly arity: 0 | 1
  readonly label: string
}

/** 타입별로 `order_idx` 순. MVP 밖 타입의 행은 싣지 않는다(고를 수 없는 것을 보여주지 않는다). */
export async function readOperatorCatalog(): Promise<OperatorCatalogEntry[]> {
  const rows = await withReadTransaction((tx) =>
    tx.query<{ property_type: string; operator: string; arity: number; label_ko: string }>(
      `SELECT property_type::text AS property_type, operator, arity, label_ko
         FROM filter_operator
        ORDER BY property_type, order_idx`,
    ),
  )
  return rows
    .filter((r) => isMvpPropertyType(r.property_type))
    .map((r) => ({
      propertyType: r.property_type as MvpPropertyType,
      operator: r.operator,
      arity: r.arity === 0 ? 0 : 1,
      label: r.label_ko,
    }))
}
