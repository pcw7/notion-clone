/**
 * 행 페이지의 모듈 자리 — 본문 영역 · 상세 패널 (항목 레이아웃 3c-1 · F-16-04 · F-16-05)
 *
 * 정본: 00-canonical-data-model.md §3.6 `layout_module` · 불변식 M4 · [보강] 본문 모듈 · 상세 패널
 *
 * 본문 영역(`main`)은 모듈의 세로 줄이다 — 속성 묶음(property_group) 하나와 그 밖으로 올린 속성들. 적용 · 읽기는 그 줄을 **id 목록**으로
 * 주고받는다: 속성은 그 id, 속성 묶음은 `GROUP_MODULE` 이다(속성 id 와 겹치지 않는다 — 속성 id 는 21자다). 상세 패널(`panel`)은 속성
 * 모듈만의 줄이다.
 *
 * 패널에 놓을 수 없는 유형이 있다(M4 · 16 *"Some properties, like Relation, can't be moved to the details panel"*). 정본의
 * `can_place_in_panel` 칸을 두지 않고 유형이 정한다 — 0065 의 트리거가 같은 목록을 본다.
 *
 * 이 파일은 DB 를 모른다 — 화면(편집 모드)과 서버(`layout.ts` · 라우트)가 같은 값을 본다.
 */

/** 본문 영역의 줄에서 속성 묶음의 자리. */
export const GROUP_MODULE = 'property_group'

/** 상세 패널에 놓을 수 없는 유형 — 0065 의 `tg_layout_module_panel_type` 과 같은 목록이다. */
export const PANEL_FORBIDDEN_TYPES: readonly string[] = ['relation']

export const canPlaceInPanel = (type: string): boolean => !PANEL_FORBIDDEN_TYPES.includes(type)
