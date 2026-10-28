-- 날짜 속성의 상대 날짜 필터 연산자 — 상대 날짜 필터 트랙 R-1 (F-04-09 · F-03-17)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 R-1] 상대 날짜로 거르기
--       0015 의 카탈로그 머리말이 "뺀 것" 으로 남긴 상대 날짜(`past_week` · `this_week` 류). 그때 뺀 까닭은 결과 캐시였다(평가 시점 의존 —
--       불변식 VW1 의 캐시 키가 평가일로 쪼개진다). 결과 캐시는 아직 없다 — [보강] 사람 속성 ⑪ 의 "나" 와 같은 태도로, 캐시를 둘 때 그 키에
--       평가일을 넣는다. 연산자 집합은 03 F-03-17 의 전수표(API 의 일곱) 그대로다.
--
-- 값이 없는 연산자 일곱 — 범위는 `src/lib/database/relative-date.ts` 가 보는 사람의 오늘에서 펴고, SQL 조각은 `src/lib/database/filter.ts`
-- 의 날짜 연산자가 만든다. 두 곳의 일치는 `filter.db.test.ts` 가 강제한다. 비어 있음 · 비어 있지 않음 뒤에 둔다(새 규칙의 기본 연산자는
-- 첫 줄 그대로다).
--
-- 기존 행: 새 행만 더한다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('date', 'past_week',  0, '지난 1주 안',   8),
  ('date', 'past_month', 0, '지난 1개월 안', 9),
  ('date', 'past_year',  0, '지난 1년 안',  10),
  ('date', 'this_week',  0, '이번 주',      11),
  ('date', 'next_week',  0, '다음 1주 안',  12),
  ('date', 'next_month', 0, '다음 1개월 안', 13),
  ('date', 'next_year',  0, '다음 1년 안',  14);
