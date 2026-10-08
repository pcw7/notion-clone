-- 개인 필터 · 정렬 — 나에게만 적용하는 뷰 설정 — DB 심화 2h-1조각 (F-04-17)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 `view_user_override` · [보강] 개인 필터 · 정렬
--       04-database-views.md F-04-17
--
-- 정본이 `view_user_override (view_id, user_id, filter, sorts)` 를 정의해 두었고 MVP 는 미뤘다(04 의 클론 대안 *"MVP 는 모든 필터 변경을
-- 즉시 전체 저장"*). 이제 연다.
--
-- ① **대체(replace)다** — 04 권고 *"개인 필터는 공유 필터를 대체한다. AND 결합으로 하면 사용자가 공유 필터를 완화할 방법이 없다"*.
--    NULL 은 "덮어쓰지 않았다"(공유 것을 쓴다)이고, 빈 값(필터는 빈 묶음 · 정렬은 `[]`)은 "나는 아무것도 걸지 않는다"다. 그래서 두 칸 모두
--    NULL 인 행은 뜻이 없다 — CHECK 이 막는다(지우는 명령이 행을 지운다).
-- ② 사용자를 지우면 함께 사라진다 · 뷰를 지우면 함께 사라진다(04 *"뷰 삭제 / 사용자 탈퇴 → override cascade 삭제"*).
-- ③ 모양: filter 는 객체(FilterNode) · sorts 는 배열. 안의 검증은 명령이 한다(`validateFilter` · `validateSorts` — 공유 것과 같은 함수).

CREATE TABLE view_user_override (
  view_id    uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  filter     jsonb NULL,
  sorts      jsonb NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (view_id, user_id),
  CONSTRAINT ck_view_user_override_some CHECK (filter IS NOT NULL OR sorts IS NOT NULL),
  CONSTRAINT ck_view_user_override_shape CHECK (
    (filter IS NULL OR jsonb_typeof(filter) = 'object') AND (sorts IS NULL OR jsonb_typeof(sorts) = 'array')
  )
);

-- 사용자를 지울 때 그 사람의 것을 찾는다(PK 는 view_id 가 앞이다).
CREATE INDEX ix_view_user_override_user ON view_user_override (user_id);
