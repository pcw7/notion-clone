-- 데이터베이스 행의 제목 색인 — 이미 있는 색인을 채운다 · 플랫폼 잔여 10p-1조각 (F-07-01)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 [보강] 데이터베이스 행의 제목 색인 ④
--       07-search-navigation.md F-07-01 *"검색 대상 — 페이지 제목 · 본문 · 데이터베이스 엔트리 이름과 property 값"*
--
-- 행의 제목은 `title` 셀(EAV)이 정본이고 `block.properties.title` 은 투영이다. 투영하는 자리(`row.ts` `projectTitle`)가 이제 색인의 제목도
-- 쓰지만, 이미 있는 행은 색인의 제목이 비어 있다(행은 `createPage` · `renamePage` 를 지나지 않았다). 블록의 제목 투영으로 채운다 — 0012 의
-- 백필이 NULL 로 남긴 일반 페이지도 같은 규칙으로 함께 채운다.
--
-- 평문은 RichText 런의 `plain_text` 를 차례대로 이은 것이다 — 앱의 `toPlainText` 와 같은 규칙(문자열이 아닌 런은 빈 글자). 비어 있는
-- 제목은 쓰지 않는다(NULL 그대로). 본문(`body_text`) · `lang` 은 건드리지 않는다 — 색인의 tsvector 는 생성 컬럼이라 함께 바뀐다.

UPDATE search_document s
   SET title_text = t.plain
  FROM (
    -- 배열이 아닌 제목(옛 모양 · 스칼라)은 건너뛴다 — `CASE` 로 감싼다(SQL 의 AND 는 평가 차례를 보장하지 않는다 · 배열이 아닌 값에
    -- `jsonb_array_elements` 를 부르면 질의 전체가 던진다)
    SELECT b.id,
           CASE WHEN jsonb_typeof(b.properties -> 'title') = 'array' THEN
             (SELECT string_agg(CASE WHEN jsonb_typeof(r.run -> 'plain_text') = 'string' THEN r.run ->> 'plain_text' ELSE '' END, '' ORDER BY r.ord)
                FROM jsonb_array_elements(b.properties -> 'title') WITH ORDINALITY AS r(run, ord))
           END AS plain
      FROM block b
     WHERE b.type = 'page'
  ) t
 WHERE s.doc_id = t.id
   AND s.title_text IS NULL
   AND t.plain IS NOT NULL
   AND t.plain <> '';
