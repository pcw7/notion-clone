-- 레이아웃의 직전 버전 — 한 단계 되돌리기 — 항목 레이아웃 3e-1조각 (F-16-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 레이아웃의 직전 버전
--       16-item-layout.md F-16-12 *"직전 버전 1개를 `page_layout_history` 에 남겨 `실행 취소` 를 1스텝 제공한다"*
--
-- 레이아웃 변경은 데이터베이스의 모든 행 · 모든 사람의 화면을 바꾼다 — 한 번의 실수를 되돌릴 길을 둔다. 한 단계뿐이다: 소스마다 한 행이고,
-- 바뀐 적용이 적용 **전**의 레이아웃을 덮어쓴다. 되돌리기는 그 스냅샷을 새 적용으로 쓰고(version 이 오른다) 기록을 지운다.
--
-- 정본 DDL 에 더한 것: 없다 — 정본 [보강] 이 이 표를 처음 적었다(3e-1). 표현 가능한 불변식은 CHECK 로(버전 ≥ 1 · 스냅샷은 객체).
--
-- 기존 행: 없다(새 표).

CREATE TABLE page_layout_history (
  data_source_id uuid PRIMARY KEY REFERENCES data_source(id) ON DELETE CASCADE,
  -- 이 스냅샷을 남긴 적용의 결과 버전 — 되돌리기는 지금 버전이 이것일 때만 한다.
  after_version bigint NOT NULL,
  -- 적용 전의 레이아웃 — 적용 입력과 같은 모양(order · hidden · pinned · main · panel · settings).
  snapshot jsonb NOT NULL,
  changed_by uuid NULL REFERENCES "user"(id),
  changed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_page_layout_history_version CHECK (after_version >= 1),
  CONSTRAINT ck_page_layout_history_snapshot CHECK (jsonb_typeof(snapshot) = 'object')
);

COMMENT ON TABLE page_layout_history IS
  '레이아웃의 직전 버전 한 단계(정본 §3.6 [보강] · 16 F-16-12) — 되돌리기가 이 스냅샷을 새 적용으로 쓰고 지운다.';
