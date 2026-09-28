-- 접근 요청 — Teamspace · 게스트 · 그룹 7e-1조각 (F-06-15)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `access_request` · [보강] 접근 요청의 길 ①~⑧
--       §3.8 `activity_event.type` · `notification.kind` · [보강] 접근 요청의 알림
--       06-permissions-sharing.md F-06-15 *"권한이 없거나 부족한 사용자가 스스로 요청을 보내고, 승인 권한자가 승인 · 거부하는
--       비동기 권한 부여 경로"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 표는 정본 DDL 그대로다 — 불변식 몇 개를 CHECK 으로 올렸다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본은 칸과 상태만 적었다. 여기서 올린 것:
--
--   · **페이지를 두고 하는 요청(page_access · edit_access)은 페이지와 요청한 사람이 있다** — 없으면 누구에게 무엇을 줄지 모른다.
--     나머지 종류(가입 · 멤버 추가 · 게스트 추가)는 아직 만들지 않았고, 그 모양은 그 조각이 정한다
--   · **대기 중인 요청은 (페이지, 사람, 종류)마다 하나** — 06 F-06-15 엣지 *"같은 사람이 같은 페이지에 반복 요청 →
--     UNIQUE(node_id, requester_id, kind) WHERE status='pending' 으로 중복 억제"*. 명령은 이 인덱스에 `ON CONFLICT DO NOTHING`
--     으로 기대므로 동시에 두 번 눌러도 알림이 두 번 가지 않는다
--   · **결정은 시각과 함께** — pending 이 아니면 `decided_at` 이 있고, pending 이면 없다. 결정한 사람도 pending 이면 없다
--   · `requested_level` 은 `acl_entry.level` 과 같은 여섯 값 중 하나 — 줄 수 없는 레벨을 요청으로 받지 않는다
--
-- 정본의 불변식 *"pending 은 만료되지 않는다"* 는 그대로다(시각으로 닫는 칸이 없다). 무시(`ignored`)한 요청 뒤의 재요청 간격은
-- 명령이 본다(`access-request.ts` — 하루).
--
-- ──────────────────────────────────────────────────────────────────────
-- 페이지를 지우면 요청도 간다
-- ──────────────────────────────────────────────────────────────────────
--
-- `node_id` 는 블록을 가리키고 `ON DELETE CASCADE` 다 — 06 엣지 *"삭제 시 요청 자동 취소"*. 휴지통(`lifecycle`)은 지우지 않으므로
-- 요청이 남고, 명령이 살아 있는 페이지만 다룬다(휴지통의 페이지는 없는 페이지와 같다). 복원하면 요청도 돌아온다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 알림 · 이벤트의 종류를 넓힌다
-- ──────────────────────────────────────────────────────────────────────
--
-- 요청이 오면 승인할 사람의 인박스에(`access_requested`), 허락되면 요청한 사람의 인박스에(`access_granted`) 알림이 간다. 06 F-06-15
-- 의 데이터 모델 함의가 그 두 이름을 적었다. 알림은 이벤트를 가리키므로(N3) 이벤트 종류도 둘 늘린다 — `access.requested` ·
-- `access.granted`. payload 는 요청 id 만 담는다(사람이 쓴 글이 없다). `activity_event` 는 파티션 표라 부모에서 바꾸면 파티션이
-- 따라온다.

CREATE TABLE access_request (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspace(id),
  kind            text NOT NULL
                  CHECK (kind IN ('page_access', 'edit_access', 'join_workspace', 'add_member', 'add_guest')),
  node_id         uuid NULL REFERENCES block(id) ON DELETE CASCADE,
  requester_id    uuid NULL REFERENCES "user"(id),
  requester_email citext NULL,
  requested_level text NULL
                  CHECK (requested_level IN ('view', 'comment', 'edit_content', 'create', 'edit', 'full_access')),
  message         text NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'denied', 'ignored')),
  decided_by      uuid NULL REFERENCES "user"(id),
  decided_at      timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_access_request_page_target CHECK (
    kind NOT IN ('page_access', 'edit_access') OR (node_id IS NOT NULL AND requester_id IS NOT NULL)),
  CONSTRAINT ck_access_request_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT ck_access_request_decider CHECK (status <> 'pending' OR decided_by IS NULL)
);

CREATE UNIQUE INDEX ux_access_request_pending ON access_request (node_id, requester_id, kind) WHERE status = 'pending';
-- 재요청 간격(무시된 요청의 결정 시각)과 요청한 사람 쪽의 "보냈다" 표시가 읽는다 — 대기 중이 아닌 행도 본다.
CREATE INDEX ix_access_request_requester ON access_request (node_id, requester_id, kind, decided_at DESC);

COMMENT ON TABLE access_request IS
  'F-06-15 접근 요청. 대기 중인 요청은 (페이지, 사람, 종류)마다 하나다(ux_access_request_pending).
   pending 은 만료되지 않는다(정본). 결정은 approved · ignored(무시 — 요청한 사람에게 알리지 않는다). denied 는 아직 쓰지 않는다.
   승인은 공유 설정의 부여(acl.ts grantAccessIn)를 거친다 — 게스트의 레벨 상한 · 공유 게이트가 같은 한 곳에서 걸린다.';

ALTER TABLE activity_event DROP CONSTRAINT activity_event_type_check;
ALTER TABLE activity_event ADD CONSTRAINT activity_event_type_check CHECK (type IN (
  'block.updated', 'property.updated', 'comment.created', 'user.mentioned',
  'page.created', 'page.moved', 'page.trashed',
  'suggestion.created', 'suggestion.accepted',
  'access.requested', 'access.granted'));

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'mention', 'comment', 'comment_reply', 'page_update',
  'invite', 'reminder', 'person_property_assigned', 'suggestion',
  'access_requested', 'access_granted'));
