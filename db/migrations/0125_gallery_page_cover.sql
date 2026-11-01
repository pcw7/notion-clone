-- 갤러리 카드의 미리보기에 페이지 커버 — `view.configuration.gallery.cover` 에 'page_cover' — 34번 트랙 PC-5 (F-04-05 · F-02-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 갤러리 ④ · §3.4 [보강 PC-5]
--       04-database-views.md F-04-05 *"`view.configuration = { cover: {type, property_id?}, … }`"* — 0057 은 "페이지 커버(F-02-06) · 파일 속성이 생기면
--       `cover` 에 더한다" 고 적었다. 페이지 커버가 섰다(PC-1~4).
--
-- 0057 의 CHECK 을 다시 세운다 — 미리보기의 셋째 값 'page_cover'(행 페이지의 커버). 나머지 규칙(한 키 · 세 키를 늘 함께 · `IS TRUE`)은 그대로다.
-- 기존 행: 'page_content' · 'none' 뿐이다 — 바꿀 행이 없다.

ALTER TABLE view DROP CONSTRAINT ck_view_gallery_layout;
ALTER TABLE view
  ADD CONSTRAINT ck_view_gallery_layout
  CHECK (
    NOT (configuration ? 'gallery')
    OR (
      jsonb_typeof(configuration -> 'gallery') = 'object'
      AND (configuration -> 'gallery' ->> 'cover') IN ('page_content', 'page_cover', 'none')
      AND (configuration -> 'gallery' ->> 'cover_size') IN ('small', 'medium', 'large')
      AND (configuration -> 'gallery' ->> 'cover_aspect') IN ('cover', 'contain')
    ) IS TRUE
  );
