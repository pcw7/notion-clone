-- 기본 teamspace 는 보관하지 않는다 — Teamspace · 게스트 · 그룹 7c-11조각 (F-06-04)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `teamspace` · [보강] `teamspace.is_default` 가 하는 일 ⑥
--       06-permissions-sharing.md F-06-04 *"Default teamspace 삭제 시도 → 마지막 default 는 archive 불가로 막아야 함"* [추정]
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 보관된 teamspace 로의 자동 추가는 헛돌고, 되살리는 순간 한꺼번에 열린다
-- ──────────────────────────────────────────────────────────────────────
--
-- `is_default` 는 사람이 워크스페이스에 들어올 때 그 teamspace 의 멤버 행을 넣는 규칙이다(7c-11 · `teamspace.ts`
-- `joinDefaultTeamspaces`). 보관된 teamspace 는 판정이 읽지 않으므로(7c-6) 그리로 들어간 행은 아무것도 주지 않다가,
-- 되살리는 순간 보관 중에 들어온 사람들에게 한꺼번에 열린다 — 보관은 행을 건드리지 않아야 복원이 정확하다는 7c-6 의
-- 규칙을 거스르는 "보관 중에도 뜻이 있는 상태"다.
--
-- F-06-04 의 [추정] 은 "마지막 default" 만 막았는데 이 제약은 **모든** default 를 막는다. 기본이 하나도 없어도 된다 —
-- 워크스페이스는 teamspace 없이 시작한다. 보관하려면 먼저 기본을 끈다(명령이 `default_teamspace` 로 먼저 말해 준다).
--
-- 기존 행: `is_default` 를 켜는 명령이 이 조각에서 처음 생겼으므로 어기는 행이 없다.

ALTER TABLE teamspace
  ADD CONSTRAINT teamspace_default_not_archived CHECK (NOT is_default OR archived_at IS NULL);
