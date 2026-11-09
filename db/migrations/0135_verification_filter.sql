-- 검증 속성의 필터 연산자 — 같음 · 같지 않음 — VF-2b조각 (F-03-23 · F-03-17)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 VF-1] ⑥ (필터 `is` · `is_not` — 값 검증됨 · 만료 · 검증 안 됨)
--       0015 §③ `filter_operator` (타입별 연산자 카탈로그)
--
-- 값은 `verified` · `expired` · `unverified` 셋이다. 만료는 저장하지 않으므로(①) 컴파일러가 칸의 `expires_at` 을 평가 시각과 견준다 —
-- SQL 조각은 `src/lib/database/filter.ts` 에 있고 두 곳의 일치는 `filter.db.test.ts` 가 강제한다. 검증 안 됨은 칸이 없는 행도 맞는다.
--
-- 기존 행: 새 행만 더한다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('verification', 'is',     1, '같음',     1),
  ('verification', 'is_not', 1, '같지 않음', 2);
