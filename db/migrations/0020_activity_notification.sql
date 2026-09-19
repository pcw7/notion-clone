-- 활동 이벤트 · 구독 · 알림 — 코멘트 3조각 (F-11-07 인박스 · F-11-08 알림 생성 규칙 · F-11-09 구독)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 (`activity_event` · `subscription` · `notification`,
--       불변식 N1~N4 · 배달 파이프라인 3단 필터) · 판결 C-13 · X-10(subscription 은 결제 구독이 아니다)
--       05-collaboration-sync.md F-05-10 · 11-history-notifications.md F-11-07 · 08 · 09
--
-- ──────────────────────────────────────────────────────────────────────
-- 이 마이그레이션에 **없는** 것
-- ──────────────────────────────────────────────────────────────────────
--
-- `notification_delivery` · `user_notification_pref` · `reminder` 는 만들지 않는다. 셋 다 **채널**(데스크톱 푸시 ·
-- 이메일 · 슬랙)이 생길 때 뜻이 생기는 표이고, 지금은 채널이 없다. 정본 자신이 적었다: *"'inbox' 컬럼은 두지 않는다.
-- 인박스는 채널이 아니라 알림의 **기본 저장소**이며 끌 수 없다."* 05 F-05-10 의 클론 대안도 *"MVP 는 인앱 인박스만"* 이다.
--
-- ──────────────────────────────────────────────────────────────────────
-- [정본 정정] `activity_event` 의 PK 는 `(id, created_at)` 이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본은 `id uuid PRIMARY KEY` + `PARTITION BY RANGE (created_at)` 를 함께 적었다. **PostgreSQL 에서 그 둘은 같이
-- 설 수 없다** — 실측: `unique constraint on partitioned table must include all partitioning columns` (0A000).
-- 파티션 키를 PK 에 넣는다. 부르는 쪽은 언제나 (id, created_at) 쌍을 함께 들고 다니므로(알림이 `event_ids[]` 와
-- `created_at` 을 같이 안다) 조회가 불편해지지 않는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- `block_id` 에는 FK 를 걸지 않는다 — `discussion.parent_block_id` 와 같은 이유
-- ──────────────────────────────────────────────────────────────────────
--
-- 본문 블록의 행은 Y.Doc 의 투영이라(X-1) 아직 없거나 이미 지워져 있다(§3.3-125). `page_id` 는 페이지 블록이라
-- FK 가 성립하고, 페이지가 물리 삭제되면 그 페이지의 이벤트 · 알림 · 구독도 함께 간다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 불변식 N2 — **없어야 하는 제약**이 있다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본: *"`UNIQUE(group_key) WHERE read_at IS NULL` 제약은 존재하지 않는다. 저장은 개별, 병합은 조회 시점.
-- 이유 (a) 스레드 일부만 읽음 표현 (b) 배달 시점 권한 재검사가 이벤트별로 필요 (c) 인기 페이지 팬아웃의 단일 행 락 회피."*
-- `verify-schema.mjs` [12] 가 **같은 group_key 로 두 번 넣어 성공하는지**를 본다 — 거부되면 그 제약이 생긴 것이다.
--
-- 불변식 N3: 알림은 `payload` 를 복제하지 않는다. `activity_event` 를 `event_ids[]` 로 가리킨다.
-- 여기에는 하나 더 붙는다 — **이벤트 payload 에도 코멘트 본문을 복제하지 않는다.** 지운 코멘트는 내용을 비우는데(D3 ·
-- §3.3-126) payload 에 사본이 남으면 인박스가 지운 글을 되살린다. payload 는 id 만 담고, 인박스는 지금 글을 읽는다.

-- ──────────────────────────────────────────────────────────────────────
-- 활동 이벤트 — 알림 · 피드 · 웹훅의 단일 소스
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE activity_event (
  id           uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  page_id      uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,  -- 알림 라우팅의 기준 축
  block_id     uuid NULL,                                             -- 본문 블록. FK 없음(머리말)
  actor_id     uuid NULL REFERENCES "user"(id),                       -- 익명 · 시스템이면 NULL
  type         text NOT NULL CHECK (type IN (
                 'block.updated', 'property.updated', 'comment.created', 'user.mentioned',
                 'page.created', 'page.moved', 'page.trashed',
                 'suggestion.created', 'suggestion.accepted')),
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id, created_at)   -- [정정] 파티션 키를 포함해야 한다(머리말)
) PARTITION BY RANGE (created_at);

