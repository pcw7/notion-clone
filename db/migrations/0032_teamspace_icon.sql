-- teamspace 아이콘은 이모지 한 글자 — Teamspace · 게스트 · 그룹 7c-14조각 (F-06-04)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `teamspace.icon` · [보강] `teamspace.icon` — 이모지 한 글자 ②
--       06-permissions-sharing.md F-06-04 *"이름/아이콘 입력"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 7c-14 부터 이 칸이 입력이 된다
-- ──────────────────────────────────────────────────────────────────────
--
-- `icon` 은 0028 부터 있었지만 아무도 쓰지 않았다. 이제 owner 가 이모지 한 글자를 고른다(`teamspace.ts`
-- `normalizeTeamspaceIcon`). "grapheme 하나 · 이모지"는 SQL 로 셀 수 없어 명령이 검사하고, DB 는 표현할 수 있는 부분만
-- 막는다: 비어 있지 않고 · 16 코드포인트 이하(가장 긴 표준 이모지 시퀀스를 넉넉히 받는다) · 공백이 없다. 사이드바 한 줄에
-- 서는 값이 긴 글이 되지 않게 하는 마지막 울타리다.
--
-- 기존 행: 쓴 명령이 없었으므로 전부 NULL 이다.

ALTER TABLE teamspace
  ADD CONSTRAINT teamspace_icon_shape
  CHECK (icon IS NULL OR (char_length(icon) BETWEEN 1 AND 16 AND icon !~ '[[:space:]]'));
