-- 설정 값 표 — 잔여 묶음 8h조각 (F-12-03 · F-17-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.1 [보강] 설정 정보구조 ② · [보강] 설정 값 표 · 테마 ① ~ ⑤
--       17-ops-governance.md F-17-12 `setting_value(scope, scope_id, key, value jsonb, updated_by, updated_at)`
--       12-platform-ux.md F-12-03 *"다크모드 선택은 계정에 로그인된 모든 워크스페이스에 동일 적용"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 전용 칸이 없는 첫 설정(테마)이 생겼다
-- ──────────────────────────────────────────────────────────────────────
--
-- 8g-1 은 설정의 값을 그 설정이 이미 사는 칸에 두었다(`"user".name` · `workspace.name` · `security_policy`). 테마는 계정 범위인데
-- 사는 칸이 없다 — 판결 ② 가 예고한 대로 `setting_value` 가 이것과 함께 생긴다. `"user"` 에 `theme` 칸을 더하지 않는 까닭: 계정
-- 범위의 설정은 앞으로도 늘고(언어 · 시간대 · 조회 기록 · 발견 가능성 — 14 F-14-15), 칸으로 늘리면 설정이 사용자 표에 흩어진다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 17 의 모양에서 바꾼 것 — 주인을 FK 로
-- ──────────────────────────────────────────────────────────────────────
--
-- 17 은 `(scope, scope_id, key)` 를 적었다. `scope_id` 하나로는 FK 를 걸 수 없다 — 지워진 워크스페이스의 값이 남고, 없는 사람의 값이
-- 들어온다. 그래서 주인을 FK 둘 중 **정확히 하나**로 가리킨다(범위와 맞물리는 CHECK 둘). 표로 올린 불변식:
--
--   SV1  범위 ↔ 주인 — account 면 user_id 만, workspace 면 workspace_id 만
--   SV2  키는 범위로 시작한다(`account.theme`) — 다른 범위의 키를 잘못 넣는 실수를 표가 막는다
--   SV3  값은 스칼라(문자열 · 참거짓 · 수) — 모양(고를 수 있는 값 · 글자 수)은 레지스트리가 본다
--   SV4  주인 · 키마다 한 줄(부분 UNIQUE 둘)
--
-- 기존 행: 없다(새 표).

CREATE TABLE setting_value (
  scope        text NOT NULL,
  user_id      uuid NULL REFERENCES "user"(id),
  workspace_id uuid NULL REFERENCES workspace(id) ON DELETE CASCADE,
  key          text NOT NULL,
  value        jsonb NOT NULL,
  updated_by   uuid NULL REFERENCES "user"(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_setting_value_scope CHECK (scope IN ('account', 'workspace')),
  -- SV1
  CONSTRAINT ck_setting_value_account_owner CHECK ((scope = 'account') = (user_id IS NOT NULL)),
  CONSTRAINT ck_setting_value_workspace_owner CHECK ((scope = 'workspace') = (workspace_id IS NOT NULL)),
  -- SV2
  CONSTRAINT ck_setting_value_key CHECK (split_part(key, '.', 1) = scope AND length(key) > length(scope) + 1),
  -- SV3
  CONSTRAINT ck_setting_value_scalar CHECK (jsonb_typeof(value) IN ('string', 'boolean', 'number'))
);

-- SV4
CREATE UNIQUE INDEX ux_setting_value_account ON setting_value (user_id, key) WHERE scope = 'account';
CREATE UNIQUE INDEX ux_setting_value_workspace ON setting_value (workspace_id, key) WHERE scope = 'workspace';

COMMENT ON TABLE setting_value IS
  '전용 칸이 없는 설정의 값(정본 §3.1 [보강] 설정 정보구조 ②). 행이 없으면 기본값 — 기본값은 settings.ts 의 그 키의 자리가 쥔다.';
