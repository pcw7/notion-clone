-- 버전이 담은 로그 위치 — 잔여 묶음 8d-1조각 (F-11-01)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 `page_version` · [보강] 버전 기록 ①
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — `editor_ids` 의 "구간"에 끝이 없었다
-- ──────────────────────────────────────────────────────────────────────
--
-- 0007 의 `page_version` 은 `editor_ids` 를 *"구간 내 doc_update.actor_id DISTINCT"* 라고 적었지만 구간의 끝을 적는 칸이 없다.
-- 시각(`created_at`)으로 자르면 같은 시각의 update 를 가르지 못하고 로그의 차례(seq)와 어긋날 수 있다. `through_seq` 는 이 버전이
-- 담은 **마지막 `doc_update.seq`** 다 — 앞 버전의 `through_seq` 다음부터 여기까지가 그 버전의 구간이고, 로그의 마지막 seq 가 이보다
-- 크면 아직 버전이 담지 않은 편집이 있다(버전을 남길 때가 되었는지 묻는 축 — 정본 ②).
--
-- **한 위치에 버전은 하나**다 — 같은 상태를 두 번 남기지 않는다(11 F-11-01 *"클라이언트별 중복 생성 금지"*). 판정은 그 페이지의 본문
-- 잠금 안에서 하므로 두 쓰기가 같이 남기지 않지만, 표가 직접 막는다.
--
-- 기존 행: 0007 부터 이 표를 쓴 코드가 없다 — 비어 있다. 비어 있지 않으면 NOT NULL 을 더하는 이 문장이 실패해 알려 준다.

ALTER TABLE page_version
  ADD COLUMN through_seq bigint NOT NULL CHECK (through_seq >= 1);

CREATE UNIQUE INDEX ux_page_version_seq ON page_version (page_id, through_seq);

COMMENT ON COLUMN page_version.through_seq IS
  '이 버전이 담은 마지막 doc_update.seq — editor_ids 의 구간 끝 · 아직 버전이 담지 않은 편집이 있는가(로그의 마지막 seq > 이것). 0040 · 정본 §3.7 [보강] 버전 기록';
COMMENT ON COLUMN page_version.created_at IS
  '담은 내용의 시각 — 마지막 update 의 created_at(버전을 만든 시각이 아니다). 0040 · 정본 §3.7 [보강] 버전 기록 ③';
