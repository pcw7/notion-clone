-- 협업 신호가 페이지의 부모 이동도 본다 — Teamspace · 게스트 · 그룹 7c-3조각 (F-06-20 · F-05-19)
--
-- 정본: docs/research/00-canonical-data-model.md §3.11 재계산 트리거 ④ *"서브트리 이동"* · 캐시 키 `perm_ver` 의
--       *"서브트리 이동"* · §3.4 `block.parent_type`
--       06-permissions-sharing.md F-06-20 *"이동 즉시 새 부모의 권한이 상속되고, 이전 부모 기반 접근은 소멸한다"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 최상위 페이지는 부모만 바뀌고 경로 · 스코프가 그대로일 수 있다
-- ──────────────────────────────────────────────────────────────────────
--
-- 0016 의 `tg_collab_access_block` 은 page 의 `lifecycle` · `perm_scope_id` · `ancestor_path` 가 바뀐 갱신만 알렸다. 7c-3 부터
-- 페이지를 워크스페이스 최상위 ↔ teamspace 최상위, teamspace A ↔ B 로 옮긴다. 최상위 페이지의 `ancestor_path` 는 늘 `{}` 이고
-- (teamspace 는 그 배열에 없다 — 판결문 C-9), 자기 행을 가진 페이지(스코프 경계)는 `perm_scope_id` 도 그대로다 — **바뀌는 것은
-- `parent_type` · `parent_id` 뿐이다.** 그런데 판정(`effective.ts`)은 루트 블록의 부모를 보고 teamspace 노드의 부여를 사슬 끝에
-- 붙이므로 권한은 바뀐다 — 옛 teamspace 의 멤버가 잃는다. 알리지 않으면 그 사람이 열어 둔 편집기가 계속 본문을 받는다
-- (틀려도 조용한 종류 · HANDOFF §2 "그룹 7a 가 정한 것").
--
-- 함수(`collab_notify_workspace_access` — 워크스페이스 단위 신호)는 그대로 쓰고, 트리거의 열 목록과 WHEN 에 두 열을 더한다.
-- 본문 블록은 여전히 거른다(`NEW.type = 'page'`) — 프로젝터가 갱신마다 쓴다. 페이지가 본문 안에서 토글 밑으로 옮겨 가면
-- `ancestor_path` 도 바뀌므로 신호가 늘지 않는다.

DROP TRIGGER tg_collab_access_block ON block;

CREATE TRIGGER tg_collab_access_block
  AFTER UPDATE OF lifecycle, perm_scope_id, ancestor_path, parent_type, parent_id ON block
  FOR EACH ROW
  WHEN (NEW.type = 'page' AND (OLD.lifecycle IS DISTINCT FROM NEW.lifecycle
                               OR OLD.perm_scope_id IS DISTINCT FROM NEW.perm_scope_id
                               OR OLD.ancestor_path IS DISTINCT FROM NEW.ancestor_path
                               OR OLD.parent_type IS DISTINCT FROM NEW.parent_type
                               OR OLD.parent_id IS DISTINCT FROM NEW.parent_id))
  EXECUTE FUNCTION collab_notify_workspace_access();
