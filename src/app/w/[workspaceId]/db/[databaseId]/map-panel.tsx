'use client'

/**
 * 지도 패널의 내용 (MP-2) — 도구줄(데이터베이스 화면에 늘 실린다)에서 "지도" 단추를 누를 때에야 읽는 조각이다(`next/dynamic` · 번들 예산).
 * "지도 기준"(이 표의 장소 속성) · "높이"(작게 · 보통 · 크게). 고르는 즉시 저장하고 서버 렌더를 다시 받는다 — PATCH 뷰의 `map` 그대로.
 */

import { MAP_HEIGHT_CHOICES, type MapLayout } from '@/lib/database/map'
import type { ViewColumn } from '@/lib/database/view-columns'
import { FIELD, Popover } from './group-controls'

export default function MapPanel({
  columns,
  layout,
  effectiveMapBy,
  locked,
  onSave,
  onClose,
}: {
  columns: ViewColumn[]
  layout: MapLayout
  /** 지금 지도가 실제로 쓰는 장소 속성(저장된 것이 없거나 지워졌으면 첫 장소 속성). */
  effectiveMapBy: string | null
  locked: boolean
  onSave: (patch: Partial<MapLayout>) => Promise<boolean>
  onClose: () => void
}) {
  const places = columns.filter((c) => c.type === 'place')
  // 화면이 고르게 하는 높이가 아닌 값(API 로 넣은 240~960)이면 그 값을 한 줄 더 보인다
  const custom = MAP_HEIGHT_CHOICES.some((h) => h.value === layout.height) ? null : layout.height
  return (
    <Popover label="지도" testId="db-map-panel" onClose={onClose}>
      <label className="flex items-center gap-2 text-sm">
        지도 기준
        <select
          aria-label="지도에 놓을 장소 속성"
          data-testid="db-map-by-select"
          value={effectiveMapBy ?? ''}
          disabled={locked || places.length === 0}
          onChange={(e) => {
            if (e.target.value !== '') void onSave({ map_by: e.target.value })
          }}
          className={FIELD}
        >
          {effectiveMapBy === null && <option value="">장소 속성 없음</option>}
          {places.map((c) => (
            <option key={c.propertyId} value={c.propertyId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        높이
        <select
          aria-label="지도의 높이"
          data-testid="db-map-height-select"
          value={layout.height}
          disabled={locked}
          onChange={(e) => void onSave({ height: Number(e.target.value) })}
          className={FIELD}
        >
          {custom !== null && <option value={custom}>{custom}px</option>}
          {MAP_HEIGHT_CHOICES.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label} · {h.value}
            </option>
          ))}
        </select>
      </label>
    </Popover>
  )
}
