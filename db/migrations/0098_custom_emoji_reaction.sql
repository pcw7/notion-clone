-- 커스텀 이모지 반응 — 인접 제품 7c-3d-2조각 (F-13-16 · F-05-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ⑩
--
-- 반응의 키(`reaction.emoji`)가 커스텀 이모지를 가리킬 수 있게 넓힌다 — `custom_emoji:{uuid}`(소문자). 새 칸을 두지 않는다:
-- PK `(target_kind, target_id, user_id, emoji)` 가 곧 2P-Set 이라 키 하나가 이모지 하나여야 한다.
--
--   · 0018 의 이름 없는 CHECK(`reaction_emoji_check` — 1~16자)을 이름 있는 것으로 바꾼다: 1~16자이거나 `custom_emoji:` + 소문자 uuid
--   · 그 이모지가 이 워크스페이스에 살아 있는지는 명령이 본다(더하기 때만 — 지운 뒤에도 빼기는 된다 · 키 안의 id 에 FK 를 걸 수 없다)
--
-- 기존 행: 모두 1~16자다 — 그대로 통과한다.

ALTER TABLE reaction DROP CONSTRAINT reaction_emoji_check;

ALTER TABLE reaction
  ADD CONSTRAINT ck_reaction_emoji CHECK (
    char_length(emoji) BETWEEN 1 AND 16
    OR emoji ~ '^custom_emoji:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
