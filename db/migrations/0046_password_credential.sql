-- 비밀번호 자격증명 — 잔여 묶음 8i-1a조각 (F-14-03)
--
-- 정본: docs/research/00-canonical-data-model.md §3.2 `credential` · 불변식 A5 · [보강] 비밀번호 ① · ②
--       14-auth-accounts.md F-14-03 *"credential(kind='password', password_hash) 0..1행. user 테이블에 password 컬럼을 두면 안 된다"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 비밀번호를 정하는 길이 생긴다
-- ──────────────────────────────────────────────────────────────────────
--
-- 0002 는 A5(비밀번호는 사람마다 0~1줄)를 주석으로 남기고 애플리케이션에 맡겼다 — 그때는 비밀번호를 만드는 길이 없었다. 이제 생기므로
-- 표로 올린다. 두 사람이 동시에(같은 계정의 두 탭에서) 처음 정하면 두 줄이 생길 수 있고, 그러면 로그인이 어느 해시를 볼지 정해지지
-- 않는다.
--
--   ① A5 — 사람마다 비밀번호 줄은 하나(부분 UNIQUE)
--   ② 비밀번호 줄에만 해시가 있다 — 다른 종류(passkey · oauth)에 해시가 붙거나 비밀번호 줄에 해시가 없으면 거부
--   ③ 해시는 argon2id 의 PHC 모양이다(`$argon2id$v=19$…`) — 평문이나 다른 알고리즘이 잘못 들어가는 것을 표가 막는다. 알고리즘을 바꾸는 날은
--      이 CHECK 을 고치는 마이그레이션과 함께다(정본 ① — 매개변수는 값 안에 있어 바꿔도 이 CHECK 은 그대로다)
--
-- 기존 행: 비밀번호 줄이 없다(만드는 길이 없었다) — 셋 다 그대로 지난다.

CREATE UNIQUE INDEX ux_credential_one_password ON credential (user_id) WHERE kind = 'password';

ALTER TABLE credential
  ADD CONSTRAINT ck_credential_password_hash CHECK ((kind = 'password') = (password_hash IS NOT NULL)),
  ADD CONSTRAINT ck_credential_password_argon2id CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$v=19$%');

COMMENT ON TABLE credential IS
  '불변식 A5: kind=''password'' 행은 user 당 <=1 (0 이 정상 — 비밀번호 없는 계정) — ux_credential_one_password(0046)
   불변식 A6: kind=''passkey'' 행은 user 당 <=5 — 애플리케이션이 강제';
