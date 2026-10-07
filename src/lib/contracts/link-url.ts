/**
 * 누를 수 있는 링크 주소인가 — 편집기의 링크 · 내보내기가 같은 규칙 (F-01-03 · 보안)
 *
 * 저장 계약(`rich-text.ts`)은 링크 주소의 **길이만** 본다 — 가져오기 · API 의 주소를 깨뜨리지 않으려고 스킴을 거르지 않는다. 그래서
 * 주소를 **그리거나 밖으로 내보내는 곳**이 거른다: 편집기의 링크 마크(`schema.ts` — 걸러진 주소는 `href` 를 달지 않는다)와 Markdown
 * 내보내기(`export/markdown.ts`). `javascript:` · `data:` 링크를 그대로 그리면 읽기 전용 · 공유 화면에서 누른 사람의 세션으로 스크립트가
 * 돈다(저장형 XSS) — 협업 참여자는 Y.Doc 에 무엇이든 쓸 수 있다.
 *
 * 스킴이 없는 주소(상대 경로 · `#앵커`)는 받는다. 브라우저는 주소의 탭 · 줄바꿈 · 앞쪽 제어 문자를 **지우고** 해석한다(`java\tscript:`) —
 * 그래서 스킴은 제어 문자와 공백을 모두 걷어낸 모양으로 판정한다(브라우저가 걷는 것의 상위 집합).
 */

export const SAFE_LINK_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel'])

export function isSafeLinkUrl(url: string): boolean {
  let probe = ''
  for (const ch of url) if (ch.charCodeAt(0) > 0x20 && ch !== '\x7f') probe += ch
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(probe)
  return scheme === null || SAFE_LINK_SCHEMES.has(scheme[1].toLowerCase())
}
