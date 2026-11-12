/**
 * 장소 속성의 순수한 부분 (MP-1 · 정본 §3.5 [보강 MP-1] ① ② ⑤) — 좌표 글 읽기 · Nominatim 답 거르기 · 글로 그리기.
 *
 * 서버(찾기 길)와 브라우저(칸 편집기)가 같이 쓴다 — 던지지 않고 DB 도 네트워크도 모른다.
 */

import { PLACE_ADDRESS_MAX, PLACE_NAME_MAX, type PlaceRef } from './property-types.ts'

/** 찾기 결과의 최대 수(정본 ②). */
export const PLACE_SEARCH_LIMIT = 5
/** 찾기 글의 최대 길이 — 넘으면 외부에 묻지 않는다. */
export const PLACE_QUERY_MAX = 200

/** `이름 (주소)` — 주소가 없으면 이름. CSV · 행 Markdown · 공개 화면의 글(공개는 이름만 쓴다). */
export function placeText(place: PlaceRef): string {
  return place.address === '' ? place.name : `${place.name} (${place.address})`
}

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`
/** `37.5665, 126.978` — 쉼표 또는 공백으로 가른 두 수. */
const COORDINATES = new RegExp(`^(${NUMBER})\\s*(?:,|\\s)\\s*(${NUMBER})$`)

/** 위도 · 경도가 범위 안의 유한한 수인가. */
export function validLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/**
 * 좌표로 쓴 글을 장소로 — 외부에 묻지 않는다(정본 ②). 이름은 쓴 글 그대로 · 주소는 빈 글. 좌표가 아니거나 범위 밖이면 null.
 */
export function parseCoordinates(input: string): PlaceRef | null {
  const text = input.trim()
  const m = COORDINATES.exec(text)
  if (m === null) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (!validLatLng(lat, lng)) return null
  return { name: text.replace(/\s+/g, ' '), address: '', lat, lng }
}

/** 찾기 글 — 앞뒤 공백을 걷는다. 비었거나 너무 길면 null. */
export function normalizePlaceQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/\s+/g, ' ').trim()
  return text.length === 0 || text.length > PLACE_QUERY_MAX ? null : text
}

/** `a, b, c` 의 첫 조각. */
const firstPart = (displayName: string): string => displayName.split(',')[0]?.trim() ?? ''

/**
 * Nominatim(`format=jsonv2`) 의 답 → 장소 목록. 모양이 틀린 줄(좌표가 수가 아니다 · 범위 밖 · 이름을 만들 수 없다)은 **버린다** — 한 줄이 틀렸다고
 * 나머지를 막지 않는다. 이름은 `name`(없으면 `display_name` 의 첫 조각) · 주소는 `display_name` — 상한에서 자른다. 최대 5개.
 */
export function mapNominatim(body: unknown): PlaceRef[] {
  if (!Array.isArray(body)) return []
  const out: PlaceRef[] = []
  for (const item of body) {
    if (out.length >= PLACE_SEARCH_LIMIT) break
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const lat = typeof row.lat === 'string' || typeof row.lat === 'number' ? Number(row.lat) : Number.NaN
    const lng = typeof row.lon === 'string' || typeof row.lon === 'number' ? Number(row.lon) : Number.NaN
    if (!validLatLng(lat, lng)) continue
    const display = typeof row.display_name === 'string' ? row.display_name.trim() : ''
    const named = typeof row.name === 'string' ? row.name.trim() : ''
    const name = (named !== '' ? named : firstPart(display)).slice(0, PLACE_NAME_MAX)
    if (name === '') continue
    out.push({ name, address: display.slice(0, PLACE_ADDRESS_MAX), lat, lng })
  }
  return out
}

/** `PLACE_SEARCH_URL` → 찾기를 묻는 기준 주소. 비었으면 기본 · `off` 면 null(찾기를 끈다). */
export const DEFAULT_PLACE_SEARCH_URL = 'https://nominatim.openstreetmap.org'
export function placeSearchBase(env: string | undefined): string | null {
  const value = (env ?? '').trim()
  if (value.toLowerCase() === 'off') return null
  return (value === '' ? DEFAULT_PLACE_SEARCH_URL : value).replace(/\/+$/, '')
}

/** 기준 주소 + 글 → Nominatim 호환 `/search` 주소(정본 ②). */
export function placeSearchUrl(base: string, query: string): string {
  const params = new URLSearchParams({ format: 'jsonv2', limit: String(PLACE_SEARCH_LIMIT), q: query, 'accept-language': 'ko' })
  return `${base}/search?${params.toString()}`
}

/** 칸의 저장 값(`{type:'place', place}`)에서 장소를 읽는다 — 모양이 아니면 null(읽기 경로는 던지지 않는다). */
export function readPlace(raw: unknown): PlaceRef | null {
  if (typeof raw !== 'object' || raw === null) return null
  const place = (raw as { place?: unknown }).place
  if (typeof place !== 'object' || place === null) return null
  const p = place as Record<string, unknown>
  if (typeof p.name !== 'string' || p.name === '') return null
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || !validLatLng(p.lat, p.lng)) return null
  return { name: p.name, address: typeof p.address === 'string' ? p.address : '', lat: p.lat, lng: p.lng }
}
