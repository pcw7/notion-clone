/**
 * 페이지 작업의 등록소 — 그 일을 할 수 있는 단추가 스스로 등록한다 (35번 트랙 CP-2 · F-07-11 · 정본 §3.9 [보강 CP-2])
 *
 * 검색 오버레이는 레이아웃에 있어 지금 페이지의 권한 · 즐겨찾기 · 잠금 상태를 모른다. 그것을 아는 것은 페이지 머리의 단추들이다(즐겨찾기 ·
 * 복제 · 휴지통 · 잠금). 그래서 **단추가 마운트되면 자기 작업을 등록하고, 사라지면 거둔다** — 그릴 권한이 없는 단추는 등록하지 않으므로
 * 팔레트에도 서지 않는다(07 *"권한 없는 액션 숨김"*). 하는 일은 그 단추의 함수 그대로라 단추의 상태(★ · 잠김)와 어긋나지 않는다.
 *
 * 모듈 하나의 목록과 구독(`useSyncExternalStore`) — 상태를 둘로 두지 않는다. 서버에서는 비어 있다.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

export type PageCommand = {
  /** 작업의 이름표(`data-action`) — 같은 페이지에서 겹치지 않는다. */
  readonly id: string
  /** 이 작업이 다루는 페이지 — 팔레트는 지금 주소의 페이지 것만 보인다(피크 · 다른 페이지의 단추는 빠진다). */
  readonly pageId: string
  readonly label: string
  readonly keywords: readonly string[]
  run(): void
}

let commands: readonly PageCommand[] = []
const listeners = new Set<() => void>()
const EMPTY: readonly PageCommand[] = []

function emit(): void {
  for (const listener of listeners) listener()
}

/** 등록한다 — 같은 페이지의 같은 작업은 갈아 끼운다. 거둘 함수를 돌려준다. */
export function registerPageCommand(command: PageCommand): () => void {
  commands = [...commands.filter((c) => !(c.id === command.id && c.pageId === command.pageId)), command]
  emit()
  return () => {
    if (!commands.includes(command)) return
    commands = commands.filter((c) => c !== command)
    emit()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 지금 등록된 페이지 작업 — 검색 오버레이가 읽는다. */
export function usePageCommands(): readonly PageCommand[] {
  return useSyncExternalStore(
    subscribe,
    () => commands,
    () => EMPTY,
  )
}

/**
 * 단추가 자기 작업을 등록한다 — `pageId` 가 null 이면 등록하지 않는다(권한이 없다 · 데이터베이스 화면처럼 페이지가 아니다). `keywords` 는
 * 모듈 상수로 넘긴다(새 배열이면 매번 다시 등록한다). 하는 일은 늘 최신의 `run`(단추의 상태를 따른다).
 */
export function usePageCommand(id: string, pageId: string | null, label: string, keywords: readonly string[], run: () => void): void {
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => {
    if (pageId === null) return
    return registerPageCommand({ id, pageId, label, keywords, run: () => runRef.current() })
  }, [id, pageId, label, keywords])
}
