-- 동기화 · 버전 스키마 (코드는 Phase 1)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7
--       판결 C-11/V-3 · C-12 · X-1 · X-3 · X-6
--
-- 로드맵 W3: "`doc_update` 테이블과 채널 규약도 여기서 만든다(**코드는 Phase 1**)."
-- Phase 0 의 저장은 페이지 단위 LWW 다. CRDT 런타임은 Phase 1 에 온다.
--
-- **왜 지금 만드는가**: 마스터 문서 §5.1 이 그 이유를 적었다 —
-- "1인용으로 6주를 번다. 단 **저장 포맷을 나중에 바꾸면 재작성**."
-- 테이블과 파티션 전략을 나중에 얹으면 이미 쌓인 본문을 옮겨야 한다.

-- 동기화 단위 = 권한 단위 = 채널 단위 = CRDT 문서 단위 = **페이지**. 넷을 일치시킨다.
CREATE TABLE doc_update (                      -- append-only. 페이지 본문의 정본
  page_id    uuid NOT NULL,                    -- = Y.Doc 1개 (block.id where type='page')
  seq        bigint NOT NULL,                  -- page_id 내 단조 증가. CRDT 로그 위치
  payload    bytea NOT NULL,                   -- Yjs update 바이너리. 문자열로 저장하면 손상된다
  actor_id   uuid NULL REFERENCES "user"(id),  -- NULL = 시스템/봇
  origin     text NOT NULL
             CHECK (origin IN ('editor', 'api', 'automation', 'restore', 'import', 'external_sync')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (page_id, seq)
) PARTITION BY HASH (page_id);

-- 파티션은 미리 만들어 둔다. 나중에 늘리려면 기존 데이터를 옮겨야 한다.
-- 16개는 단일 인스턴스에서 충분하고, purge 시 page_id 파티션 단위 정리가 가능해진다.
CREATE TABLE doc_update_p00 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE doc_update_p01 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE doc_update_p02 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE doc_update_p03 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE doc_update_p04 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE doc_update_p05 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE doc_update_p06 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE doc_update_p07 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE doc_update_p08 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE doc_update_p09 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE doc_update_p10 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE doc_update_p11 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE doc_update_p12 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE doc_update_p13 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE doc_update_p14 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE doc_update_p15 PARTITION OF doc_update FOR VALUES WITH (MODULUS 16, REMAINDER 15);

COMMENT ON TABLE doc_update IS
  'S1: 이 로그에는 삭제 op 가 없다. 페이지 삭제는 block.lifecycle 전이 + 부모 Y.Doc 의
       참조 노드 제거로 표현되고, 로그 자체는 purge 시점에 page_id 파티션 단위로
       물리 삭제된다. [X-3]
   S2: doc_update.seq 는 CRDT 재동기(state_vector delta)용 gap 감지 축이다.
       페이지 변경 카운터가 아니다. 그것은 block.version 이다. [X-6]';

CREATE TABLE doc_snapshot (                    -- 현재 상태. compaction 잡이 갱신
  page_id       uuid PRIMARY KEY,
  state         bytea NOT NULL,                -- 머지된 CRDT state
  state_vector  bytea NOT NULL,                -- 클라이언트 delta 계산용
  merged_seq    bigint NOT NULL,               -- 여기까지의 doc_update 가 반영됨
  projected_seq bigint NOT NULL DEFAULT 0,     -- [X-1] block 프로젝터가 반영한 마지막 seq
  updated_at    timestamptz NOT NULL
);

COMMENT ON TABLE doc_snapshot IS
  'S3: projected_seq < merged_seq 인 구간은 block 테이블이 낡았다는 뜻이다.
       검색/API/사이드바는 이 지연을 감수하고, 에디터는 Y.Doc 을 직접 본다. [X-1]
       지연 관측 SLO: p95 < 2s.';

-- 프로젝터가 밀린 페이지를 찾는 인덱스. X-1 의 대가를 관측 가능하게 만든다.
CREATE INDEX ix_doc_snapshot_lag ON doc_snapshot (page_id)
  WHERE projected_seq < merged_seq;

CREATE TABLE page_version (                    -- 사용자 노출 버전 <C-12>
  id            uuid PRIMARY KEY,
  page_id       uuid NOT NULL,
  -- blob 스토리지 키. 행에 bytea 를 박으면 목록 조회가 TOAST 때문에 무너진다.
  state_ref     text NOT NULL,
  state_vector  bytea NOT NULL,
  byte_size     int NOT NULL,
  editor_ids    uuid[] NOT NULL,               -- 구간 내 doc_update.actor_id DISTINCT
  reason        text NOT NULL
                CHECK (reason IN ('interval', 'idle', 'pre_restore', 'manual', 'external_sync')),
  restored_from uuid NULL REFERENCES page_version(id),
  created_at    timestamptz NOT NULL,
  -- 생성 시점 플랜으로 고정한다. 조회 시 재계산하면 플랜을 낮췄을 때
  -- 이미 만들어진 버전이 소급 소멸한다.
  expires_at    timestamptz NOT NULL
);

-- 목록 조회는 state_ref 를 SELECT 하지 않는다(본문을 끌어오지 않기 위해).
CREATE INDEX ix_page_version_list ON page_version (page_id, created_at DESC);
CREATE INDEX ix_page_version_gc   ON page_version (expires_at);

COMMENT ON TABLE page_version IS
  'S4: 복원은 비파괴적이다. (1) reason=''pre_restore'' 버전 생성
       (2) 대상 state 를 origin=''restore'' 인 doc_update 로 append
       (3) 새 버전에 restored_from 기록
   S5: file.ref_count 는 page_version 참조를 포함한다.
       아니면 옛 버전 복원 시 첨부가 깨진다.
   S6: reason=''external_sync'' 버전은 GC 를 더 공격적으로 적용한다(히스토리 노이즈 방지).';
