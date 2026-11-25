-- 개인 뷰 상태의 전달 · 지운 속성의 조건 정리 — DB 실시간 동기화 RT-3조각 (F-05-16 · F-05-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 `view_user_override` [보강 RT-3] · §3.7 [보강] X-5 의 단계 ⑯~⑱
--       05-collaboration-sync.md F-05-16 *"개인 상태 변경은 브로드캐스트하지 않는다(같은 사용자의 다른 세션에만 전달)"* ·
--       *"B의 개인 필터가 A의 스키마 변경으로 무효화 → 필터가 참조하는 property_id 부재 → 그 조건만 drop 하고 배너 표시"*
--
-- ── ① 개인 설정의 신호 — 그 사람에게만 ──
-- `view_user_override` 가 바뀌면(넣기 · 고치기 · 지우기 — 초기화 · 모두에게 저장 · 지운 속성의 정리 · 편집자의 공유 필터 저장) 트리거가
-- `db_rows` 채널에 `p:<표>:<뷰>:<사람>:<보낸 탭>` 을 보낸다. 표의 신호(표 id 하나)와 모양이 달라 옛 듣는 쪽은 버린다. 허브(`row-feed.ts`)는
-- **그 표 · 그 사람**의 구독에게만 넘긴다 — 남에게는 신호도 다시 읽기도 없다. 변경 기록(`data_source_change`)에는 쓰지 않는다(쓰면 그 표를
-- 보는 모두의 델타 · `changed` 가 된다). 보낸 탭은 명령이 `set_config('notion.view_origin', …, true)` 로 준다(없으면 빈 글) — 그 탭은 이미
-- 스스로 다시 그렸다.
--
-- ── ② 놓친 신호 — (뷰, 사람)마다 마지막으로 바꾼 트랜잭션 ──
-- 신호는 쌓이지 않는다(끊긴 동안 · 구독이 붙기 전). `view_personal_change` 가 (뷰, 사람)마다 마지막으로 바꾼 트랜잭션의 xid 를 든다 —
-- 델타가 "커서 뒤로 내 개인 설정이 바뀌었나"를(`personalChanged`), 구독의 `ready` 가 "렌더 뒤로 바뀌었나"를 이것으로 답한다(커서의 축과
-- 같은 xid — §3.7 1단계 ②). 지우기(초기화)도 남는다 — 개인 설정 행은 사라져도 이 행은 남는다.
--
-- ── ③ 지운 속성의 조건을 뺀 기록 ──
-- 속성을 지우거나 타입을 바꾸면 명령의 트랜잭션이 그 속성을 가리키는 조건만 뺀다(공유 층 · 모든 사람의 개인 층). 뺀 것을 여기 남긴다 —
-- 개인 층은 그 사람(`user_id`) · 공유 층은 NULL(그 뷰를 보는 모두). 본 사람은 `view_filter_notice_seen`. 30일 뒤 보관 정리가 지운다.
--
-- 기존 행: 해당 없음(앞의 개인 설정은 신호를 보낸 적이 없다 · 앞에 지운 속성의 조건은 읽을 때 무시되고 칩이 "지워진 속성 (무시됨)").

CREATE TABLE view_personal_change (
  view_id uuid        NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  user_id uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  xid     xid8        NOT NULL DEFAULT pg_current_xact_id(),   -- 마지막으로 바꾼 트랜잭션(최상위) — 델타 커서와 같은 축
  at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_view_personal_change PRIMARY KEY (view_id, user_id)
);

-- 사람을 지울 때 · 구독의 "렌더 뒤로 바뀌었나"(그 사람의 행 → 뷰의 표)
CREATE INDEX ix_view_personal_change_user ON view_personal_change (user_id);

COMMENT ON TABLE view_personal_change IS
  '정본 §3.6 view_user_override [보강 RT-3] ②. (뷰, 사람)마다 개인 설정을 마지막으로 바꾼 트랜잭션의 xid — 놓친 개인 신호를 델타 · ready 가 메운다.';

CREATE FUNCTION view_personal_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_view uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.view_id ELSE NEW.view_id END;
  target_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  source uuid;
BEGIN
  SELECT v.data_source_id INTO source FROM view v WHERE v.id = target_view;
  -- 뷰 · 사람이 지워지는 중(cascade) — 알릴 화면이 없다(표시 행도 FK 로 함께 사라진다)
  IF source IS NULL OR NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = target_user) THEN
    RETURN NULL;
  END IF;
  INSERT INTO view_personal_change (view_id, user_id) VALUES (target_view, target_user)
    ON CONFLICT (view_id, user_id) DO UPDATE SET xid = pg_current_xact_id(), at = now();
  PERFORM pg_notify('db_rows', 'p:' || source::text || ':' || target_view::text || ':' || target_user::text || ':'
                    || coalesce(current_setting('notion.view_origin', true), ''));
  RETURN NULL;
