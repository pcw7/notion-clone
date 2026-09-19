-- 인라인 코멘트의 범위 앵커 — 모양을 승격한다 (F-05-07 · 코멘트 2조각)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 `discussion.anchor`
--       — "RelativePosition 범위 + quoted_text 폴백"
--       05-collaboration-sync.md F-05-07 엣지 케이스 표
--
-- 컬럼은 0018 이 이미 만들었다(늘 NULL 이었다). 여기서는 **무엇이 들어갈 수 있는가**를 못박는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 들어가는 모양
-- ──────────────────────────────────────────────────────────────────────
--
--   { "kind": "text_range",
--     "start": "<Y.RelativePosition 을 base64 로>",
--     "end":   "<같음>",
--     "quoted_text": "인용된 원문 스냅샷" }
--
-- 시작 · 끝은 **글자 자체**(Yjs 항목 id)를 가리킨다. "12번째 글자부터"로 적으면 다른 사람이 앞에 한 글자만 쳐도
-- 틀린 곳을 가리킨다. 만드는 쪽은 Y.Doc 을 가진 쪽이다(src/lib/comment/anchor.ts 머리말).
--
-- ──────────────────────────────────────────────────────────────────────
-- 불변식 D4 — 페이지 스레드에는 앵커가 없다
-- ──────────────────────────────────────────────────────────────────────
--
-- 페이지 전체에 단 스레드(`parent_block_id = page_id`)는 가리킬 글자가 없다. 그런 행에 앵커가 붙으면 화면은
-- "어디에도 없는 하이라이트"를 그리려 하고, 고아 판정은 영원히 참이 된다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 불변식 D5 — `quoted_text` 없는 앵커는 없다
-- ──────────────────────────────────────────────────────────────────────
--
-- 05 F-05-07: *"`quoted_text` 는 앵커 유실 시 표시용 fallback 으로 **반드시 저장한다**"*. 앵커는 풀리지 않을 수 있고
-- (그 글자를 지웠거나, 아직 서버에 도착하지 않았거나) 그때 보여줄 것이 이것뿐이다. 세 키가 다 있어야 앵커다.
--
-- 값의 **내용**(바이트가 상대 위치로 읽히는가)은 SQL 로 볼 수 없다 — 그것은 명령이 본다(`anchor.ts` `acceptAnchor`).

ALTER TABLE discussion
  ADD CONSTRAINT ck_discussion_anchor_not_page CHECK (anchor IS NULL OR parent_block_id <> page_id),
  ADD CONSTRAINT ck_discussion_anchor_shape CHECK (
    anchor IS NULL
    OR (jsonb_typeof(anchor) = 'object'
        AND anchor->>'kind' = 'text_range'
        AND anchor ? 'start' AND anchor ? 'end' AND anchor ? 'quoted_text'));

COMMENT ON COLUMN discussion.anchor IS
  'D4: 페이지 스레드(parent_block_id = page_id)에는 앵커가 없다.
   D5: 앵커에는 kind=text_range · start · end · quoted_text 가 모두 있다 — quoted_text 는 앵커 유실 시의 유일한 표시 수단이다.
   start · end 는 Y.RelativePosition 을 base64 로 담는다(글자 자체를 가리킨다). 푸는 곳은 src/lib/comment/anchor.ts 하나다.';
