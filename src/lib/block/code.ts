/**
 * 코드 블록의 값 — 잔여 묶음 8a-1 (F-01-14 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 코드 블록의 저장 모양 ①
 *       01-block-editor.md F-01-14 *"`language` 는 enum 이 아니라 문자열로 저장 … 지원 목록에서 빠진 값이 들어와도 원본을
 *       보존해야 라운드트립이 깨지지 않는다"*
 *
 * 본문 편집기 · 블록 복사의 평문 · Markdown 내보내기가 같은 규칙을 쓴다 — 셋이 각자 세면 한쪽의 울타리가 코드 안의 백틱에
 * 끊긴다.
 */

/** 언어를 고르지 않은 코드 블록의 언어 — 노션의 기본값 이름. 저장하지 않는다(없으면 이것이다). */
export const PLAIN_TEXT_LANGUAGE = 'plain text'

/**
 * 코드 블록의 언어 — 고른 적이 없거나 plain text 면 null. **목록 밖의 값도 그대로 준다**(보존 · 정본 ①) — 표시할 이름이
 * 없는 것은 화면이 가른다.
 */
export function codeLanguageOf(properties: Readonly<Record<string, unknown>> | undefined): string | null {
  const raw = properties?.language
  if (typeof raw !== 'string') return null
  const language = raw.trim()
  return language === '' || language.toLowerCase() === PLAIN_TEXT_LANGUAGE ? null : language
}

/**
 * Markdown 울타리 — 코드 안의 가장 긴 백틱 줄보다 하나 긴 백틱(셋 이상). CommonMark 는 여는 울타리보다 짧지 않은 백틱 줄에서
 * 코드를 닫으므로, 코드 안에 ```` ``` ```` 가 있으면 넷으로 연다.
 */
export function markdownFence(code: string): string {
  let longest = 0
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * 울타리의 정보 문자열 — 언어. CommonMark 의 백틱 울타리는 정보 문자열에 백틱을 받지 않고 첫 낱말만 언어로 읽는다 — 백틱은
 * 빼고 공백은 `-` 로 잇는다(목록 밖의 값도 보존하되 울타리를 깨지 않는다).
 */
export function fenceInfo(language: string | null): string {
  return language === null ? '' : language.replace(/`/g, '').trim().replace(/\s+/g, '-')
}

/** 코드 블록 하나를 Markdown 울타리로 — 줄마다 `indent` 를 앞에 붙인다. */
export function fencedCode(code: string, language: string | null, indent = ''): string[] {
  const fence = markdownFence(code)
  return [`${indent}${fence}${fenceInfo(language)}`, ...code.split('\n').map((line) => `${indent}${line}`), `${indent}${fence}`]
}

/** 코드 블록의 타입 이름(`block.type` · 공개 API 와 같다). 노드 이름은 `code_block` 이다(레지스트리 `nodeName`). */
export const CODE_TYPE = 'code'

/** 언어 이름의 길이 상한 — 목록 밖의 값도 보존하지만(정본 ①) 끝없는 글자는 받지 않는다. */
export const MAX_CODE_LANGUAGE_LENGTH = 64

/**
 * 코드 블록의 properties 를 검사한다 — 본문 저장(API)이 화면을 거치지 않고 올 수 있다. `language` 는 문자열(64자까지 ·
 * 목록 밖의 값도 받는다), `caption` 은 RichText 배열.
 */
export function validateCodeProperties(properties: unknown, path: string): { path: string; message: string }[] {
  const raw = (properties as { language?: unknown; caption?: unknown } | null | undefined) ?? {}
  const issues: { path: string; message: string }[] = []
  if (raw.language !== undefined && raw.language !== null) {
    if (typeof raw.language !== 'string') issues.push({ path: `${path}.language`, message: '문자열이어야 합니다' })
    else if (raw.language.length > MAX_CODE_LANGUAGE_LENGTH) {
      issues.push({ path: `${path}.language`, message: `${MAX_CODE_LANGUAGE_LENGTH}자까지입니다` })
    }
  }
  if (raw.caption !== undefined && !Array.isArray(raw.caption)) {
    issues.push({ path: `${path}.caption`, message: 'RichText 배열이어야 합니다' })
  }
  return issues
}
