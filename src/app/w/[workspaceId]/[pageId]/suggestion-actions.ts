'use client'

/**
 * 제안 카드 · 목록이 함께 쓰는 것 — 이름 · 시각 읽기 · 수락 · 거절 (SG-3 · F-05-12 · 정본 [보강 SG-1] ⑤ · 불변식 S9)
 *
 * 지연 로드 쪽이다(카드 · 목록을 열 때 받는다). 본문의 진실은 마크다 — 무엇이 걸렸는지는 편집기의 문서에서 읽고, 이름 · 시각만 목록 API
 * (`GET …/suggestions` — 투영이 맞춘 메타 표)에서 받는다. 방금 친 제안은 아직 행이 없다(투영은 1초 뒤) — 모르면 잠깐 뒤 다시 읽는다.
 *
 * 수락 · 거절의 차례 — **본문 먼저, 기록은 그다음**(`lib/suggestion/resolve.ts` 머리말):
 *   ① 편집기에 한 트랜잭션(마크 떼기 · 글 지우기 — 앞뒤로 되돌리기 묶음을 끊어 한 번의 Mod+Z 로 돌아온다)
 *   ② `POST …/suggestions/resolve` 로 메타 표에 accepted · rejected · 누른 사람
 * ② 가 실패하면 본문은 이미 바뀌었다 — 알리기만 한다(투영이 그 행을 stale 로 둔다).
 */

import { useEffect, useState } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import { separateUndoStep } from '@/lib/editor/code-block'
import { docSuggestions, resolveSuggestionTransaction, type ResolveAction } from '@/lib/editor/suggestion-resolve'

type Listed = { readonly id: string; readonly authorId: string; readonly authorName: string; readonly createdAt: string }

type Cache = { bySid: Map<string, Listed>; authors: Map<string, string>; loaded: boolean; loading: Promise<void> | null }

const caches = new Map<string, Cache>()

function cacheOf(key: string): Cache {
  let cache = caches.get(key)
  if (cache === undefined) {
    cache = { bySid: new Map(), authors: new Map(), loaded: false, loading: null }
    caches.set(key, cache)
  }
  return cache
}

/** 목록 API 를 다시 읽는다 — 같은 페이지의 겹친 읽기는 하나로. */
function refresh(workspaceId: string, pageId: string): Promise<void> {
  const cache = cacheOf(`${workspaceId}/${pageId}`)
  cache.loading ??= (async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/suggestions`)
      if (!res.ok) return
      const body = (await res.json()) as { suggestions?: Listed[]; authors?: Record<string, string> }
      cache.bySid = new Map((body.suggestions ?? []).map((s) => [s.id.toLowerCase(), s]))
      cache.authors = new Map(Object.entries(body.authors ?? {}))
    } catch {
      // 이름이 없어도 카드 · 목록은 선다 — 다음에 다시 읽는다
    } finally {
      cache.loaded = true
      cache.loading = null
    }
  })()
  return cache.loading
}

/** 모르는 sid 를 다시 묻는 간격 · 횟수 — 투영 창(1초) 뒤. */
const RETRY_MS = 1200
const RETRIES = 4

export type SuggestionMetaView = {
  /** 제안한 사람의 이름표(게스트에게는 "멤버") — 아직 모르면 "…". */
  name(sid: string, authorId: string): string
  /** 처음 본 시각(ISO) — 행이 없으면 null. */
  createdAt(sid: string): string | null
}

/** 이 sid 들의 이름 · 시각 — 모르는 sid 가 있으면 다시 읽는다. */
export function useSuggestionMeta(workspaceId: string, pageId: string, sids: readonly string[]): SuggestionMetaView {
  const key = `${workspaceId}/${pageId}`
  const [, setVersion] = useState(0)
  const sidKey = sids.map((s) => s.toLowerCase()).join(',')

  useEffect(() => {
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const wanted = sidKey === '' ? [] : sidKey.split(',')
    const missing = (): boolean => {
      const cache = cacheOf(key)
      return !cache.loaded || wanted.some((sid) => !cache.bySid.has(sid))
    }
    const run = async (): Promise<void> => {
      await refresh(workspaceId, pageId)
      if (!alive) return
      setVersion((v) => v + 1)
      tries += 1
      if (tries < RETRIES && missing()) timer = setTimeout(() => void run(), RETRY_MS)
    }
    if (missing()) void run()
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [key, sidKey, workspaceId, pageId])

  const cache = cacheOf(key)
  return {
    name: (sid, authorId) => cache.bySid.get(sid.toLowerCase())?.authorName ?? cache.authors.get(authorId.toLowerCase()) ?? cache.authors.get(authorId) ?? '…',
    createdAt: (sid) => cache.bySid.get(sid.toLowerCase())?.createdAt ?? null,
  }
}

export const KIND_LABEL = { insert: '넣기', delete: '지우기', format: '서식' } as const

/**
 * 수락 · 거절 — 본문 한 트랜잭션(S9) 뒤 메타 표 기록. 실패하면 사람에게 보일 말 · 아니면 null. 편집할 수 없는 편집기면 아무것도
 * 하지 않는다(화면이 단추를 그리지 않지만 그사이 읽기 전용이 됐을 수 있다).
 */
export async function resolveInEditor(
  view: EditorView,
  workspaceId: string,
  pageId: string,
  sids: readonly string[],
  action: ResolveAction,
): Promise<string | null> {
  if (!view.editable) return '이 페이지를 고칠 수 없습니다.'
  // 지금 문서에 마크가 남은 것만 — 그사이 남이 정해 사라진 sid 를 내 결정으로 적지 않는다
  const present = new Set(docSuggestions(view.state.doc).map((s) => s.sid))
  const mine = sids.filter((sid) => present.has(sid))
  const tr = resolveSuggestionTransaction(view.state, new Set(mine), action)
  if (tr === null) return null
  separateUndoStep(view.state)
  view.dispatch(tr)
  separateUndoStep(view.state)
  try {
    // 한 번에 받는 수의 상한(`RESOLVE_LIMIT`)마다 나눠 적는다 — 본문은 이미 한 트랜잭션으로 바뀌었다
    for (let at = 0; at < mine.length; at += RESOLVE_CHUNK) {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/suggestions/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ids: mine.slice(at, at + RESOLVE_CHUNK) }),
      })
      if (!res.ok) return res.status === 403 ? '이 페이지를 고칠 수 없어 제안을 정하지 못했습니다.' : '제안을 정한 것을 기록하지 못했습니다.'
    }
    return null
  } catch {
    return '제안을 정한 것을 기록하지 못했습니다 — 연결을 확인해 주세요.'
  } finally {
    void refresh(workspaceId, pageId)
  }
}

/** 서버의 `RESOLVE_LIMIT`(`lib/suggestion/resolve.ts`) — 그 모듈은 서버 쪽이라 값만 옮긴다. */
const RESOLVE_CHUNK = 1000
