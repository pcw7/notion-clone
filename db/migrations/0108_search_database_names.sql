-- 데이터베이스 자신의 이름 색인 — 색인 단위를 페이지 · 데이터베이스 노드로 넓힌다 · 플랫폼 잔여 10p-2조각 (F-07-01)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 [보강] 데이터베이스 자신의 이름 색인 ① · ⑦
--       07-search-navigation.md F-07-01 *"검색 대상 — 페이지 제목 · 본문 · 데이터베이스 엔트리 이름과 property 값"*
--
-- 0012 는 색인 행을 `type='page'` 블록에만 만들고 CHECK(`ck_search_page_scoped`)으로 묶었다. 그 머리말이 *"블록 단위로 확장하면 이 CHECK 을
-- 떼는 마이그레이션이 그 변경의 일부가 된다 — 조용히 의미가 달라지지 않게"* 라고 적어 두었다. 이 마이그레이션이 그것이다:
--
--   ① CHECK — 색인 행은 페이지 · 데이터베이스 노드다(본문 블록은 여전히 아니다). 노드 단위 색인이므로 `page_id = doc_id` 는 그대로
--   ② 트리거 — 정의의 `WHEN` 을 두 종류로 넓힌다(함수는 그대로 — 노드 종류를 가리지 않는다). 본문 블록에서 호출 자체를 건너뛰는 이유는
--      0012 그대로다
--   ③ 이미 있는 데이터베이스의 색인 행 — 메타는 트리거와 같은 칸, 제목은 블록의 제목 투영(`properties.title` 의 `plain_text` 를 이은 값 —
--      0107 · 앱의 `toPlainText` 와 같은 규칙). 빈 제목은 NULL. 본문 · `lang` 은 없다
--
-- 앞으로의 이름은 앱이 쓴다(`createDatabase` · `renameDatabase` 가 `indexPageTitle` 로 — 페이지와 같다).

ALTER TABLE search_document DROP CONSTRAINT ck_search_page_scoped;
ALTER TABLE search_document
  ADD CONSTRAINT ck_search_node_scoped CHECK (type IN ('page', 'database') AND page_id = doc_id);

DROP TRIGGER tg_search_document_sync ON block;
CREATE TRIGGER tg_search_document_sync
  AFTER INSERT OR UPDATE ON block
  FOR EACH ROW WHEN (NEW.type IN ('page', 'database'))
  EXECUTE FUNCTION search_document_sync();

INSERT INTO search_document (
  doc_id, workspace_id, region_id, page_id, parent_id, type,
  ancestor_ids, perm_scope_id, in_trash, version,
  created_by, created_at, last_edited_by, last_edited_at,
  title_text
)
SELECT
  b.id, b.workspace_id, w.region_id, b.id,
  CASE WHEN b.parent_type = 'block' THEN b.parent_id END,
  b.type, b.ancestor_path, b.perm_scope_id,
  b.lifecycle = 'trashed', b.version,
  b.created_by, b.created_at, b.last_edited_by, b.last_edited_at,
  -- 배열이 아닌 제목은 건너뛴다 — `CASE` 로 감싼다(0107 과 같은 까닭 · AND 는 평가 차례를 보장하지 않는다)
  NULLIF(
    CASE WHEN jsonb_typeof(b.properties -> 'title') = 'array' THEN
      (SELECT string_agg(CASE WHEN jsonb_typeof(r.run -> 'plain_text') = 'string' THEN r.run ->> 'plain_text' ELSE '' END, '' ORDER BY r.ord)
         FROM jsonb_array_elements(b.properties -> 'title') WITH ORDINALITY AS r(run, ord))
    END,
    '')
FROM block b
JOIN workspace w ON w.id = b.workspace_id
WHERE b.type = 'database' AND b.lifecycle <> 'purged'
ON CONFLICT (doc_id) DO NOTHING;

COMMENT ON TABLE search_document IS
  'F-07-06. 색인 정본(정본 §3.9). 색인 행은 페이지 · 데이터베이스 노드다(0108 — 그 전은 페이지만).
   텍스트(title_text·body_text·lang)는 앱이 쓰고, 메타(perm_scope_id·in_trash·
   ancestor_ids·version)는 tg_search_document_sync 트리거가 block 에서 따라간다 —
   권한 축을 앱이 복사하면 누락이 권한 누출이 되기 때문이다.';