END $$;

CREATE TRIGGER tg_view_user_override_personal
  AFTER INSERT OR UPDATE OR DELETE ON view_user_override
  FOR EACH ROW EXECUTE FUNCTION view_personal_notify();

CREATE TABLE view_filter_notice (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  view_id       uuid        NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  user_id       uuid        NULL REFERENCES "user"(id) ON DELETE CASCADE,       -- 개인 층이면 그 사람 · NULL 이면 공유 층(보는 모두)
  property_id   text        NOT NULL REFERENCES property(id) ON DELETE CASCADE,  -- text [X-12] · 지워도 행은 남는다(soft delete)
  property_name text        NOT NULL,                                            -- 뺄 때의 이름(그 뒤 이름이 바뀌어도 그때의 것)
  reason        text        NOT NULL,
  filters       integer     NOT NULL DEFAULT 0,                                  -- 뺀 필터 규칙 수
  sorts         integer     NOT NULL DEFAULT 0,                                  -- 뺀 정렬 키 수
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_view_filter_notice PRIMARY KEY (id),
  CONSTRAINT ck_view_filter_notice_reason CHECK (reason IN ('property_deleted', 'type_changed')),
  -- 뺀 것이 없으면 알릴 것도 없다
  CONSTRAINT ck_view_filter_notice_counts CHECK (filters >= 0 AND sorts >= 0 AND filters + sorts > 0),
  -- 타입 바꾸기는 정렬을 남긴다(§3.5 [보강] 프로퍼티 타입 바꾸기 ⑤ — 새 타입으로 정렬된다)
  CONSTRAINT ck_view_filter_notice_type_sorts CHECK (reason <> 'type_changed' OR sorts = 0),
  -- 속성 이름의 상한(MAX_PROPERTY_NAME_LENGTH)과 같다
  CONSTRAINT ck_view_filter_notice_name CHECK (char_length(property_name) BETWEEN 1 AND 200)
);

-- 화면의 읽기(그 뷰 · 시각순)
CREATE INDEX ix_view_filter_notice_view ON view_filter_notice (view_id, created_at);
-- 사람을 지울 때(개인 층만)
CREATE INDEX ix_view_filter_notice_user ON view_filter_notice (user_id) WHERE user_id IS NOT NULL;
-- 보관 정리(30일)
CREATE INDEX ix_view_filter_notice_created ON view_filter_notice (created_at);

COMMENT ON TABLE view_filter_notice IS
  '정본 §3.6 view_user_override [보강 RT-3] ③. 지운 · 타입을 바꾼 속성의 조건을 뷰에서 뺀 기록 — 그 뷰를 다음에 볼 때 한 번 알린다. user_id NULL = 공유 층.';

CREATE TABLE view_filter_notice_seen (
  notice_id uuid        NOT NULL REFERENCES view_filter_notice(id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  seen_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_view_filter_notice_seen PRIMARY KEY (notice_id, user_id)
);

CREATE INDEX ix_view_filter_notice_seen_user ON view_filter_notice_seen (user_id);

COMMENT ON TABLE view_filter_notice_seen IS
  '정본 §3.6 view_user_override [보강 RT-3] ③. 그 알림을 본 사람 — 한 번만 보인다. 뺀 사람(지운 사람)은 뺄 때 넣는다.';
