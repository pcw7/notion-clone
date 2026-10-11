/**
 * "페이지 단위 접근" 절의 문구 — 데이터베이스의 공유 패널 (게시 · 공유 6f-2c · F-06-10 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 행 단위 접근 규칙 ②⑧
 *
 * 레벨 고르개(없음 + 페이지 레벨 넷 — 규칙의 대상은 행이다) · 서버의 실패 까닭(`AccessRuleFailure` · 라우트의 `invalid_input`)을 사람의 말로.
 */

import { levelLabel } from './share-principals.ts'

/** 규칙이 없을 때의 값 — 고르면 규칙을 지운다. */
export const NO_RULE = ''

/** 규칙의 레벨 — 페이지 레벨 넷(서버 `isGrantableLevel('page')` · 0089 의 CHECK). 맨 앞의 "없음" 은 규칙을 지운다. */
export const RULE_LEVEL_OPTIONS: readonly { value: string; label: string }[] = [
  { value: NO_RULE, label: '없음' },
  ...(['view', 'comment', 'edit', 'full_access'] as const).map((value) => ({ value, label: levelLabel(value) })),
]

/** 절의 설명 — 06 의 권고 조합을 말한다. */
export const PAGE_ACCESS_HINT = '행을 만든 사람에게 그 행의 권한을 줍니다. "만들기만" 과 함께 쓰면 각자 자기가 만든 행만 보고 고칩니다.'

/** 규칙 줄의 이름 — 소스가 둘 이상이면 소스 이름을 앞에 단다(어느 표의 규칙인지). */
export function ruleRowLabel(sourceName: string | null): string {
  return sourceName === null ? '만든 사람' : `${sourceName} · 만든 사람`
}

/** 보는 사람에게 — 지금 레벨의 이름(없으면 "없음"). */
export function ruleLevelLabel(level: string | null): string {
  return level === null || level === NO_RULE ? '없음' : levelLabel(level)
}

const FAILURE: Readonly<Record<string, string>> = {
  not_found: '이 데이터베이스를 찾을 수 없습니다.',
  forbidden: '전체 권한이 있어야 페이지 단위 접근을 바꿀 수 있습니다.',
  invalid_level: '줄 수 없는 권한입니다.',
  unsupported_source: '아직 고를 수 없는 기준입니다.',
  invalid_property: '고를 수 없는 속성입니다 — 이 데이터베이스의 사람 속성이어야 합니다.',
  invalid_input: '바꾸지 못했습니다.',
}

export function pageAccessFailureMessage(reason: unknown): string {
  // 자기 칸만 — `FAILURE['constructor']` 는 객체 원형의 함수다
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '바꾸지 못했습니다.'
}
