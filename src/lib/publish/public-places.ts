/**
 * 공개 표의 장소 칸 — 이름만 싣는다 (MP-1 · 정본 §3.5 [보강 MP-1] ⑤)
 *
 * 주소 · 좌표는 공개 재료에 싣지 않는다(공개 화면의 지도는 MP-3 에서 따로 연다). 화면이 이름만 그려도 재료에 좌표가 있으면 새는 것이므로
 * 여기서 고른다(`public-places.test.ts`).
 */

export type PublicPlaceValue = { readonly type: 'place'; readonly place: { readonly name: string } }

export function publicPlaceValue(value: unknown): PublicPlaceValue {
  const place = (value as { place?: unknown } | null)?.place
  const name = (place as { name?: unknown } | null)?.name
  return { type: 'place', place: { name: typeof name === 'string' ? name : '' } }
}
