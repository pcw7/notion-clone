-- 동기화 블록의 저장 모양 — 58번 트랙 SB-1 (F-01-11)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강 SB-0] 나(④ 행 · SQL 스케치) · 불변식 SY2 · SY3
--       01-block-editor.md F-01-11 *"`synced_from`이 `null`이면 원본, `{type:'block_id', block_id}`이면 참조 사본이다. 자식은 원본에만
--       존재하고 사본은 참조만 갖는다"*
--
-- 새 표는 없다(C-3) — 원본 · 사본 모두 `block` 의 보통 행이다(`type='synced_block'`). 원본은 `properties` 가 빈 객체, 사본은
-- `{synced_from: '<원본 X 의 uuid>'}` 하나 · 자식 행이 없다. 원본의 자식은 X 를 부모로 하는 원본 페이지 A 의 행이다(투영 그대로 — X-1).
--
-- ── ① 표현 가능한 불변식의 승격 ──
--   SY3 `ck_synced_block_in_body`  — 동기화 블록은 본문 안에만(DB 행 · 사이드바 최상위가 아니다)
--   SY2 `ck_synced_from_shape`     — `synced_from` 은 동기화 블록에만 · 문자열 · 소문자 uuid · 자기 id 가 아니다
-- 원본 X 에 FK 를 걸지 않는다 — 원본이 지워져도 사본은 남아 "원본이 삭제되었다" 를 그린다(01 *"참조는 살아있고 placeholder"*).
-- 읽기의 정화(`block/props.ts`)가 같은 모양을 지킨다 — 다른 타입의 `synced_from` 은 지우고 대문자 uuid 는 소문자로 고친다(행이 이 CHECK 에
-- 걸려 투영이 멈추지 않게).
--
-- ── ② 원본 → 사본 역인덱스 ──
-- 표를 따로 두지 않고 부분 식 인덱스로 둔다 — "이 원본을 가리키는 사본"(SB-2 의 해석 · SB-4 의 모두 해제 · 사본이 있는 원본 지우기 확인).
-- 사본의 페이지는 그 행의 `ancestor_path` 에서 가장 깊은 `page` 다.
--
-- ── ③ 잠금 — 잰 값(2026-11-27 · 개발 DB `block` 3,298,566행 · 2.8GB) ──
-- 검증까지 한 번에 거는 CHECK 둘은 1.4초 — 그동안 `ACCESS EXCLUSIVE` 로 읽기 · 쓰기가 모두 멈춘다. 그래서 여기서는 `NOT VALID` 로 건다(표를
-- 훑지 않는다 · 새로 쓰는 행만 검사한다 — 잠금이 짧다). 기존 행의 검증은 **다음 파일**(0156 — 따로 커밋된 트랜잭션 · `SHARE UPDATE
-- EXCLUSIVE` 라 읽기 · 쓰기가 계속된다)이 한다. 같은 트랜잭션에서 VALIDATE 하면 앞의 배타 잠금을 쥔 채 훑어 나눈 뜻이 없다.
-- 부분 인덱스는 0.3초(쓰기만 그동안 멈춘다) — `CONCURRENTLY` 로 하지 않는다: 러너는 파일 하나를 한 질의로 보내 여러 문장이 암묵
-- 트랜잭션이 되고(그 안에서 CONCURRENTLY 는 거부된다), 실패하면 INVALID 인덱스가 남는다. 운영 규모에서 길어지면 그때 한 문장짜리
-- no-transaction 파일로 다시 자른다.
--
-- 기존 행: 해당 없음(`synced_block` 행이 없고, 다른 타입의 `synced_from` 은 쓴 적이 없다 — 0156 의 VALIDATE 가 확인한다).

ALTER TABLE block ADD CONSTRAINT ck_synced_block_in_body                    -- SY3
  CHECK (type <> 'synced_block' OR parent_type = 'block') NOT VALID;

ALTER TABLE block ADD CONSTRAINT ck_synced_from_shape                       -- SY2
  CHECK (NOT (properties ? 'synced_from')
         OR (type = 'synced_block'
             AND jsonb_typeof(properties -> 'synced_from') = 'string'
             AND properties ->> 'synced_from' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AND properties ->> 'synced_from' <> id::text)) NOT VALID;

-- 원본 → 사본(②). 워크스페이스로 묶는다 — 해석이 `ctx.workspaceId` 에 묶인다(SY6).
CREATE INDEX ix_block_synced_copies ON block (workspace_id, (properties ->> 'synced_from'))
  WHERE type = 'synced_block' AND properties ? 'synced_from';

COMMENT ON CONSTRAINT ck_synced_block_in_body ON block IS
  '정본 §3.4 [보강 SB-0] SY3. 동기화 블록은 본문 안에만 — DB 행 · 사이드바 최상위가 아니다.';
COMMENT ON CONSTRAINT ck_synced_from_shape ON block IS
  '정본 §3.4 [보강 SB-0] SY2. synced_from 은 동기화 블록(사본)에만 · 소문자 uuid · 자기 id 가 아니다. 원본은 키가 없다(FK 없음 — 원본이 지워져도 사본은 남는다).';
COMMENT ON INDEX ix_block_synced_copies IS
  '정본 §3.4 [보강 SB-0] ④. 원본 → 사본 역인덱스(표를 따로 두지 않는다). 사본의 페이지는 그 행의 ancestor_path 에서 가장 깊은 page.';
