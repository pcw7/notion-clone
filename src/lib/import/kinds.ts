/**
 * 가져오기의 파일 형식 · 이름 — 잔여 묶음 8m-1 · 8m-2a (F-09-12 · 순수)
 *
 * 형식은 확장자로 가른다(대소문자 무관). 제목은 파일 이름에서 — 경로 · 확장자 · **노션 내보내기의 id 접미**(` ` + 16진수 32자)를 뗀다.
 */

const KINDS = { md: 'markdown', markdown: 'markdown', txt: 'text', zip: 'zip' } as const
export type ImportKind = (typeof KINDS)[keyof typeof KINDS]

export function importKindOf(name: string): ImportKind | null {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase()
  return ext !== undefined && Object.hasOwn(KINDS, ext) ? KINDS[ext as keyof typeof KINDS] : null
}

/** 노션 내보내기가 이름 뒤에 붙이는 id(` 1a2b…` — 16진수 32자)를 뗀다. 우리 내보내기의 겹침 접미(8자)는 떼지 않는다 — 진짜 이름일 수 있다. */
export const stripNotionId = (name: string): string => name.replace(/\s+[0-9a-f]{32}$/i, '')

/** 파일 이름에서 제목 — 경로 · 확장자 · 노션 id 를 뺀다. 비면 "가져온 페이지". */
export function titleFromFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const stem = stripNotionId(base.replace(/\.[^.]+$/, '')).trim()
  return stem === '' ? '가져온 페이지' : stem
}
