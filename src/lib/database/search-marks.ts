/**
 * 맞은 글자 강조 — 글을 검색어와 맞은 조각 · 아닌 조각으로 나눈다 (뷰 검색의 나머지 트랙 V-3 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 뷰 검색 ⑦
 *
 * 서버의 부분 일치(대소문자 무시 · `lower()` · [보강] 뷰 검색 ②)와 같은 뜻으로 왼쪽부터 겹치지 않게 찾는다. 소문자로 바꿔 찾고 원래 글을
 * 같은 자리로 자른다 — 바꿔도 길이가 그대로인 글(한국어 · 라틴)에서 맞다. 길이가 바뀌는 글자(드문 대문자 몇)가 섞여 자리가 어긋나면
 * 강조하지 않는다(통째로 맞지 않은 조각 — 틀린 자리를 칠하지 않는다).
 */

export type MarkPiece = { readonly text: string; readonly hit: boolean }

export function searchMarks(text: string, term: string | null | undefined): MarkPiece[] {
  const needle = (term ?? '').trim().toLowerCase()
  if (needle === '' || text === '') return text === '' ? [] : [{ text, hit: false }]
  const hay = text.toLowerCase()
  if (hay.length !== text.length) return [{ text, hit: false }]
  const pieces: MarkPiece[] = []
  let from = 0
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, from)) {
    if (at > from) pieces.push({ text: text.slice(from, at), hit: false })
    pieces.push({ text: text.slice(at, at + needle.length), hit: true })
    from = at + needle.length
  }
  if (from < text.length) pieces.push({ text: text.slice(from), hit: false })
  return pieces
}