-- 연 단위로 미리 만들고, 벗어나는 값은 DEFAULT 가 받는다. 파티션을 미리 만드는 잡이 아직 없어서
-- DEFAULT 가 없으면 해가 바뀌는 순간 **쓰기가 통째로 실패한다**(§7).
CREATE TABLE activity_event_2026 PARTITION OF activity_event
  FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE activity_event_2027 PARTITION OF activity_event
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
CREATE TABLE activity_event_default PARTITION OF activity_event DEFAULT;

CREATE INDEX ix_activity_event_page ON activity_event (page_id, created_at DESC);

COMMENT ON TABLE activity_event IS
  'C-13: 알림 · 피드 · 웹훅의 단일 소스. 알림은 이것을 event_ids[] 로 가리키고 payload 를 복제하지 않는다(N3).
   payload 에 사람이 쓴 글(코멘트 본문 등)을 복제하지 않는다 — 지운 글이 인박스에서 되살아난다(§3.3-126).
   PK 가 (id, created_at) 인 것은 파티션 키를 포함해야 하기 때문이다(정본 정정).';

-- ──────────────────────────────────────────────────────────────────────
-- 구독 — 페이지 팔로우 (결제 구독이 아니다 [X-10])
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE subscription (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES "user"(id),
  page_id    uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  page_kind  text NOT NULL CHECK (page_kind IN ('page', 'db_item')),   -- level CHECK 의 판별자
  level      text NOT NULL,
  source     text NOT NULL CHECK (source IN ('explicit', 'auto_created', 'auto_edited')),
  inherit    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, page_id),
  CONSTRAINT ck_subscription_level CHECK (
       (page_kind = 'page'    AND level IN ('all_comments', 'replies_and_mentions', 'none'))
    OR (page_kind = 'db_item' AND level IN ('all_updates', 'important_updates', 'replies_and_mentions', 'none')))
);

COMMENT ON TABLE subscription IS
  'N1: 명시적 none 은 암묵 구독(auto_created · auto_edited)을 덮어쓴다 — 아니면 "뮤트했는데 편집하면 다시 켜지는" 버그가 된다.
   그래서 자동 구독은 행이 없을 때만 넣는다(src/lib/notification/subscription.ts).
   X-10: 페이지 팔로우다. 결제 구독이 아니다.';

-- ──────────────────────────────────────────────────────────────────────
-- 알림 — 인박스의 행
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE notification (
  id           uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES "user"(id),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  page_id      uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  event_ids    uuid[] NOT NULL,                 -- 묶인 activity_event 들 (N3: payload 를 복제하지 않는다)
  kind         text NOT NULL CHECK (kind IN (
                 'mention', 'comment', 'comment_reply', 'page_update',
                 'invite', 'reminder', 'person_property_assigned', 'suggestion')),
  group_key    text NOT NULL,                   -- 조회 시점 병합 키 (N2)
  read_at      timestamptz NULL,                -- 읽음 · 보관은 **따로** 센다 — 인박스 필터가 넷이다
  archived_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- 가리키는 이벤트가 없는 알림은 보여줄 것이 없다(N3 의 뒷면).
  -- `array_length(x, 1)` 은 빈 배열에 **NULL** 을 준다 — CHECK 은 NULL 을 통과시키므로 그것으로는 막지 못한다.
  -- `cardinality` 는 0 을 준다(검증 프로브가 잡았다).
  CONSTRAINT ck_notification_events CHECK (cardinality(event_ids) >= 1)
);

CREATE INDEX ix_notification_inbox ON notification (recipient_id, archived_at, read_at, created_at DESC);
CREATE INDEX ix_notification_group ON notification (recipient_id, group_key, created_at DESC);

COMMENT ON TABLE notification IS
  'N2: UNIQUE(group_key) WHERE read_at IS NULL 제약은 **존재하지 않는다.** 저장은 개별, 병합은 조회 시점이다 —
       (a) 스레드 일부만 읽음 (b) 이벤트별 권한 재검사 (c) 인기 페이지 팬아웃의 단일 행 락 회피.
   N3: payload 를 복제하지 않는다. event_ids[] 로 activity_event 를 가리킨다.
   N4: 외부 origin 변경은 기본적으로 알림을 만들지 않는다.
   읽음(read_at)과 보관(archived_at)은 따로다 — 읽지 않고 보관할 수 있어야 한다.';
