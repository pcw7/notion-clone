-- 코멘트 스레드 · 코멘트 · 반응 — 코멘트 1조각 (F-05-08 · F-05-07 · F-11-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 (`discussion` · `comment` · `reaction`) · 판결 U-6 주변
--       05-collaboration-sync.md F-05-07 · F-05-08 (엣지 케이스 표 · 권한 정책)
--       마스터 문서 §5.2 의 3번 — "코멘트 · 멘션 · 알림 · 인박스. 넷이 한 묶음이다"
--
-- 알림(activity_event · subscription · notification)은 이 마이그레이션에 없다. 코멘트가 먼저 있어야 알릴 것이 생긴다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 코멘트는 CRDT 에 넣지 않는다 — 정본이 이미 판결했다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 §3.9 머리 주석: *"코멘트는 CRDT 에 넣지 않는다(관계형)"*. 05 F-05-08 의 근거: *"append-only 이고 권한/쿼리가
-- 필요하므로 관계형 테이블이 맞다"*. 본문과 달리 코멘트는 **누가 언제 썼는가**가 내용의 일부이고, "해결됨"으로 거르고
-- 페이지를 넘겨 가며 읽는다 — Y.Doc 안에 넣으면 그 조회가 전부 문서 전체 읽기가 된다.
--
-- 그래서 이 표들은 본문 쓰기 경로(`src/lib/block/body-write.ts`)를 거치지 않는다. **대신 자리만 Y.Doc 을 본다**(아래).
--
-- ──────────────────────────────────────────────────────────────────────
-- [정본 보강] `discussion.page_id` 를 추가한다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 §3.9 의 `discussion` 에는 `workspace_id` 와 `parent_block_id` 만 있다. 그런데 이 프로젝트에서 **권한의 축은
-- 페이지**다(§3.3 A9 · `effectiveCaps(tx, ctx, pageId)`). 코멘트를 볼 수 있는가는 그 페이지를 볼 수 있는가이고,
-- 알림 라우팅도 페이지 축이다(§3.8 `activity_event.page_id` — *"알림 라우팅의 기준 축"*).
--
-- `parent_block_id` 로 페이지를 찾을 수 없다. 본문 블록의 행은 **Y.Doc 의 투영**이라(판결 X-1)
--
--   ① 방금 친 블록의 행은 아직 없을 수 있고(참여자 경로의 투영은 창만큼 늦다 — CRDT 5d),
--   ② 다른 참여자가 그 블록을 지우면 행이 사라진다(프로젝터가 hard delete 한다).
--
-- 둘 중 하나만 일어나도 "이 코멘트는 어느 페이지 것인가"를 물을 수 없게 된다 — 권한을 물을 수 없다는 뜻이다.
-- 그래서 코멘트를 만들 때 정한 페이지를 행에 적는다. 이 컬럼은 페이지 블록을 가리키므로 FK 가 성립한다.
--
-- ──────────────────────────────────────────────────────────────────────
-- `parent_block_id` 에는 FK 를 걸지 않는다 — 같은 이유의 뒷면이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 페이지 코멘트면 페이지 블록(= `page_id`), 인라인이면 본문 블록이다(정본 §3.9 주석). 본문 블록 행은 투영이라
-- 언제든 사라지고 아직 없을 수도 있다. FK 를 걸면
--
--   · `ON DELETE CASCADE` — 남이 그 문단을 지우면 내 스레드가 **조용히 사라진다**. 05 F-05-07 의 엣지 케이스는
--     반대로 정했다: *"앵커 텍스트가 전부 삭제됨 → 스레드는 생존. '원본 없음(orphaned)' 표시 후 페이지 코멘트로 강등"*
--   · `ON DELETE RESTRICT` — 코멘트가 달린 문단을 아무도 못 지운다. 투영이 거부당해 본문 저장 전체가 막힌다
--   · 삽입 검사만 보더라도 — 아직 투영되지 않은 블록에 코멘트를 달 수 없다. 방금 친 문단이 그렇다
--
-- 세 가지 다 틀렸다. **대상 블록이 있는지는 행이 아니라 Y.Doc 에 묻는다**(`src/lib/comment/discussion.ts`) —
-- 본문의 정본이 Y.Doc 이기 때문이다(X-1). 고아 판정도 읽을 때 Y.Doc 으로 한다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 지운 코멘트는 내용을 남기지 않는다 (불변식 D3)
-- ──────────────────────────────────────────────────────────────────────
--
-- 05 F-05-08: *"스레드 첫 코멘트 삭제 → 스레드 유지 + '삭제된 코멘트' 표기"*. 그래서 행은 남긴다(스레드의 순서와
-- 맥락이 그 자리에 있다). 하지만 **본문(rich_text)은 비운다.** 읽기에서 거르는 것만으로는 부족하다 — 익스포트 ·
-- 검색 색인 · 알림 본문이 나중에 이 표를 읽게 되고, 그중 하나만 거르기를 잊으면 지운 글이 다시 나온다.
-- CHECK 으로 승격해 "지웠는데 내용이 남은" 행을 DB 가 거부한다.

-- ──────────────────────────────────────────────────────────────────────
-- 표
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE discussion (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspace(id),
  -- [정본 보강] 권한 · 알림 라우팅의 축. 페이지 블록을 가리킨다(머리말)
  page_id         uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  -- 페이지 코멘트면 = page_id, 인라인이면 본문 블록. **FK 를 걸지 않는다**(머리말)
  parent_block_id uuid NOT NULL,
  -- 범위 앵커(RelativePosition 쌍 + quoted_text). 2조각까지는 늘 NULL 이다 — 지금 앵커는 블록 하나다
  anchor          jsonb NULL,
  resolved        boolean NOT NULL DEFAULT false,
  resolved_by     uuid NULL REFERENCES "user"(id),
  resolved_at     timestamptz NULL,
  created_by      uuid NOT NULL REFERENCES "user"(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- 불변식 D1: '해결됨'은 세 컬럼이 함께 움직인다. 누가 언제 해결했는지 없는 해결은 재오픈 UI 가 보여줄 것이 없다
  CONSTRAINT ck_discussion_resolved CHECK (
       (resolved = false AND resolved_by IS NULL     AND resolved_at IS NULL)
    OR (resolved = true  AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);

-- 페이지의 스레드 목록 — 코멘트 사이드바 · 인박스가 쓴다. 'Open'/'Resolved' 필터가 1급 축이다(05 F-05-08)
CREATE INDEX ix_discussion_page ON discussion (page_id, resolved, created_at);
-- 정본 §3.9 의 인덱스. 블록 하나에 달린 스레드(본문의 말풍선 · 하이라이트)를 찾는다
CREATE INDEX ix_discussion_block ON discussion (parent_block_id, resolved, created_at);

-- comments uuid[] 컬럼은 두지 않는다. 순서는 comment.created_at 이 준다(정본 §3.9 · C-10 의 배열 폐기 원칙)
CREATE TABLE comment (
  id             uuid PRIMARY KEY,
  discussion_id  uuid NOT NULL REFERENCES discussion(id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES "user"(id),
  rich_text      jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_edited_at timestamptz NULL,
  deleted_at     timestamptz NULL,

  -- 불변식 D2: 살아 있는 코멘트는 비어 있지 않다. 05 F-05-08 엣지: *"빈 코멘트 제출 → 거부"*.
  --            공백만인 런은 SQL 로 거를 수 없다 — 그것은 명령이 본다(`isBlankRichText`)
  CONSTRAINT ck_comment_shape CHECK (
    jsonb_typeof(rich_text) = 'array' AND (deleted_at IS NOT NULL OR jsonb_array_length(rich_text) > 0)),
  -- 불변식 D3: 지운 코멘트는 내용을 남기지 않는다(머리말)
  CONSTRAINT ck_comment_deleted_empty CHECK (deleted_at IS NULL OR rich_text = '[]'::jsonb)
);

CREATE INDEX ix_comment_discussion ON comment (discussion_id, created_at);

-- 정본 §3.9 그대로. PK 가 곧 2P-Set 이라 같은 이모지를 다시 누르면 토글(삭제)이 된다
CREATE TABLE reaction (
  target_kind text NOT NULL CHECK (target_kind IN ('comment', 'discussion')),
  target_id   uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES "user"(id),
  emoji       text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_kind, target_id, user_id, emoji)
);

COMMENT ON TABLE discussion IS
  'D1: resolved · resolved_by · resolved_at 은 함께 움직인다.
   page_id 는 정본 §3.9 에 없는 보강이다 — 권한과 알림의 축이 페이지이고, parent_block_id 로는 페이지를 찾을 수 없다
   (본문 블록 행은 Y.Doc 의 투영이라 사라지거나 아직 없다, X-1). parent_block_id 에 FK 가 없는 것도 같은 이유다 —
   대상 블록이 있는지는 Y.Doc 에 묻는다(src/lib/comment/discussion.ts).';

COMMENT ON TABLE comment IS
  'D2: 살아 있는 코멘트는 비어 있지 않다. D3: 지운 코멘트는 rich_text 를 비운다 — 행만 남겨 "삭제된 코멘트" 자리를 지킨다.
   수정/삭제는 작성자만 한다(권한은 src/lib/comment/discussion.ts).';
