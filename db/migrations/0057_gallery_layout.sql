-- 갤러리 레이아웃 — 카드 미리보기 · 크기 · 맞춤 — DB 심화 2f-2조각 (F-04-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 갤러리 ④
--       04-database-views.md F-04-05 *"`view.configuration = { cover, cover_size, cover_aspect, … }`"*
--
-- `view.configuration` 은 0015 부터 `jsonb NOT NULL`("type 별 discriminated union") 자리만 있었고 아무도 쓰지 않았다(`'{}'`). 갤러리가
-- 첫 손님이다 — `configuration.gallery = { cover, cover_size, cover_aspect }` 한 키에 둔다(다른 종류의 키와 섞이지 않게 · 04 의 *"JSON 전체
-- 교체 금지"*). 셋 다 늘 쓴다(명령이 지금 값 위에 합쳐서 쓴다 · `database/gallery.ts`). 값의 목록은 그 파일의 상수와 같다.
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 키가 빠지면 `->>` 가 NULL 이고 `NULL IN (…)` 도 NULL 이다. 묶음 전체를 `IS TRUE` 로 접는다(0055 와 같은 함정).

ALTER TABLE view
  ADD CONSTRAINT ck_view_gallery_layout
  CHECK (
    NOT (configuration ? 'gallery')
    OR (
      jsonb_typeof(configuration -> 'gallery') = 'object'
      AND (configuration -> 'gallery' ->> 'cover') IN ('page_content', 'none')
      AND (configuration -> 'gallery' ->> 'cover_size') IN ('small', 'medium', 'large')
      AND (configuration -> 'gallery' ->> 'cover_aspect') IN ('cover', 'contain')
    ) IS TRUE
  );
