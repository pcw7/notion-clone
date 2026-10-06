/**
 * 수식 그리기 — KaTeX 를 감싼다 (Phase 2 1a · F-01-20 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 블록 수식 · 01-block-editor.md F-01-20 엣지 케이스
 *
 * KaTeX 모듈은 **받는다** — 편집기는 수식이 처음 보일 때 지연 로드하고(`loadKatex` · 큰 묶음이다), 검사는 node 에서 그대로 넘긴다.
 *
 *   · **`trust: false` 를 고정한다** — `\href` · `\url` · `\includegraphics` 가 주소를 받는다. 열면 저장형 XSS 다(F-01-20 · 보안)
 *   · **`maxExpand` · `maxSize` 를 고정한다** — `\def` 재귀 · 거대한 크기로 그리는 쪽을 멈추게 할 수 있다(ReDoS · 무한 확장)
 *   · `strict: 'ignore'` — LaTeX 와 다른 점(유니코드 글자 등)을 경고하지 않는다(콘솔을 더럽히지 않는다) · 결과는 같다
 *   · **틀린 식은 던지지 않는다** — 원문을 그대로 두고 까닭을 돌려준다(그리는 쪽이 붉게 · 저장은 그대로 · 블록을 날리지 않는다)
 *   · mhchem(`\ce` · `\pu`)은 그 식이 쓸 때만 불러 온다(`needsMhchem`) — 노션이 지원한다(F-01-20)
 */

import type { KatexOptions } from 'katex'

/** KaTeX 모듈에서 쓰는 것. */
export type Katex = { readonly renderToString: (tex: string, options?: KatexOptions) => string }

/** 고정한 옵션 — 바꾸지 않는다(머리말). */
export const KATEX_OPTIONS: Readonly<KatexOptions> = Object.freeze({
  throwOnError: true,
  trust: false,
  strict: 'ignore',
  maxExpand: 1000,
  maxSize: 50,
  output: 'htmlAndMathml',
})

export type EquationRender =
  | { readonly ok: true; readonly html: string }
  /** 그리지 못했다 — `message` 는 사람이 읽을 까닭(KaTeX 의 머리말을 뗐다). */
  | { readonly ok: false; readonly message: string }

/** 식을 HTML 로. 블록 수식은 `displayMode`. 틀리면 까닭을 돌려준다(던지지 않는다). */
export function renderEquation(katex: Katex, expression: string, displayMode = true): EquationRender {
  try {
    return { ok: true, html: katex.renderToString(expression, { ...KATEX_OPTIONS, displayMode }) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, message: message.replace(/^KaTeX parse error:\s*/, '') }
  }
}

/** 이 식이 mhchem 매크로(`\ce` · `\pu`)를 쓰는가. */
export const needsMhchem = (expression: string): boolean => /\\(ce|pu)(?![A-Za-z])/.test(expression)

let loaded: Promise<Katex> | null = null
let mhchem: Promise<unknown> | null = null

/**
 * 브라우저에서 KaTeX 를 한 번만 불러 온다 — 수식이 있는 페이지만 그 묶음을 받는다. mhchem 이 필요한 식이면 그것도(같은 KaTeX 에 매크로를
 * 더한다). 실패하면 다음 부르기가 다시 시도한다.
 */
export function loadKatex(expression = ''): Promise<Katex> {
  loaded ??= import('katex').then((m) => m.default as Katex).catch((e: unknown) => {
    loaded = null
    throw e
  })
  if (!needsMhchem(expression)) return loaded
  mhchem ??= loaded.then(() => import('katex/contrib/mhchem')).catch((e: unknown) => {
    mhchem = null
    throw e
  })
  return mhchem.then(() => loaded as Promise<Katex>)
}
