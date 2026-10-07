/**
 * 색의 화면 이름 — 블록 메뉴의 '색' · `/` 의 색 명령이 같은 이름을 쓴다 (F-01-21 · Phase 2 1e-1)
 *
 * 다른 편집기 모듈을 가져오지 않는다 — `slash-menu.ts` 가 모듈을 읽을 때 색 명령 목록을 만들고, `block-menu.ts` 는 `slash-menu.ts` 를
 * 가져온다. 이름표가 둘 중 하나에 있으면 순환이 생겨 읽는 순서에 따라 목록이 빈다.
 */

import type { Color } from '../contracts/rich-text.ts'

const COLOR_NAMES: Readonly<Record<string, string>> = {
  gray: '회색',
  brown: '갈색',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  pink: '분홍',
  red: '빨강',
}

/** 색의 화면 이름. `default` 는 "색 없음"이다 — 계약에 `default_background` 가 없는 것과 같은 이유. */
export function colorLabel(color: Color): string {
  if (color === 'default') return '기본'
  if (color.endsWith('_background')) return `${COLOR_NAMES[color.slice(0, -'_background'.length)]} 배경`
  return COLOR_NAMES[color] ?? color
}

/**
 * `/` 로 찾는 별칭 — 한국어 이름 · 붙여 쓴 이름 · 영어 이름(노션의 `/red` · `/blue background`) · "색" · "color". 메뉴는 쿼리의
 * 공백에서 닫힌다(F-01-04 의 종료 조건) — 두 낱말 이름(`빨강 배경` · `blue background`)은 붙여 쓴 꼴(`빨강배경` · `bluebackground`)로 찾는다.
 */
export function colorAliases(color: Color): string[] {
  const label = colorLabel(color)
  const english = color === 'default' ? 'default' : color.replace('_background', ' background')
  return [...new Set([label, label.replace(/\s+/g, ''), english, english.replace(/\s+/g, ''), '색', 'color'])]
}
