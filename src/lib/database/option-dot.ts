/**
 * 옵션 색의 점 · 면 — 태그의 점(status 칩 · `cell-view.tsx`)과 차트의 막대 · 조각(`chart-geometry.ts`)이 같은 표를 쓴다 (38번 트랙 CH-2)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 CH-2] ③
 *
 * 칩의 바탕은 반투명이라 막대에 쓸 수 없다 — 점의 색은 밝은 · 어두운 테마 모두에서 바탕과 구분되는 중간 톤이라 테마마다 갈아 끼우지 않는다.
 * 클래스는 **글자 그대로** 둔다(Tailwind 는 소스의 글자에서 클래스를 만든다 — 식으로 조립하면 만들지 않는다). 두 표가 같은 색인지는 테스트가 본다.
 */

import type { OptionColor } from './property-types.ts'

/** 옵션 색 → 면 색(SVG `fill` · `stroke`). */
export const OPTION_DOT_RGB: Readonly<Record<OptionColor, string>> = {
  default: 'rgb(166,163,158)',
  gray: 'rgb(142,139,134)',
  brown: 'rgb(186,133,111)',
  orange: 'rgb(224,124,57)',
  yellow: 'rgb(216,163,47)',
  green: 'rgb(70,161,113)',
  blue: 'rgb(39,131,222)',
  purple: 'rgb(157,104,211)',
  pink: 'rgb(219,105,153)',
  red: 'rgb(229,100,88)',
}

/** 옵션 색 → 점의 배경 클래스(태그의 점). `OPTION_DOT_RGB` 와 같은 색 — `option-dot.test.ts`. */
export const OPTION_DOT_CLASS: Readonly<Record<OptionColor, string>> = {
  default: 'bg-[rgb(166,163,158)]',
  gray: 'bg-[rgb(142,139,134)]',
  brown: 'bg-[rgb(186,133,111)]',
  orange: 'bg-[rgb(224,124,57)]',
  yellow: 'bg-[rgb(216,163,47)]',
  green: 'bg-[rgb(70,161,113)]',
  blue: 'bg-[rgb(39,131,222)]',
  purple: 'bg-[rgb(157,104,211)]',
  pink: 'bg-[rgb(219,105,153)]',
  red: 'bg-[rgb(229,100,88)]',
}
