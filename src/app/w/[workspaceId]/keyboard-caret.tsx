'use client'

/**
 * 소프트 키보드 — 캐럿이 키보드 아래에 남지 않게 (플랫폼 잔여 10j-4 · F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑪ⓑ)
 *
 * 뷰포트 머리표의 `interactive-widget=resizes-content`(루트 레이아웃)를 아는 브라우저는 키보드가 레이아웃을 줄여 스스로 캐럿을 보이게 한다.
 * 모르는 브라우저(iOS Safari)는 보이는 영역(`visualViewport`)만 줄인다 — 그 영역이 바뀔 때 편집 칸에 포커스가 있으면 캐럿(선택의 끝 자리)이
 * 보이는 영역 안에 있는지 보고, 밖이면 캐럿을 담은 스크롤 틀을 그만큼 굴린다(`caretScrollDelta`). 터치 기기(`hover: none`)에서만 —
 * 넓은 화면의 창 크기 · 확대를 키보드로 오해하지 않는다. 그리는 것이 없다.
 */

import { useEffect } from 'react'

import { caretScrollDelta, type VerticalSpan } from '@/lib/platform/keyboard-caret'

/** 포커스가 있는 편집 칸의 캐럿 자리 — 편집기는 선택의 끝(접은 범위), 입력칸은 칸 자신. 알 수 없으면 null. */
function caretOf(active: HTMLElement): VerticalSpan | null {
  if (active.isContentEditable) {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0 || selection.focusNode === null || !active.contains(selection.focusNode)) return null
    const range = selection.getRangeAt(0).cloneRange()
    range.collapse(false)
    const rect = range.getBoundingClientRect()
    if (rect.top !== 0 || rect.bottom !== 0) return { top: rect.top, bottom: rect.bottom }
    // 빈 줄의 접은 범위는 상자가 없다 — 그 줄의 요소로
    const node = selection.focusNode
    const element = node instanceof Element ? node : node.parentElement
    if (element === null) return null
    const box = element.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom }
  }
  const box = active.getBoundingClientRect()
  return { top: box.top, bottom: box.bottom }
}

/** 캐럿을 담은 가장 가까운 세로 스크롤 틀 — 없으면 문서. */
function scrollerOf(element: HTMLElement): Element {
  for (let node: HTMLElement | null = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return document.scrollingElement ?? document.documentElement
}

export function KeyboardCaret() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const touch = window.matchMedia('(hover: none)')
    let frame = 0
    const keepCaretVisible = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!touch.matches) return
        const active = document.activeElement
        if (!(active instanceof HTMLElement)) return
        if (!active.isContentEditable && !active.matches('input, textarea')) return
        const caret = caretOf(active)
        if (caret === null) return
        const delta = caretScrollDelta(caret, { top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height })
        if (delta !== 0) scrollerOf(active).scrollBy({ top: delta })
      })
    }
    // 크기가 바뀔 때만(키보드가 열리고 닫힐 때) — 보이는 영역의 스크롤까지 들으면 키보드를 연 채 다른 곳을 보려고 굴릴 때 캐럿으로 끌려 돌아온다
    viewport.addEventListener('resize', keepCaretVisible)
    return () => {
      viewport.removeEventListener('resize', keepCaretVisible)
      cancelAnimationFrame(frame)
    }
  }, [])
  return null
}
