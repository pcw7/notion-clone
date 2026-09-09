-- order_key 는 이진 순서로 비교해야 한다
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 불변식 B7
--       "결정적 정렬은 ORDER BY order_key, id"
--
-- ── 무엇이 틀렸나 ────────────────────────────────────────────────────
--
-- 이 데이터베이스는 ICU + ko-KR 로 초기화된다(CLAUDE.md: 한국어 검색 때문에
-- 소급 변경 불가 축). 그런데 `order_key` 는 **사람이 읽는 문자열이 아니라
-- fractional index** 이고, fractional-indexing 라이브러리는 키를
-- `0-9 A-Z a-z` 의 **이진(코드포인트) 순서**로 비교한다고 가정한다.
--
-- 두 순서가 실제로 다르다. 이 DB 에서 측정한 결과:
--
--   이진(C)      : Zz  a0  a1  a9  aA  aZ  aa  az  z0
--   ICU(ko-KR)   : a0  a1  a9  aa  aA  az  aZ  z0  Zz
--                              ^^^^^^^^          ^^  대소문자와 문자열 길이가 뒤집힌다
--
-- 결과적으로 조용히 두 가지가 깨진다.
--
--   ① `SELECT max(order_key) ... ` 가 진짜 마지막 형제를 돌려주지 않는다.
--      그 값 뒤에 새 키를 만들면 **이미 존재하는 키**가 나온다
--      → `ux_block_sibling_order` UNIQUE 위반.
--   ② `ORDER BY order_key` 가 에디터가 계산한 순서와 다른 순서를 준다
--      → "문단 순서가 이상하다". 재현이 어렵고 데이터는 멀쩡해 보인다.
--
-- **이 DB 에서 실측한 임계값: 형제 37개.** 순차 생성 키는
-- a0..a9(10) → aA..aZ(26) → aa.. 로 가는데, 37번째에서 `aa` 가 생기는 순간
-- ICU 는 `aZ` 를 최대로 본다. `max()` 가 `aZ` 를 주면 그 뒤 키는 다시 `aa` 라서
-- 방금 만든 형제와 충돌한다. 그 전(36개까지)에는 증상이 전혀 없다 —
-- 그래서 개발 중에는 멀쩡해 보이다가 문서가 커지면 터진다.
--
-- ── 왜 컬럼 단위 COLLATE 인가 ────────────────────────────────────────
--
-- 데이터베이스 collation 은 바꿀 수 없다(한국어 정렬·검색이 거기 달렸다).
-- 바꿔야 하는 것은 **이 컬럼 하나**다. `order_key` 에는 사람이 읽는 텍스트가
-- 들어가지 않으므로 언어별 정렬이 의미를 갖지 않는다 — 오히려 방해다.
--
-- ALTER COLUMN ... TYPE 은 의존 **인덱스**는 함께 다시 만들지만
-- 의존 **뷰**가 있으면 거부한다("cannot alter type of a column used by a view").
-- `live_block` 이 `SELECT *` 라서 걸린다. 그래서 뷰를 내렸다가 같은 정의로 다시 만든다.
-- 같은 트랜잭션 안이므로 뷰가 없는 순간이 밖에서 관측되지 않는다.
--
-- ⚠ 이 컬럼에 `ORDER BY`/`max()`/비교를 쓰는 모든 쿼리는 이제 이진 순서를 얻는다.
--   TypeScript 쪽 비교(`compareBlockOrder`)는 UTF-16 코드 유닛 비교라 이미 이진이다.
--   두 쪽이 이걸로 일치한다.

DROP VIEW live_block;

ALTER TABLE block ALTER COLUMN order_key TYPE text COLLATE "C";

-- 0006 과 동일한 정의. 모든 일반 조회는 이 뷰만 본다.
CREATE VIEW live_block AS SELECT * FROM block WHERE lifecycle = 'live';

COMMENT ON COLUMN block.order_key IS
  '[X-1] parent_type=''block'' 이면 Y.Doc 이 정본이고 이 컬럼은 프로젝터가 쓰는 파생이다.
   parent_type ∈ {data_source, teamspace, workspace} 이면 이 컬럼이 정본이다.
   프로젝터가 유일한 쓰기자이므로 UNIQUE(parent_id, order_key) 충돌이 구조적으로 발생하지 않는다.
   COLLATE "C": fractional index 는 이진 순서를 가정한다. DB 기본 collation(ICU ko-KR)은
   대소문자를 다르게 정렬해 max(order_key) 와 ORDER BY 를 조용히 틀리게 만든다 (0008).';
