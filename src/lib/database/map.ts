/**
 * 지도 뷰의 레이아웃 · 핀 (MP-2 · F-04-19 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 MP-1] ⑥ · 04-database-views.md F-04-19
 *
 * `view.configuration.map = { map_by, height }` — 둘 다 늘 쓴다(명령이 지금 값 위에 합쳐서 쓴다 · 다른 뷰 종류의 키와 섞이지 않는다).
 * 모양은 CHECK(`ck_view_map_layout` · 0142)이 막는다.
 *
 *   map_by  이 데이터베이스의 장소 속성 id — null 이면 첫 장소 속성
 *   height  지도 칸의 높이(px) · 240~960 정수 · 기본 480
 */

import type { ValidationIssue } from '../contracts/rich-text.ts'
import { readPlace } from './place.ts'

export const MAP_HEIGHT_MIN = 240
export const MAP_HEIGHT_MAX = 960
/** 핀의 상한(정본 ⑥ — 노션의 상한). */
export const MAX_MAP_PINS = 100

/** 화면이 고르게 하는 높이 셋. */
export const MAP_HEIGHT_CHOICES = [
  { value: 320, label: '작게' },
  { value: 480, label: '보통' },
  { value: 720, label: '크게' },
] as const

export type MapLayout = {
  readonly map_by: string | null
  readonly height: number
}

export const DEFAULT_MAP_LAYOUT: MapLayout = { map_by: null, height: 480 }

const isHeight = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MAP_HEIGHT_MIN && v <= MAP_HEIGHT_MAX

/** 저장된 `configuration` 에서 지도 레이아웃을 읽는다 — 없거나 모르는 값이면 기본값(읽기 경로는 너그럽다). */
export function readMapLayout(configuration: unknown): MapLayout {
  const c = (configuration as { map?: unknown } | null | undefined)?.map as Record<string, unknown> | undefined
  if (typeof c !== 'object' || c === null) return DEFAULT_MAP_LAYOUT
  return {
    map_by: typeof c.map_by === 'string' && c.map_by !== '' ? c.map_by : null,
    height: isHeight(c.height) ? c.height : DEFAULT_MAP_LAYOUT.height,
  }
}

/** 바꾸려는 키만 보낸다(부분) — 모르는 키 · 모르는 값은 거부한다. 빈 객체도 거부한다(바꿀 것이 없다). 장소 속성인지는 명령이 따로 본다. */
export function validateMapPatch(raw: unknown): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [{ path: 'map', message: '객체여야 합니다' }]
  const c = raw as Record<string, unknown>
  const keys = Object.keys(c)
  if (keys.length === 0) return [{ path: 'map', message: '바꿀 것이 없습니다' }]
  const issues: ValidationIssue[] = []
  for (const key of keys) {
    if (key === 'map_by') {
      if (c.map_by !== null && (typeof c.map_by !== 'string' || c.map_by === '')) {
        issues.push({ path: 'map.map_by', message: '속성 id 또는 null 이어야 합니다' })
      }
    } else if (key === 'height') {
      if (!isHeight(c.height)) issues.push({ path: 'map.height', message: `${MAP_HEIGHT_MIN}~${MAP_HEIGHT_MAX} 사이의 정수여야 합니다` })
    } else {
      issues.push({ path: `map.${key}`, message: '모르는 키입니다' })
    }
  }
  return issues
}

/** 지금 레이아웃 위에 바꾸려는 키만 얹는다. `validateMapPatch` 를 지난 값만. */
export function mergeMapLayout(current: MapLayout, patch: Partial<MapLayout>): MapLayout {
  return {
    map_by: patch.map_by === undefined ? current.map_by : patch.map_by,
    height: patch.height ?? current.height,
  }
}

/**
 * 실제로 쓸 장소 속성 — 저장된 `map_by` 가 살아 있는 장소 속성이면 그것, 아니면(null · 지워졌다 · 타입을 바꿨다) 첫 장소 속성. 하나도 없으면 null.
 * `placeIds` 는 이 뷰 컬럼 순서의 장소 속성 id.
 */
export function resolveMapBy(stored: string | null, placeIds: readonly string[]): string | null {
  if (stored !== null && placeIds.includes(stored)) return stored
  return placeIds[0] ?? null
}

export type MapPin = {
  readonly rowId: string
  readonly title: string
  readonly name: string
  readonly address: string
  readonly lat: number
  readonly lng: number
}

/**
 * 행 → 핀. 칸이 비었거나 모양이 틀린 값(이름이 없다 · 좌표가 범위 밖이다)인 행은 건너뛴다. 처음 `MAX_MAP_PINS` 개까지만 — 넘치면 `truncated`.
 * (질의가 이미 "값이 있는 행"으로 100개를 끊어 오지만, 모양이 틀린 값이 섞여 와도 안전하게 한 번 더 거른다.)
 */
export function selectPins(
  rows: readonly { readonly id: string; readonly title: string; readonly properties: Readonly<Record<string, unknown>> }[],
  mapBy: string,
  more = false,
): { pins: MapPin[]; truncated: boolean } {
  const pins: MapPin[] = []
  let truncated = more
  for (const row of rows) {
    const place = readPlace(row.properties[mapBy])
    if (place === null) continue
    if (pins.length >= MAX_MAP_PINS) {
      truncated = true
      break
    }
    pins.push({ rowId: row.id, title: row.title, name: place.name, address: place.address, lat: place.lat, lng: place.lng })
  }
  return { pins, truncated }
}

/** 핀을 모두 담는 범위 `[[남, 서], [북, 동]]` — 핀이 없으면 null(세계 보기). */
export function pinBounds(pins: readonly { readonly lat: number; readonly lng: number }[]): [[number, number], [number, number]] | null {
  if (pins.length === 0) return null
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const p of pins) {
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lng)
    east = Math.max(east, p.lng)
  }
  return [
    [south, west],
    [north, east],
  ]
}

/** 타일 주소의 기본값(정본 ⑥) — 출처 표시는 늘 단다. */
export const DEFAULT_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors'

/** `MAP_TILE_URL` → 타일 주소. 비었으면 기본 · `off` 면 null(타일 없이 핀만). */
export function mapTileUrl(env: string | undefined): string | null {
  const value = (env ?? '').trim()
  if (value.toLowerCase() === 'off') return null
  return value === '' ? DEFAULT_MAP_TILE_URL : value
}
