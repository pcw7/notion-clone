-- 행 투영이 어디까지 따라왔는가 — `doc_snapshot.projected_seq` 를 채운다 (CRDT 5d조각 · F-05-01)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 `doc_snapshot.projected_seq` · 불변식 S3 · 판결 X-1(block 프로젝터)
--       §6.2-21 투영 지연 · §6.2-22 쓰기 증폭
--
-- 0007 이 컬럼을 만들었지만 5d 전에는 쓰는 곳이 없어 모두 0 이다. 5d 부터 협업 서버의 참여자 update 는 쌓기만 하고 행 투영을
-- 창(기본 1s)으로 미룬다(`src/lib/block/body-write.ts` 머리말). 투영하는 단위가 스냅샷을 잠근 채 반영한 seq 를 적는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 채우는 값 — 로그의 마지막 seq
-- ──────────────────────────────────────────────────────────────────────
--
-- 5d 전의 모든 쓰기는 **같은 트랜잭션에서 행까지 투영했다**(4b · 5a — 명령 · 본문 저장 · 참여자 update). 처음 옮긴 본문(seq 1)은
-- 행에서 만들었다. 그래서 지금 있는 스냅샷은 모두 로그의 마지막 seq 까지 투영된 것이 맞다. 채우지 않으면 투영이 따라잡았는지를
-- 이 컬럼으로 물을 수 없다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 0007 의 부분 인덱스를 지운다 — 밀린 페이지를 찾지 못한다
-- ──────────────────────────────────────────────────────────────────────
--
-- `ix_doc_snapshot_lag ... WHERE projected_seq < merged_seq` 는 "프로젝터가 밀린 페이지를 찾는 인덱스"로 만들었다. 그런데
-- `merged_seq` 는 **압축 지점**이다(정본 §3.7 "compaction 잡이 갱신" · `src/lib/collab/doc-store.ts` — 합치지 않은 update 가
-- `COMPACT_EVERY` 개 쌓일 때만 옮겨진다). 밀린 투영은 대개 압축 지점 **뒤**의 update 다 — 압축하지 않은 페이지(merged_seq 1)에
-- update 50개가 밀려도 이 조건은 거짓이다. 투영은 압축보다 자주 돌아 projected_seq 가 merged_seq 를 앞서는 것이 보통이다.
-- 밀린 정도는 "로그의 마지막 seq − projected_seq" 이고, 그것을 찾는 쿼리는 로그의 PK(page_id, seq)를 거꾸로 한 번 읽는다
-- (`projectionLag`). 틀린 이름의 인덱스를 남기면 나중에 밀린 페이지를 훑는 잡이 이것을 믿는다.

UPDATE doc_snapshot s
   SET projected_seq = coalesce((SELECT max(u.seq) FROM doc_update u WHERE u.page_id = s.page_id), s.merged_seq)
 WHERE s.projected_seq = 0;

DROP INDEX ix_doc_snapshot_lag;

COMMENT ON TABLE doc_snapshot IS
  'S3: projected_seq 가 이 페이지 로그의 마지막 seq 보다 작으면 block 테이블이 낡았다(merged_seq 는 압축 지점이라 기준이 아니다).
       검색/API/사이드바는 이 지연을 감수하고, 에디터는 Y.Doc 을 직접 본다. [X-1]
       투영하는 단위가 스냅샷을 잠근 채 적고 뒤로 가지 않는다. 지연 관측 SLO: p95 < 2s.';
