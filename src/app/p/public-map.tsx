'use client'

/**
 * 공개 지도 — MP-3 (F-06-08 · F-04-19)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 MP-1] ⑦
 *
 * 서버가 낸 핀(공개 경로의 자기 질의 — 공개로 열리는 행 · 공유 필터 · 처음 100개)을 Leaflet 으로 그린다. 이 파일은 `public-map-lazy.tsx` 로만
 * 불러온다 — Leaflet 은 지도를 그릴 때만 받는다(`check:bundle` 예산). 앱의 `database-map.tsx` 와 달리 상태 · 세션 · 라이브 갱신이 없다.
 * 말풍선은 이름(과 행 제목)이고, 행으로 가는 링크는 서버가 만든 공개 주소다(`href`). 글자는 DOM 으로 넣는다(HTML 글로 만들지 않는다).
 * 타일(`tileUrl`)은 서버가 환경 변수에서 읽어 넘긴다 — null 이면 타일 없이 핀만(출처 표시도 타일과 함께만 선다).
 * 핀은 `data-testid="public-map-pin"` · `data-row-id` · 말풍선의 링크는 `public-map-popup-open`.
 */

import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { useEffect, useRef } from 'react'

import { MAP_ATTRIBUTION, pinBounds } from '@/lib/database/map'

export type PublicMapViewPin = {
  readonly rowId: string
  readonly title: string
  readonly name: string
  readonly lat: number
  readonly lng: number
  /** 그 행의 공개 주소. */
  readonly href: string
}

const UNTITLED = '제목 없음'
const PIN_SVG =
  '<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true" focusable="false">' +
  '<path d="M14 1C7 1 1.5 6.5 1.5 13.4C1.5 22.5 14 35 14 35S26.5 22.5 26.5 13.4C26.5 6.5 21 1 14 1Z" fill="#2563eb" stroke="#1e3a8a" stroke-width="1.5"/>' +
  '<circle cx="14" cy="13.5" r="4.5" fill="#fff"/></svg>'

export function PublicMap({ pins, height, tileUrl }: { pins: readonly PublicMapViewPin[]; height: number; tileUrl: string | null }) {
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
      const icon = L.divIcon({ className: 'pub-map-pin-icon', html: PIN_SVG, iconSize: [28, 36], iconAnchor: [14, 35], popupAnchor: [0, -32] })
      const marker = L.marker([pin.lat, pin.lng], { icon, title: pin.name, keyboard: true }).addTo(map)
      const root = marker.getElement()
      if (root) {
        root.setAttribute('data-testid', 'public-map-pin')
        root.setAttribute('data-row-id', pin.rowId)
      }
      const body = document.createElement('div')
      const place = document.createElement('div')
      place.textContent = pin.name
      place.style.fontWeight = '600'
      body.appendChild(place)
      const open = document.createElement('a')
      open.href = pin.href
      open.textContent = pin.title === '' ? UNTITLED : pin.title
      open.setAttribute('data-testid', 'public-map-popup-open')
      open.style.fontSize = '12px'
      body.appendChild(open)
      marker.bindPopup(body)
    }
    return () => {
      map.remove()
    }
  }, [pins, tileUrl])

  return (
    <div
      ref={host}
      data-testid="public-map"
      data-pin-count={pins.length}
      data-tiles={tileUrl === null ? 'off' : 'on'}
      style={{ height }}
      className="pub-map"
    />
  )
}
