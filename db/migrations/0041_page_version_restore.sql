-- 복원으로 만든 버전 — 잔여 묶음 8d-3조각 (F-11-02)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 `page_version` · 불변식 S4 · [보강] 복원 ①②
--       11-history-notifications.md F-11-02 *"page_version.reason 에 'pre_restore', 'restore' 값 필요"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 초판의 이유값 다섯에 "복원으로 만든 버전"이 없었다
-- ──────────────────────────────────────────────────────────────────────
--
-- S4 는 복원을 세 걸음으로 적었다 — (1) `pre_restore` 버전 (2) 대상 상태를 `origin='restore'` update 로 쌓기 (3) 새 버전에 `restored_from`.
-- (3) 의 버전이 무슨 이유로 생긴 것인지 적을 값이 0007 의 CHECK 에 없다(`interval` · `idle` · `pre_restore` · `manual` · `external_sync`).
-- `manual` 로 적으면 사용자가 남긴 버전(아직 없다)과 섞인다. 그래서 `restore` 를 더한다.
--
-- `restored_from` 은 **`restore` 버전에만** 있다 — 다른 이유의 버전에 출처가 적히거나, 복원 버전에 출처가 빠지면 목록의 "○○에서 되돌림"이
-- 거짓말을 한다. 표가 막는다.
--
-- 기존 행: 8d-1 부터 버전을 남겼지만 `restored_from` 을 쓴 코드가 없다(모두 NULL · 이유는 idle · interval) — 두 CHECK 을 그대로 지난다.

ALTER TABLE page_version DROP CONSTRAINT page_version_reason_check;
ALTER TABLE page_version
  ADD CONSTRAINT page_version_reason_check
  CHECK (reason IN ('interval', 'idle', 'pre_restore', 'restore', 'manual', 'external_sync'));

ALTER TABLE page_version
  ADD CONSTRAINT page_version_restored_from_only_restore
  CHECK ((reason = 'restore') = (restored_from IS NOT NULL));
