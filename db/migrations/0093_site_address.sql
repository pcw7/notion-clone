-- 사이트 주소 — 워크스페이스의 주소 · 페이지의 슬러그 — 게시 · 공유 6c-1조각 (F-13-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 끝 [보강] 사이트 주소 (DDL · ①~⑥)
--       13-*.md F-13-08 *"URL slug 를 편집한다(최대 60자, 영문/숫자/하이픈)"* · 데이터 모델 함의의 `site_domain`
--
-- ① `site_domain` — 워크스페이스의 사이트 주소. 지금은 하위 주소(`subdomain`)만 — 커스텀 도메인은 F-13-09(DNS 검증)과 함께 넓힌다.
--    주소는 모두에게 하나 · 워크스페이스마다 하위 주소 하나.
-- ② `public_link.workspace_id` · `slug` — 슬러그는 워크스페이스 안에서 하나다. `workspace_id` 는 넣을 때 블록에서 채운다(트리거 —
--    넣는 길이 무엇이든 블록의 워크스페이스와 어긋나지 않는다 · 블록은 워크스페이스를 옮기지 않는다).
--
-- 기존 행: `public_link` 의 `workspace_id` 를 블록에서 채운 뒤 NOT NULL. 슬러그는 비어 있다.

CREATE TABLE site_domain (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'subdomain'
               CONSTRAINT ck_site_domain_kind CHECK (kind IN ('subdomain')),
  name         text NOT NULL
               CONSTRAINT ck_site_domain_name CHECK (name ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  created_by   uuid NULL REFERENCES "user"(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_site_domain_name ON site_domain (name);
CREATE UNIQUE INDEX ux_site_domain_workspace ON site_domain (workspace_id) WHERE kind = 'subdomain';

COMMENT ON TABLE site_domain IS
  '6c-1 · F-13-08: 워크스페이스의 사이트 주소(/s/{name}/{slug}). 판정은 공개 링크의 것 — 주소는 덧붙는 이름이다.';

ALTER TABLE public_link ADD COLUMN workspace_id uuid NULL REFERENCES workspace(id) ON DELETE CASCADE;
UPDATE public_link l SET workspace_id = b.workspace_id FROM block b WHERE b.id = l.node_id;
ALTER TABLE public_link ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public_link ADD COLUMN slug text NULL
  CONSTRAINT ck_public_link_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 60);
CREATE UNIQUE INDEX ux_public_link_slug ON public_link (workspace_id, slug) WHERE slug IS NOT NULL;

-- 넣을 때 블록의 워크스페이스를 쓴다 — 주는 값은 무시한다(어긋날 길을 두지 않는다)
CREATE FUNCTION public_link_workspace() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT b.workspace_id INTO NEW.workspace_id FROM block b WHERE b.id = NEW.node_id;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_public_link_workspace
  BEFORE INSERT ON public_link
  FOR EACH ROW EXECUTE FUNCTION public_link_workspace();
