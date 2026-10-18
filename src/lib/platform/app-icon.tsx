/**
 * 앱 아이콘의 그림 — 플랫폼 잔여 10m-3 (F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑩ⓐ)
 *
 * `app/icon.tsx`(192 · 512 — 매니페스트 · 탭) 와 `app/apple-icon.tsx`(180 — iOS 홈 화면)가 함께 그린다. **가장자리까지 채운** 정사각형이다 —
 * 운영체제가 자기 모양(둥근 사각형 · 원)으로 자르므로 모서리를 그리지 않는다. 글자는 가운데 지름 80% 의 안전 구역 안(높이 52%)이라 maskable
 * 로 잘려도 남는다.
 */
import { ImageResponse } from 'next/og'

export function appIcon(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#171717',
          color: '#ffffff',
          fontSize: Math.round(size * 0.52),
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        N
      </div>
    ),
    { width: size, height: size },
  )
}
