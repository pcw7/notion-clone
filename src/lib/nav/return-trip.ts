/**
 * 되돌아간 자리 — 렌더 표지 · 항목마다의 스크롤 자리 (59번 트랙 NV-2 · F-07-12 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑦ [NV-2 고침] · ⑨ [NV-2]
 *
 *   · 렌더 표지(⑨) — 서버 렌더마다 무작위 id 를 화면에 싣는다. 화면이 같은 표지를 **두 번째로** 붙이면 라우터가 받아 둔 렌더(bfcache)를 다시 그린
 *     것이다 — 서버는 그 열기를 보지 못했다. 처음 붙는 표지는 서버가 그 렌더에서 이미 남겼다.
 *   · 스크롤 자리(⑦) — 히스토리 항목(Navigation API `currentEntry.key`)마다 마지막 자리. 같은 항목으로 돌아오면 문서가 자라는 동안 그 자리로 맞춘다.
 *     `id` 가 아니라 `key` 다 — Next 는 라우터 상태가 바뀔 때마다(수화 · 다시 묻기 · 흘러 들어온 데이터) `replaceState` 를 불러 `id` 가 바뀐다.
 *     `key` 는 바꿔 써도 같고(항목의 자리) 새 항목이면 새 것이다. 자리를 바꿔 쓴 다른 화면은 경로로 가른다.
 *
 * 둘 다 이 탭의 메모리에만 산다(서버 저장 없음 — ⑬). 오래된 것부터 버린다 — 오래 연 탭에서 끝없이 늘지 않게.
 */

/** 기억하는 렌더 표지의 수 — 넘으면 가장 먼저 본 것부터 버린다(버린 렌더를 다시 그리면 한 번 더 남길 뿐이다 — 방문이 빠지지는 않는다). */
export const RENDER_MARK_LIMIT = 200

/** 기억하는 스크롤 자리의 수(항목). */
export const SCROLL_MEMORY_LIMIT = 50

export type RenderMarks = {
  /** 이 표지를 처음 붙이는가 — 처음이면 true(서버가 이미 남겼다) · 다시면 false(받아 둔 렌더 — 서버에 알려야 한다). */
  firstMount(id: string): boolean
}

export function createRenderMarks(limit = RENDER_MARK_LIMIT): RenderMarks {
  const seen = new Set<string>()
  return {
    firstMount(id) {
      if (seen.has(id)) return false
      seen.add(id)
      // Set 은 넣은 차례를 지킨다 — 맨 앞이 가장 오래된 것
      if (seen.size > limit) seen.delete(seen.values().next().value as string)
      return true
    },
  }
}

/** 적어 둔 자리 — 그때의 경로와 함께(같은 항목 자리를 다른 화면이 바꿔 쓰면 그 자리를 쓰지 않는다). */
export type ScrollMark = { readonly y: number; readonly path: string }

export type ScrollMemory = {
  remember(entryKey: string, mark: ScrollMark): void
  recall(entryKey: string): ScrollMark | undefined
}

export function createScrollMemory(limit = SCROLL_MEMORY_LIMIT): ScrollMemory {
  const at = new Map<string, ScrollMark>()
  return {
    remember(entryKey, mark) {
      // 다시 적으면 맨 뒤로(가장 최근) — 버리는 것은 가장 오래 손대지 않은 항목
      at.delete(entryKey)
      at.set(entryKey, mark)
      if (at.size > limit) at.delete(at.keys().next().value as string)
    },
    recall: (entryKey) => at.get(entryKey),
  }
}

/**
 * 복원할 곳 — 적어 둔 자리가 있고(같은 항목으로 돌아왔다) · 그때와 같은 경로이고(항목 자리를 바꿔 쓴 다른 화면이 아니다) · 맨 위가 아니고 · 주소에
 * 블록 해시가 없을 때(블록으로 가기가 이긴다). 아니면 null.
 */
export function restoreTarget(saved: ScrollMark | undefined, path: string, hash: string): number | null {
  if (saved === undefined || saved.path !== path || saved.y <= 0 || hash !== '') return null
  return saved.y
}

/** 지금 갈 수 있는 자리 — 문서가 아직 짧으면 갈 수 있는 끝까지(자라면 다시 맞춘다). */
export function restoreY(target: number, scrollHeight: number, viewportHeight: number): number {
  return Math.min(target, Math.max(0, scrollHeight - viewportHeight))
}
