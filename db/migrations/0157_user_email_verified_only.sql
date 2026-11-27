-- 계정의 이메일 — 검증된 주소만 · 대표는 자기 행 · 확인 대기는 요청의 것 (AC-1 · F-14-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.2 [보강 AC-0] ① ⑥ · DDL 의 user_email · otp_challenge 주석
--
-- ① user_email 에는 검증된 주소만 산다. 확인 대기는 otp_challenge(purpose='email_verify') 에만 있다 — 미검증 행이 전역 UNIQUE 의
--    자리를 차지하면 남의 주소를 선점해 그 주소의 가입 · 로그인을 막을 수 있다. 시험이 남긴 미검증 행(대표가 아닌 것 — 대표는
--    A2 의 CHECK 로 이미 검증됨)을 지운 뒤 CHECK 을 건다.
-- ⑥ user.primary_email_id 는 자기 행만 가리킨다 — (id, user_id) UNIQUE 를 표적으로 한 복합 FK. 순환 FK 와 같이 DEFERRABLE 이다
--    (계정 생성은 user 와 user_email 을 한 트랜잭션에서 넣는다). 0002 의 단일 FK(user_primary_email_fk)는 이것에 포함되므로 뗀다 —
--    그 FK 는 user_email 행을 지울 때마다 색인 없는 user.primary_email_id 를 훑었다(개발 DB 95만 명에서 행마다 ~45ms). 복합 FK 의
--    지우기 검사는 user 의 PK(id)를 탄다.
-- ① otp_challenge 의 email_verify 는 늘 계정과 주소가 있다 — 코드 확인이 "그 요청을 낸 계정의 대기"만 맞히는 근거.

ALTER TABLE "user" DROP CONSTRAINT user_primary_email_fk;

DELETE FROM user_email e
 WHERE e.verified_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.primary_email_id = e.id);

ALTER TABLE user_email
  ADD CONSTRAINT user_email_verified CHECK (verified_at IS NOT NULL);

ALTER TABLE user_email
  ADD CONSTRAINT ux_user_email_id_user UNIQUE (id, user_id);

ALTER TABLE "user"
  ADD CONSTRAINT user_primary_email_own_fk
  FOREIGN KEY (primary_email_id, id) REFERENCES user_email (id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE otp_challenge
  ADD CONSTRAINT otp_email_verify_has_owner
  CHECK (purpose <> 'email_verify' OR (user_id IS NOT NULL AND email IS NOT NULL));

-- 계정마다 열린 확인 대기를 찾는다(목록 · 재요청 때 옛 코드를 닫기 · 코드 확인)
CREATE INDEX ix_otp_challenge_email_verify ON otp_challenge (user_id, email)
  WHERE purpose = 'email_verify' AND consumed_at IS NULL;

COMMENT ON TABLE user_email IS
  '불변식 A1: user 당 is_primary 행 정확히 1개
   불변식 A2: is_primary -> verified_at IS NOT NULL (CHECK 로 강제)
   불변식 A3: user 당 행 개수 <= 5 (MAX_EMAILS_PER_ACCOUNT) — 애플리케이션이 사람 행을 잠그고 센다
   불변식 A4: 계정 알림(notification_delivery.channel=''email'')의 수신 주소는 is_primary 행이다 <14 R-9>
   [보강 AC-0] ① 검증된 주소만 산다 — verified_at IS NOT NULL (CHECK) · 확인 대기는 otp_challenge(email_verify)
   [보강 AC-0] ⑥ user.primary_email_id 는 자기 행만 (복합 FK user_primary_email_own_fk)';
