-- 웹 게시 — 공개 링크 — 게시 · 공유 6a-1조각 (F-06-08 · F-06-07 웹 링크 · F-17-11)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `public_link` · §3.3 끝 [정정] 웹 게시 ①~⑨ · §3.11 [정정 6a-1]
--       마스터 §9.4 *"공개 페이지 색인 기본값 `noindex`"*
--
-- ① `public_link` — 노드마다 한 줄. 정본 DDL 에 [정정] ① 기본값(`noindex` · AI 크롤러 `deny`)과 ⑦ FK · 감사 칸을 더했다.
--    게시 해제는 `enabled := false` 다 — 행과 토큰이 남아 다시 게시하면 같은 주소다(⑤). 블록이 물리 삭제되면 함께 간다(CASCADE).
--    짝 — `enabled` 면 토큰이 있다. 토큰은 무작위 128비트의 base64url 22자다.
-- ② `acl_entry` 의 `'public'` 주체를 막는다(②) — 공개의 레벨 · 만료 · 주소는 `public_link` 한 곳에 산다. 0010 이 주체 목록에
--    `'public'` 을 두었지만 쓰는 곳은 없었다.
--
-- 기존 행: 새 표 · `acl_entry` 에 `'public'` 행은 없다(쓰는 길이 없었다).

CREATE TABLE public_link (
  node_id          uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT false,
  level            text NOT NULL DEFAULT 'view'
                   CONSTRAINT ck_public_link_level CHECK (level IN ('view', 'comment', 'edit')),
  token            text NULL UNIQUE
                   CONSTRAINT ck_public_link_token CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  expires_at       timestamptz NULL,
  allow_duplicate  boolean NOT NULL DEFAULT true,
  robots_directive text NOT NULL DEFAULT 'noindex'
                   CONSTRAINT ck_public_link_robots CHECK (robots_directive IN ('index', 'noindex')),
  ai_crawler       text NOT NULL DEFAULT 'deny'
                   CONSTRAINT ck_public_link_ai_crawler CHECK (ai_crawler IN ('allow', 'deny')),
  created_by       uuid NULL REFERENCES "user"(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid NULL REFERENCES "user"(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_public_link_enabled_token CHECK (NOT enabled OR token IS NOT NULL)
);

ALTER TABLE acl_entry ADD CONSTRAINT ck_acl_no_public CHECK (principal_type <> 'public');
