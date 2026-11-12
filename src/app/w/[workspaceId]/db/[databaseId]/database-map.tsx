'use client'

/**
 * 지도 — MP-2 (F-04-19 Map view)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 MP-1] ⑥
 *
 * 서버가 낸 핀(`queryMapPins` — 필터 · 정렬을 지난 행 가운데 장소 칸에 값이 있는 처음 100개)을 Leaflet 으로 그린다. 이 파일은 `database-map-lazy.tsx`
 * 로만 불러온다 — Leaflet 은 지도 뷰를 그릴 때만 받는다(번들 예산 `check:bundle`). 핀은 `L.divIcon` 의 인라인 SVG 다(기본 아이콘은 이미지
 * 주소가 번들러에서 깨진다). 타일(`tileUrl`)은 서버가 환경 변수에서 읽어 넘긴다 — null 이면 타일 없이 핀만(출처 표시도 타일과 함께만 선다).
 * 타일을 받지 못해도 핀은 선다(타일 오류는 무시한다).
 *
 * 이 화면은 상태가 없다 — 핀은 서버 렌더가 준다. 바뀌었다는 신호(`useLiveServerRefresh`)가 오면 서버 렌더를 다시 받는다.
 * 핀은 `data-testid="db-map-pin"` · `data-row-id` · 말풍선의 제목은 `db-map-popup-open`(누르면 뷰의 열기 방식으로 행을 연다).
 */

import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { MAP_ATTRIBUTION, pinBounds, type MapPin } from '@/lib/database/map'
import { rowOpenHref } from '@/lib/database/open-pages'
import { useLiveServerRefresh } from './use-table-changes'

const UNTITLED = '제목 없음'
const PIN_SVG =
  '<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true" focusable="false">' +
  '<path d="M14 1C7 1 1.5 6.5 1.5 13.4C1.5 22.5 14 35 14 35S26.5 22.5 26.5 13.4C26.5 6.5 21 1 14 1Z" fill="#2563eb" stroke="#1e3a8a" stroke-width="1.5"/>' +
  '<circle cx="14" cy="13.5" r="4.5" fill="#fff"/></svg>'

export function DatabaseMap({
  workspaceId,
  dataSourceId,
  renderedAt,
  pins,
  height,
  tileUrl,
  peekBase,
}: {
  workspaceId: string
  dataSourceId: string
  renderedAt: number
  pins: readonly MapPin[]
  /** 지도 칸의 높이(px). */
  height: number
  /** 타일 주소(`{z}/{x}/{y}`) — null 이면 타일 없이 핀만. */
  tileUrl: string | null
  /** 행을 여는 주소의 바탕 — null 이면 전체 페이지(`rowOpenHref`). */
  peekBase: string | null
}) {
  useLiveServerRefresh(workspaceId, dataSourceId, false, renderedAt)
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  })
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (el === null) return
    const map = L.map(el, { worldCopyJump: true, attributionControl: tileUrl !== null })
    if (tileUrl !== null) {
      L.tileLayer(tileUrl, { attribution: MAP_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    }
    // 처음 보기를 먼저 정한다 — 보기가 없는 지도는 마커를 달지 않고 미뤄 둔다(`getElement()` 가 비어 있다)
    const bounds = pinBounds(pins)
    if (bounds === null) map.setView([20, 0], 2)
    else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    for (const pin of pins) {
      const icon = L.divIcon({ className: 'db-map-pin-icon', html: PIN_SVG, iconSize: [28, 36], iconAnchor: [14, 35], popupAnchor: [0, -32] })
      const marker = L.marker([pin.lat, pin.lng], { icon, title: pin.name, keyboard: true }).addTo(map)
      const root = marker.getElement()
      if (root) {
        root.setAttribute('data-testid', 'db-map-pin')
        root.setAttribute('data-row-id', pin.rowId)
      }
      // 말풍선 — 글자는 DOM 으로 넣는다(HTML 글로 만들지 않는다)
      const body = document.createElement('div')
      const href = rowOpenHref(workspaceId, pin.rowId, peekBase)
      const open = document.createElement('a')
      open.href = href
      open.textContent = pin.title === '' ? UNTITLED : pin.title
      open.setAttribute('data-testid', 'db-map-popup-open')
      open.style.fontWeight = '600'
      open.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        routerRef.current.push(href, { scroll: false })
      })
      body.appendChild(open)
      const place = document.createElement('div')
      place.textContent = pin.address === '' ? pin.name : `${pin.name} (${pin.address})`
      place.style.fontSize = '12px'
      place.style.opacity = '0.7'
      body.appendChild(place)
      marker.bindPopup(body)
    }
    return () => {
      map.remove()
    }
  }, [pins, tileUrl, workspaceId, peekBase])

  return (
    <div
      ref={host}
      data-testid="db-map"
      data-pin-count={pins.length}
      data-tiles={tileUrl === null ? 'off' : 'on'}
      style={{ height }}
      className="relative z-0 w-full overflow-hidden rounded border border-neutral-200 dark:border-neutral-700"
    />
  )
}
