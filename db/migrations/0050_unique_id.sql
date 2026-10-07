-- 고유 ID(unique_id) — DB 심화 2a-1조각 (F-03-09)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] 고유 ID(`unique_id`) ① ④ ⑦ ⑧
--       03-database-core.md F-03-09
--
-- 0013 이 자리(`data_source.unique_id_counter` · `unique_id_prefix` · `page.unique_seq` · `ux_page_unique_seq`)를 이미 뒀다.
-- 이 파일은 그 자리에 걸린 불변식을 올리고 필터 연산자를 싣는다. 번호를 주는 것은 애플리케이션(`database/unique-id.ts`)이다.

-- ──────────────────────────────────────────────────────────────────────
-- U1 — ID 프로퍼티는 data source 하나에 (살아 있는 것) 하나
-- ──────────────────────────────────────────────────────────────────────
--
-- 번호의 주인은 data source 다(카운터가 거기 있다). 프로퍼티는 그 번호를 보여 주는 칸이므로 둘이면 같은 번호를 두 칸에 그린다.
-- 지운 것(`deleted_at`)은 세지 않는다 — 지운 ID 프로퍼티가 있어도 새로 더할 수 있어야 하고(정본 ⑤), 그때 지운 쪽을 되살리는
-- 명령이 거부한다(`property.ts` `restoreProperty`).
CREATE UNIQUE INDEX ux_property_unique_id_one ON property (data_source_id)
  WHERE type = 'unique_id' AND deleted_at IS NULL;

-- ──────────────────────────────────────────────────────────────────────
-- ⑦ 접두사 — 대문자 영숫자 2~7자 (또는 없음)
-- ──────────────────────────────────────────────────────────────────────
--
-- 03 이 두 2차 출처로 교차 확인한 길이다. 대소문자를 가리지 않고 받아 **대문자로 저장한다** — 소문자가 들어올 길을 DB 가 막아야
-- "같은 접두사"를 비교할 때 `upper()` 를 매번 걸지 않는다(워크스페이스 안에서 유일 — 단축 주소를 들일 때).
ALTER TABLE data_source
  ADD CONSTRAINT ck_data_source_unique_id_prefix
  CHECK (unique_id_prefix IS NULL OR unique_id_prefix ~ '^[A-Z0-9]{2,7}$');

-- ──────────────────────────────────────────────────────────────────────
-- U2 — 템플릿은 번호를 받지 않는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 템플릿은 목록에 없는 행이다(R1). 번호를 주면 사용자가 본 적 없는 번호가 소비되고, 템플릿이 번호를 들고 있으면 템플릿으로
-- 만든 행이 그것을 복사해 오는 길이 생긴다(`ux_page_unique_seq` 가 막겠지만 이유가 화면에 닿지 않는다).
ALTER TABLE page
  ADD CONSTRAINT ck_page_template_no_unique_seq
  CHECK (NOT is_template OR unique_seq IS NULL);

-- ──────────────────────────────────────────────────────────────────────
-- ⑧ 필터 연산자 — 숫자의 비교 여섯
-- ──────────────────────────────────────────────────────────────────────
--
-- 비어 있음 · 비어 있지 않음은 없다: ID 프로퍼티가 살아 있는 동안 목록의 모든 행이 번호를 가진다(번호가 없는 것은 템플릿뿐이다).
-- 값은 번호다(접두사를 떼고) — 접두사는 표 전체에 하나라 거를 뜻이 없다.
INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('unique_id', 'equals',                   1, '같음',     1),
  ('unique_id', 'does_not_equal',           1, '같지 않음', 2),
  ('unique_id', 'greater_than',             1, '초과',     3),
  ('unique_id', 'greater_than_or_equal_to', 1, '이상',     4),
  ('unique_id', 'less_than',                1, '미만',     5),
  ('unique_id', 'less_than_or_equal_to',    1, '이하',     6);
