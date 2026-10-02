/**
 * 이모지 목록의 지연 로드 — 고르개를 처음 열 때 · "아이콘 추가"를 처음 누를 때 (잔여 묶음 8c-1 · F-02-05)
 *
 * ⚠ 브라우저에서만 부른다. 데이터(`emojibase-data` 한국어 판 · 약 800KB · 압축하면 그 1/5 남짓)는 페이지 묶음에 넣지 않는다 —
 * 글자 그대로의 `import()` 라 번들러가 따로 조각으로 떼고, 한 번 받으면 같은 약속을 다시 쓴다. 실패하면 약속을 버려 다음에 다시
 * 받는다(네트워크가 잠깐 끊긴 것으로 고르개가 영영 죽지 않게).
 */

import { buildEmojiCatalog, type EmojiCatalog, type RawEmoji } from '@/lib/emoji/catalog'

let loading: Promise<EmojiCatalog> | null = null

export function loadEmojiCatalog(): Promise<EmojiCatalog> {
  loading ??= import('emojibase-data/ko/data.json')
    .then((mod) => buildEmojiCatalog((mod as unknown as { default: readonly RawEmoji[] }).default))
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}
