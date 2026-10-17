'use client'

/**
 * 기준점에 붙는 층 — 포털 + 고정 위치 (플랫폼 잔여 10j-3a · F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑥)
 *
 * 팝오버를 그 자리(칸 안)에 절대 위치로 그리면 넘침을 자르는 틀(가로로 흐르는 표) 안에서 잘린다. 몸(body)으로 내보내 `position: fixed` 로
 * 세운다. 기준점은 그 자리의 **위치를 가진 가장 가까운 조상** — 절대 위치였을 때의 기준과 같다. 자리는 `placeLayer`(순수) · 스크롤(어느
 * 틀이든 — 포착 단계) · 창 크기 · 층과 기준점의 크기가 바뀌면 다시 잰다. 위치는 DOM 스타일로 직접 쓴다(효과 안의 setState 가 없다).
 *
 * React 의 사건(키 · 포커스 · 마우스)은 포털을 넘어 React 트리를 따라 그대로 흐른다. DOM 의 `contains` 는 아니다 — "포커스가 칸 안에
 * 머무는가"처럼 DOM 으로 보는 곳은 `containsAcrossLayers` 를 쓴다(층에서 그 기준점으로 거슬러 올라가 본다).
 */

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { placeLayer, type LayerAlign } from '@/lib/ui/anchor-position'

/** 층의 뿌리 → 그 기준점. */
const anchorOfLayer = new WeakMap<Element, Element>()

/** `container` 가 `node` 를 품는가 — 층 안의 것이면 그 층의 기준점으로 거슬러 올라가 본다(층 안의 층도). */
export function containsAcrossLayers(container: Element, node: Node | null): boolean {
  let current: Node | null = node
  for (let hops = 0; current !== null && hops < 8; hops += 1) {
    if (container.contains(current)) return true
    const element = current instanceof Element ? current : current.parentElement
    const layer = element?.closest('[data-anchored-layer]') ?? null
    if (layer === null) return false
    current = anchorOfLayer.get(layer) ?? null
  }
  return false
}

function positionedAncestor(element: Element): Element {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if (getComputedStyle(parent).position !== 'static') return parent
  }
  return document.body
}

const subscribeNothing = () => () => {}

export function AnchoredLayer({
  align = 'start',
  gap = 4,
  className = '',
  testId,
  children,
}: {
  readonly align?: LayerAlign
  readonly gap?: number
  readonly className?: string
  readonly testId?: string
  readonly children: ReactNode
}) {
  const placeholderRef = useRef<HTMLSpanElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  // 포털은 브라우저에서만 — 서버 · 하이드레이션 스냅샷은 false
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false)

  useLayoutEffect(() => {
    const layer = layerRef.current
    const placeholder = placeholderRef.current
    if (layer === null || placeholder === null) return
    const anchor = positionedAncestor(placeholder)
    anchorOfLayer.set(layer, anchor)
    let frame = 0
    const update = () => {
      frame = 0
      const root = document.documentElement
      const placed = placeLayer(
        anchor.getBoundingClientRect(),
        { width: layer.offsetWidth, height: layer.scrollHeight },
        { width: root.clientWidth, height: root.clientHeight },
        { align, gap, margin: 8 },
      )
      layer.style.top = `${placed.top}px`
      layer.style.left = `${placed.left}px`
      layer.style.maxHeight = `${placed.maxHeight}px`
      layer.style.visibility = 'visible'
      layer.dataset.side = placed.side
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(layer)
    observer.observe(anchor)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      anchorOfLayer.delete(layer)
    }
  }, [align, gap, isClient])

  return (
    <>
      <span ref={placeholderRef} hidden />
      {isClient &&
        createPortal(
          <div
            ref={layerRef}
            data-anchored-layer=""
            data-testid={testId}
            style={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden', overflowY: 'auto' }}
            className={`z-50 ${className}`}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
