-- 폼 — 폼 뷰의 설정 · 질문 — 인접 제품 7a-1조각 (F-13-01 · F-13-02)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 끝 [보강] 폼 (DDL · ①~⑤)
--       13-*.md F-13-01 *"폼은 데이터베이스의 뷰다 · 질문 1개 = 프로퍼티 1개 · 응답 = DB 행 그 자체"*
--
-- ① `form_view` — 폼 뷰의 설정(뷰마다 하나). 공개(`public`)면 토큰이 있다 — 웹 게시의 토큰과 같은 모양(22자). 닫아도 토큰은 남는다.
-- ② `form_question` — 질문 = 그 data source 의 속성 하나(같은 속성은 한 번). 순서는 분수 인덱싱 키.
--    "그 뷰가 폼이다" · "그 속성이 그 뷰의 data source 의 것이다" 는 명령이 본다(교차 표 조건이라 CHECK 으로 못 건다).
--
-- 기존 행: 새 표뿐이다.

CREATE TABLE form_view (
  view_id            uuid PRIMARY KEY REFERENCES view(id) ON DELETE CASCADE,
  title              text NULL CONSTRAINT ck_form_view_title CHECK (length(title) BETWEEN 1 AND 200),
  description        text NULL CONSTRAINT ck_form_view_description CHECK (length(description) <= 2000),
  submit_label       text NULL CONSTRAINT ck_form_view_submit CHECK (length(submit_label) BETWEEN 1 AND 40),
  confirmation_title text NULL CONSTRAINT ck_form_view_confirmation_title CHECK (length(confirmation_title) BETWEEN 1 AND 200),
  confirmation_body  text NULL CONSTRAINT ck_form_view_confirmation_body CHECK (length(confirmation_body) <= 2000),
  access             text NOT NULL DEFAULT 'closed'
                     CONSTRAINT ck_form_view_access CHECK (access IN ('closed', 'public')),
  token              text NULL UNIQUE
                     CONSTRAINT ck_form_view_token CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  updated_by         uuid NULL REFERENCES "user"(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_form_view_public_token CHECK (access <> 'public' OR token IS NOT NULL)
);

COMMENT ON TABLE form_view IS
  '7a-1 · F-13-01: 폼 뷰(view.type = form)의 설정. 공개 제출(7a-2)의 자격은 이 행의 토큰 · access 다 — 제출자는 주체가 아니다.';

CREATE TABLE form_question (
  view_id     uuid NOT NULL REFERENCES form_view(view_id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  order_key   text COLLATE "C" NOT NULL CONSTRAINT ck_form_question_order CHECK (length(order_key) > 0),
  label       text NULL CONSTRAINT ck_form_question_label CHECK (length(label) BETWEEN 1 AND 200),
  help_text   text NULL CONSTRAINT ck_form_question_help CHECK (length(help_text) <= 1000),
  required    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (view_id, property_id)
);
CREATE UNIQUE INDEX ux_form_question_order ON form_question (view_id, order_key);

COMMENT ON TABLE form_question IS
  '7a-1 · F-13-01: 질문 = 그 폼의 data source 의 속성 하나. 제목을 비우면 속성 이름을 따른다.';
