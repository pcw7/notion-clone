/**
 * 검증 배지의 상태를 SQL 한 조각으로(VF-4 · 정본 [보강 VF-1] ⑥ ⑦) — 검색 결과 · 페이지 멘션이 같은 식을 쓴다.
 *
 * 행 페이지이고, 그 데이터 소스에 살아 있는 검증 속성이 있고, 행에 검증 칸이 있을 때만 값이 나온다. 만료는 읽을 때 정한다
 * (`expires_at <= now()` — `isVerificationExpired` 와 같은 비교 · 어디에도 적지 않는다).
 */

export type VerificationBadge = 'verified' | 'expired'

/** `idExpr`(페이지 id 를 내는 SQL 식)의 배지 — 'verified' | 'expired' | NULL. 상관 서브쿼리라 결과 건수만큼만 돈다. */
export function verificationBadgeSql(idExpr: string): string {
  return `(SELECT CASE WHEN v.value ->> 'expires_at' IS NOT NULL AND (v.value ->> 'expires_at')::timestamptz <= now()
                       THEN 'expired' ELSE 'verified' END
             FROM page vp
             JOIN property vpr ON vpr.data_source_id = vp.data_source_id AND vpr.type = 'verification' AND vpr.deleted_at IS NULL
             JOIN page_property_value v ON v.page_id = vp.id AND v.property_id = vpr.id
            WHERE vp.id = ${idExpr} AND v.value ->> 'state' = 'verified'
            LIMIT 1)`
}
