-- 커스텀 이모지 — 워크스페이스의 이모지 라이브러리 — 인접 제품 7c-1조각 (F-13-16)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 (DDL · ①~④)
--       13-*.md F-13-16 *"이모지 삭제 후 참조 잔존 — tombstone 유지 + 플레이스홀더 렌더가 안전"*
--
-- ① `custom_emoji` — 이름 · 이미지 파일(참조 수는 명령이 센다) · 지워도 행은 남는다(쓰인 곳이 이름을 찾는다).
--    살아 있는 것끼리 이름이 하나(부분 UNIQUE) — 지운 이름은 다시 쓸 수 있다.
--
-- 기존 행: 새 표뿐이다.

CREATE TABLE custom_emoji (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name         text NOT NULL CONSTRAINT ck_custom_emoji_name CHECK (name ~ '^[a-z0-9_-]{1,40}$'),
  file_id      uuid NOT NULL REFERENCES file(id),
  created_by   uuid NULL REFERENCES "user"(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL
);
CREATE UNIQUE INDEX ux_custom_emoji_name ON custom_emoji (workspace_id, name) WHERE deleted_at IS NULL;
CREATE INDEX ix_custom_emoji_workspace ON custom_emoji (workspace_id, name);

COMMENT ON TABLE custom_emoji IS
  '7c-1 · F-13-16: 워크스페이스의 커스텀 이모지 — 이름 · 이미지 파일. 지워도 행은 남는다(쓰인 곳이 id 로 가리킨다).';
