-- 뷰의 기본 템플릿이 가리킬 수 있는 것 — 템플릿 6c-1조각 (F-08-03)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 `view.default_template_page_id uuid NULL`
--       §3.5 `page.is_template` · 불변식 R1(*"모든 뷰/API 쿼리는 기본 조건으로 is_template=false 를 강제한다"*)
--       08-templates-automation.md F-08-03
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 컬럼 하나인가 — 08 이 제안한 표를 만들지 않는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 08 F-08-03 의 "데이터 모델 함의"는 `view_default_template(view_id, database_id, template_page_id, scope)` 별도 표를
-- 제안한다(뷰별 지정과 DB 전체 지정을 2단계로 조회). 정본은 그것을 받지 않고 `view.default_template_page_id` 컬럼
-- 하나로 정했다 — 문서 계층상 정본이 이긴다(CLAUDE.md).
--
-- 그 결정은 기능을 줄이지 않는다. 08 자신이 *"뷰별 지정이 DB 전체 지정보다 우선한다"* 고 적었으므로 **뷰별이 상위
-- 개념**이고, "DB 전체"는 뷰마다 같은 값을 넣은 것과 결과가 같다. scope 열을 두면 "전체로 지정한 뒤 한 뷰만 바꿨다"를
-- 표현할 수 있지만, 그 상태를 화면에 정직하게 그리는 비용(뱃지가 '전체' 인지 '이 뷰' 인지)이 v1 에서 가치를 넘는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 컬럼은 0015 부터 있었고 아무것도 검사하지 않았다
-- ──────────────────────────────────────────────────────────────────────
--
-- 0015 가 `default_template_page_id uuid NULL` 을 **참조 없이** 만들었다. 지금 그 컬럼을 처음 쓰기 시작하므로, 쓰기
-- 시작하는 자리에서 표현할 수 있는 불변식을 승격한다(CLAUDE.md — 주석으로만 남기지 않는다):
--
--   ① 있지도 않은 페이지를 가리킬 수 없다 · 그 페이지가 영구 삭제되면 지정이 풀린다  → FK + ON DELETE SET NULL
--   ② 가리키는 것은 **이 뷰가 보는 표의 템플릿 행**이어야 한다                        → 트리거
--
-- ②를 CHECK 으로 쓸 수 없는 이유는 `page` 라는 다른 표를 봐야 해서다(0025 와 같은 사정).
--
-- ②가 막는 것은 이런 것들이다:
--
--   · 일반 행(`is_template = false`)을 기본 템플릿으로 지정 — 뷰 질의에는 보이는 행이 `New` 의 원본이 되어
--     "누르면 저 행이 복제되는" 표가 된다. R1 의 반대쪽이 무너진다
--   · **다른 표**의 템플릿을 지정 — 셀을 복사할 때 프로퍼티 id 가 하나도 맞지 않아 빈 행이 나온다.
--     조용히 빈 행을 만드는 대신 지정 자체를 막는다
--   · data_source 가 없는 뷰(대시보드 위젯 · `ck_view_needs_source` 가 허용하는 유일한 경우)에 지정
--
-- ⚠ **`page.is_template` 을 뒤집는 쪽은 이 트리거가 보지 않는다.** 지금은 그런 명령이 없다(템플릿은 템플릿으로
--   태어나고 그대로 버려진다). "이 행을 템플릿으로 만들기"를 만들게 되면 그 명령이 `page` 쪽 트리거를 더하거나,
--   뒤집기 전에 가리키는 뷰의 지정을 풀어야 한다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 휴지통은 FK 가 보지 못한다 — 읽는 쪽이 본다
-- ──────────────────────────────────────────────────────────────────────
--
-- 템플릿을 버리는 것은 `block.lifecycle = 'trashed'` 이고 행은 남는다(X-3). FK 는 행이 사라질 때만 도므로 그때는
-- 풀리지 않는다. 그래서 **저장된 값은 그대로 두고 읽는 쪽이 살아 있는지 본다**(`view.ts` `liveDefaultTemplate`) —
-- 그룹 프로퍼티가 지워졌을 때 `group_by` 를 다루는 방식과 같다: 복원하면 지정이 돌아온다.

ALTER TABLE view
  ADD CONSTRAINT fk_view_default_template
  FOREIGN KEY (default_template_page_id) REFERENCES page(id) ON DELETE SET NULL;

CREATE FUNCTION view_default_template_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.default_template_page_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM page p
     WHERE p.id = NEW.default_template_page_id
       AND p.is_template
       AND p.data_source_id IS NOT DISTINCT FROM NEW.data_source_id
  ) THEN
    RAISE EXCEPTION '기본 템플릿은 이 뷰가 보는 표의 템플릿 행이어야 한다 (view % → page %)',
      NEW.id, NEW.default_template_page_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_view_default_template';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION view_default_template_guard() IS
  'F-08-03. view.default_template_page_id 는 그 뷰의 data_source 에 속한 is_template 행만 가리킨다.
   일반 행을 가리키면 R1(뷰 질의는 is_template=false)의 반대쪽이 무너지고, 다른 표의 템플릿을 가리키면
   셀 복사가 조용히 빈 행을 만든다.';

-- `data_source_id` 가 바뀌어도 같은 검사를 탄다 — 뷰가 다른 표로 옮겨 가면 가리키던 템플릿이 남의 것이 된다.
CREATE TRIGGER tg_view_default_template
  BEFORE INSERT OR UPDATE OF default_template_page_id, data_source_id ON view
  FOR EACH ROW EXECUTE FUNCTION view_default_template_guard();
