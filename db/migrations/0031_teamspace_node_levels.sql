-- teamspace 노드의 부여는 page 매트릭스의 네 레벨만 — Teamspace · 게스트 · 그룹 7c-12조각 (F-06-04)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `acl_entry` · [보강] 멤버 기본 레벨을 바꾸는 것 ①
--       §3.3 [보강] teamspace 노드의 `acl_entry` 가 뜻하는 것 ① *"level 은 page 매트릭스로 읽는다"*
--       §6.1 #5 teamspace 기본 권한 값 집합 — *"뒤집히면 바뀌는 것: CHECK 제약 1줄"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 멤버 기본 레벨을 owner 가 고르게 되면서 그 값이 입력이 됐다
-- ──────────────────────────────────────────────────────────────────────
--
-- teamspace 노드의 행(`node_kind='teamspace'` — 멤버 전원 · owner · open 의 열람)은 그 아래 페이지가 물려받는 부여이고
-- 판정은 그 level 을 **page 매트릭스**로 읽는다. `edit_content` · `create` 는 database 전용 레벨이라(§3.3 매트릭스) page 에는
-- 뜻이 없다 — 그런 행이 서면 판정이 매트릭스에 없는 레벨을 만난다.
--
-- 지금까지는 이 행들의 level 이 상수였다(멤버 full_access · owner full_access · open view). 7c-12 부터 owner 가 멤버의 level 을
-- 고른다(`teamspace.ts` `updateTeamspace` 의 `memberLevel`). 명령이 넷 밖의 값을 거부하지만, 이 행들을 쓰는 새 경로가 생겨도
-- 넷 밖으로 나가지 않게 DB 가 막는다.
--
-- 기존 행: 셋 다 넷 안의 값이다(full_access · view).

ALTER TABLE acl_entry
  ADD CONSTRAINT acl_entry_teamspace_node_level
  CHECK (node_kind <> 'teamspace' OR level IN ('full_access', 'edit', 'comment', 'view'));
