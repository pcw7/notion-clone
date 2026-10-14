-- 폼의 조건부 보이기 — 인접 제품 7b-5a조각 (F-13-03)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑬
--
-- `form_question` 에 세 칸 — 그 질문은 근거 질문의 답이 조건에 맞을 때만 보인다(조건은 "보이기" 하나 · 이동은 두지 않는다).
--
--   · show_if_property_id — 근거 질문의 속성(그 폼에서 앞에 선 질문 — 명령이 본다 · 순서대로 평가해 순환이 없다)
--   · show_if_operator    — equals · not_equals(선택의 옵션) · is_checked · is_not_checked(체크박스) · is_empty · is_not_empty
--   · show_if_option_id   — 같다 · 같지 않다의 옵션 id(이름을 바꿔도 깨지지 않는다)
--
-- 셋은 함께 비거나 함께 선다 · 자기 자신은 근거가 아니다 · 옵션은 같다 · 같지 않다 에만 있다(`ck_form_question_show_if`).
-- FK 를 걸지 않는다 — 근거의 속성 · 옵션이 지워지면 세 칸이 함께 비어야 하는데 FK 는 한 칸만 비운다. 끊어진 조건은 판정이 무시한다
-- (질문이 보인다).
--
-- 요금제: 엔타이틀먼트 `form.logic`(boolean) — Business · Enterprise 만 조건을 더하고 바꾼다(지우기 · 이미 있는 조건의 적용은 요금제와
-- 무관하다). 모든 요금제가 키를 같은 종류로 갖는다(`billing.db.test.ts` ①).
--
-- 기존 행: 세 칸 모두 비어 있다(조건 없음) — 바뀌는 것이 없다.

ALTER TABLE form_question
  ADD COLUMN show_if_property_id text NULL,
  ADD COLUMN show_if_operator text NULL
    CONSTRAINT ck_form_question_show_if_operator
    CHECK (show_if_operator IN ('equals', 'not_equals', 'is_checked', 'is_not_checked', 'is_empty', 'is_not_empty')),
  ADD COLUMN show_if_option_id uuid NULL,
  ADD CONSTRAINT ck_form_question_show_if CHECK (
    (show_if_property_id IS NULL AND show_if_operator IS NULL AND show_if_option_id IS NULL)
    OR (
      show_if_property_id IS NOT NULL AND show_if_property_id <> property_id AND show_if_operator IS NOT NULL
      AND (show_if_option_id IS NOT NULL) = (show_if_operator IN ('equals', 'not_equals'))
    )
  );

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'form.logic', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'false'::jsonb), ('business', 'true'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
