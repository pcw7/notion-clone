-- 레벨 → capability 매트릭스
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 (level_capability)
--
-- 규칙 A2: level 은 전순서가 아니다. 비교는 반드시 이 표를 거친다.
--          create 는 view 를 포함하지 않는다.
--
-- 이 표가 없으면 MAX_BY_CAP 을 구현할 수 없고, 그러면 단순 정수 MAX 로
-- 퇴화한다. 그 순간 'create' 만 가진 사용자가 'view' 를 얻거나 그 반대가 된다.
--
-- acl_entry / block_acl_meta 는 block(id) 을 참조하므로 블록 트리(§3.4) 마이그레이션에서
-- 만든다. level_capability 는 참조 데이터라 FK 가 없어 지금 넣을 수 있다.

CREATE TABLE level_capability (
  target_kind        text NOT NULL
                     CHECK (target_kind IN ('page', 'database', 'teamspace', 'form_submitter')),
  level              text NOT NULL
                     CHECK (level IN ('view', 'comment', 'edit_content', 'create', 'edit', 'full_access')),
  cap_view           boolean NOT NULL,
  cap_comment        boolean NOT NULL,
  cap_edit_content   boolean NOT NULL,
  cap_create_child   boolean NOT NULL,
  cap_edit_structure boolean NOT NULL,
  cap_share          boolean NOT NULL,
  cap_manage_perm    boolean NOT NULL,
  PRIMARY KEY (target_kind, level)
);

COMMENT ON TABLE level_capability IS
  '규칙 A2: level 은 전순서가 아니다. 비교는 반드시 이 표를 거친다.
   MAX_BY_CAP = capability 비트마스크 OR 후 가장 가까운 표시용 레벨로 환원. 단순 정수 MAX 금지.
   target_kind=teamspace / form_submitter 행은 정본 문서에 아직 정의되지 않았다.
   정의 없이 추측해 넣지 않는다 — 필요해지는 시점에 정본 문서를 먼저 고친다.';

-- 정본 문서 §3.3 의 표를 그대로 옮긴다.
--
--   target_kind   level         view comment edit_content create_child edit_structure share manage_perm
--   page/database full_access    O     O          O            O             O          O       O
--   page/database edit           O     O          O            O             O          X       X
--   database      edit_content   O     O          O            O             X          X       X
--   database      create         X     X          X            O             X          X       X   <- view 가 X
--   page/database comment        O     O          X            X             X          X       X
--   page/database view           O     X          X            X             X          X       X

INSERT INTO level_capability
  (target_kind, level, cap_view, cap_comment, cap_edit_content,
   cap_create_child, cap_edit_structure, cap_share, cap_manage_perm)
VALUES
  ('page',     'full_access',  true,  true,  true,  true,  true,  true,  true ),
  ('page',     'edit',         true,  true,  true,  true,  true,  false, false),
  ('page',     'comment',      true,  true,  false, false, false, false, false),
  ('page',     'view',         true,  false, false, false, false, false, false),

  ('database', 'full_access',  true,  true,  true,  true,  true,  true,  true ),
  ('database', 'edit',         true,  true,  true,  true,  true,  false, false),
  ('database', 'edit_content', true,  true,  true,  true,  false, false, false),
  -- create 는 view 를 포함하지 않는다. 폼 제출처럼 "내용을 못 보면서 추가만" 하는 경우.
  ('database', 'create',       false, false, false, true,  false, false, false),
  ('database', 'comment',      true,  true,  false, false, false, false, false),
  ('database', 'view',         true,  false, false, false, false, false, false);
