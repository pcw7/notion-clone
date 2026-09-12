/**
 * 일치 구간 강조 — W7 (F-07-02)
 *
 * 정본: 07-search-navigation.md F-07-02 UI/인터랙션
 *   *"매칭 토큰 하이라이트(Postgres `ts_headline`으로 서버 생성 권장)"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * `ts_headline` 을 쓰지 않고 화면에서 강조한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본은 서버 생성을 권했지만 우리 구성에서는 화면 쪽이 맞다. 이유 셋:
 *
 * 1. **`ts_headline` 은 한국어에서 쓸모가 없다.** 강조는 tsquery 가 매칭한
 *    토큰에 붙는데, CJK 축은 애초에 tsvector 를 쓰지 않는다(마이그레이션 0012).
 *    서버 강조를 쓰면 **영어 결과만 강조되고 한국어 결과는 안 되는** 화면이 된다.
 * 2. **regconfig 가 `simple` 이라 스테밍이 없다.** 토큰 ↔ 표면형이 항등이므로
 *    화면에서 부분 문자열을 찾는 것이 서버 강조와 **같은 결과**다. `english` 를
 *    썼다면(run → running) 화면이 재현할 수 없었을 것이다.
 * 3. 서버가 마크업을 만들어 보내면 그 문자열을 어딘가에서 HTML 로 해석해야
 *    한다. 사용자 본문에서 나온 문자열이다 — 그 경로를 만들지 않는다.
 *
 * 그래서 서버는 **평문 스니펫**만 주고, 강조는 이 순수 함수가 계산한다.
 * 반환이 배열이므로 화면은 `<mark>` 로 감싸기만 하고 `dangerouslySetInnerHTML`
 * 이 필요 없다.
 */

export type HighlightPart = {
  readonly text: string
  /** 이 조각이 쿼리에 걸렸는가. */
  readonly hit: boolean
}

/** 쿼리를 강조 대상 토큰으로 쪼갠다. */
function tokensOf(query: string): string[] {
  // 따옴표는 서버의 구문 검색 문법이고(F-07-02 — `websearch_to_tsquery`),
  // 강조 대상은 그 안의 말이다. 여기서는 따옴표를 벗겨 토큰으로만 본다.
  // `-제외` 의 제외 토큰은 **강조하지 않는다** — 그 말이 없는 문서만 걸렸으므로
  // 강조할 대상이 애초에 없고, 강조하면 있는 것처럼 보인다.
  const raw = query
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !t.startsWith('-'))
    // `OR` 는 연산자이고 찾는 말이 아니다.
    .filter((t) => t.toUpperCase() !== 'OR')

  // 긴 토큰을 먼저 본다. `['검색', '검색엔진']` 순서면 '검색엔진' 안의 '검색'만
  // 강조되고 뒤쪽 '엔진' 이 평문으로 남아 조각이 쪼개져 보인다.
  return [...new Set(raw)].sort((a, b) => b.length - a.length)
}

/**
 * 텍스트를 강조 조각으로 쪼갠다.
 *
 * 대소문자를 무시한다(서버의 `simple` analyzer 와 `lower()` 기반 스니펫과
 * 같은 규칙). 겹치는 일치는 앞에서부터 한 번만 센다.
 *
 * @returns 이어 붙이면 원문과 **정확히 같은** 조각 배열. 빈 텍스트면 빈 배열.
 */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  if (text === '') return []
  const tokens = tokensOf(query)
  if (tokens.length === 0) return [{ text, hit: false }]

  const lower = text.toLowerCase()
  const lowerTokens = tokens.map((t) => t.toLowerCase())

  const parts: HighlightPart[] = []
  let plainFrom = 0
  let at = 0

  while (at < text.length) {
    // 이 위치에서 시작하는 토큰이 있는가. 긴 것부터 본다.
    const matched = lowerTokens.find((t) => lower.startsWith(t, at))
    if (matched === undefined) {
      at += 1
      continue
    }
    if (at > plainFrom) parts.push({ text: text.slice(plainFrom, at), hit: false })
    parts.push({ text: text.slice(at, at + matched.length), hit: true })
    at += matched.length
    plainFrom = at
  }

  if (plainFrom < text.length) parts.push({ text: text.slice(plainFrom), hit: false })
  return parts
}
