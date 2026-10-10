-- 버튼 블록 — 자동화 5e-1조각 (F-08-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑰
--
-- ① 버튼 블록마다 automation 하나 — 처음 저장하거나 누를 때 만든다(둘이 동시에 만들어도 하나 · `ON CONFLICT`). 블록이 본문에서 지워지면
--    그 행이 지워지고 automation 도 함께 사라진다(`host_page_id` FK CASCADE — 0078).
--
-- 블록 타입 `button` 은 스키마를 바꾸지 않는다(`block.type` 에는 CHECK 이 없다 — 등록부 `block/types.ts` 가 정한다).
--
-- 기존 행: 버튼 블록의 automation 은 아직 없다.

CREATE UNIQUE INDEX ux_automation_button_block ON automation (host_page_id) WHERE kind = 'button_block';
