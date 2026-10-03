'use client'

/**
 * 이미지 아이콘의 표시 — `PageIconView` 가 아이콘이 이미지일 때 그리는 것 (잔여 묶음 8c-4 · F-02-05)
 *
 * 클라이언트 부품인 까닭은 둘이다.
 *   · 올린 파일의 주소는 워크스페이스를 알아야 만든다(`/api/workspaces/{ws}/files/{id}/content` — 이미지 블록과 같은 경로 · 서명 URL 을
 *     저장하지 않는다). 아이콘을 그리는 곳은 모두 `/w/[workspaceId]` 아래라 **경로에서 읽는다**(`useParams`) — `PageIconView` 를 부르는
 *     스무 곳 넘게가 워크스페이스를 넘기지 않아도 되고, 서버 화면(목록)도 그대로 쓴다(이 부품이 클라이언트 경계다)
 *   · 불러오지 못하면(외부 주소가 죽었다 · 파일이 없다) 깨진 그림 대신 `fallback`(기본 글리프 또는 없음)으로 바꾼다. `onError` 로는
 *     모자란다 — 서버가 그린 화면(머리 · 목록)의 `img` 는 **하이드레이션 전에** 실패할 수 있고, 그때의 `error` 이벤트는 React 가 듣기
 *     전에 지나간다(e2e 의 첫 판이 잡았다 — 사이드바는 바뀌고 머리는 깨진 그림으로 남았다). 그래서 붙은 뒤에 `decode()` 로 묻는다 —
 *     이미 실패한 그림이면 곧바로, 아직 불러오는 중이면 끝난 뒤에 거절된다. `onError` 가 잡는 경우를 모두 덮으므로 둘을 함께 두지 않는다
 *
 * 외부 주소는 `referrerPolicy="no-referrer"` — 사이드바 · 목록은 아이콘을 보는 모든 사람의 브라우저가 그 주소를 부른다. 어느 페이지에서
 * 불렀는지(우리 주소)를 남의 서버에 알리지 않는다. 읽는 이에게는 숨긴다(이름이 링크의 이름이다 — 이모지와 같다).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'next/navigation'

import { pageIconKey, pageIconSrc, type ImageIcon } from '@/lib/block/page-icon'

export function PageIconImage({
  icon,
  className = '',
  fallback = null,
}: {
  icon: ImageIcon
  className?: string
  /** 불러오지 못했을 때 그릴 것 — 기본 글리프(페이지로 가는 줄) 또는 없음(글자 속의 경로). */
  fallback?: ReactNode
}) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : null
  const src = pageIconSrc(icon, workspaceId)
  // 실패한 주소를 기억한다 — 아이콘이 바뀌면(다른 주소) 다시 불러 본다.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    const img = imgRef.current
    if (img === null || src === null) return
    let alive = true
    img.decode().catch(() => {
      if (alive && imgRef.current === img) setFailedSrc(src)
    })
    return () => {
      alive = false
    }
  }, [src])
  if (src === null || failedSrc === src) return <>{fallback}</>
  // `next/image` 를 쓰지 않는다 — 사용자가 고른 아이콘이다(세션으로 인증되는 우리 경로 · 아무 외부 주소). 최적화 경로를 거치면 세션
  // 인증과 외부 도메인 허용 목록이 엉킨다. 이미지 블록(`image-view.ts`)도 `img` 를 그대로 쓴다.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt=""
      aria-hidden
      data-page-icon={pageIconKey(icon)}
      draggable={false}
      referrerPolicy="no-referrer"
      className={`inline-block h-[1em] w-[1em] flex-none rounded-[0.15em] object-cover ${className}`}
    />
  )
}
