-- 제안 메타 표 `suggestion` — SG-2조각 (F-05-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 제안 편집 (U-2) 의 DDL · 불변식 S8 · [보강 SG-1] ③ ④
--       0018 `discussion`(page_id → block · resolved 세 칸이 함께 움직인다 — D1) 의 이웃 모양
--
-- 제안의 진실은 본문(Y.Doc) 안의 마크 셋이다(`suggestion_insert` · `suggestion_delete` · `suggestion_format`, 각각 `{sid, author_id}`).
-- 이 표는 사이드 목록 · 알림 · 권한 판정을 위한 **메타데이터 인덱스**다. 쓰는 것은 협업 서버의 투영 하나다(`src/lib/suggestion/project.ts`):
--
--   ① 문서의 sid 를 모아 없는 것을 `open` 으로 넣는다 — preview 는 그 sid 글의 앞 80자 · created_at 은 처음 본 때
--   ② `open` 인데 문서에서 sid 마크가 사라진 것은 `stale`(S8 — 앵커 소실이 아니라 마크가 사라졌는가) · 다시 나타나면(되돌리기) `open`
--   ③ `accepted` · `rejected` 는 건드리지 않는다(SG-3 의 수락 · 거절이 쓴다)
--
-- id 는 마크의 sid 다(참여자가 만든 uuid). 마크는 참여자가 쓴 값이라 투영이 모양(uuid)과 사람(이 워크스페이스의 멤버)을 보고 넣는다.
--
-- 기존 행: 없다(새 표). 이미 마크가 든 본문은 다음 투영 때 들어온다.

CREATE TABLE suggestion (
  id          uuid PRIMARY KEY,                                      -- = 마크의 sid
  page_id     uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,  -- 페이지 블록. 권한 · 알림의 축(0018 `discussion.page_id` 와 같다)
  author_id   uuid NOT NULL REFERENCES "user"(id),
  kind        text NOT NULL CHECK (kind IN ('insert', 'delete', 'format')),
  preview     text NULL,                                             -- 그 sid 글의 앞 80자
  anchor_hint jsonb NULL,                                            -- RelativePosition. 카드 → 본문 점프의 보조 좌표일 뿐
  state       text NOT NULL CHECK (state IN ('open', 'accepted', 'rejected', 'stale')),
  thread_id   uuid NULL REFERENCES discussion(id) ON DELETE SET NULL,
  resolved_by uuid NULL REFERENCES "user"(id),
  resolved_at timestamptz NULL,
  created_at  timestamptz NOT NULL,

  -- 미리보기는 앞 80자다 — 긴 제안의 글 전부를 메타 표에 옮기지 않는다
  CONSTRAINT ck_suggestion_preview CHECK (preview IS NULL OR char_length(preview) <= 80),
  -- 수락 · 거절만 누가 언제를 갖는다(0018 D1 과 같은 모양). open · stale 은 아직 아무도 정하지 않았다
  CONSTRAINT ck_suggestion_resolved CHECK (
       (state IN ('accepted', 'rejected') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR (state IN ('open', 'stale')        AND resolved_by IS NULL     AND resolved_at IS NULL))
);

-- 정본 U-2 의 세 인덱스
CREATE INDEX ix_suggestion_open_page ON suggestion (page_id) WHERE state = 'open';
CREATE INDEX ix_suggestion_author ON suggestion (author_id, created_at DESC);
CREATE INDEX ix_suggestion_thread ON suggestion (thread_id);
-- [정본 보강] page_id 전체 인덱스 — 투영은 본문 블록 행을 물리 삭제하고(X-3) 지울 때마다 이 FK 의 CASCADE 가 page_id 로 찾는다.
-- 위의 부분 인덱스(open 만)로는 그 찾기를 받지 못해 블록 하나를 지울 때마다 표를 훑게 된다.
CREATE INDEX ix_suggestion_page ON suggestion (page_id);

COMMENT ON TABLE suggestion IS
  '제안 메타 (U-2 · SG-2). 진실은 Y.Doc 의 마크 — 투영이 쓴다. S8: stale = sid 마크가 문서에서 사라졌다. resolved_* 는 accepted · rejected 만.';
