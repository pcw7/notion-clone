'use client'

/**
 * 공개 화면의 일반 주소 임베드 — 눌러야 불러온다 (F-09-10 · 정본 §3.4 [보강 EM-1] ③)
 *
 * 처음에는 호스트와 "불러오기"만 있고 iframe 이 없다 — 남의 아무 주소가 보는 사람의 브라우저에서 저절로 열리지 않는다.
 */

import { useState, type ReactNode } from 'react'

import { EMBED_ALLOW, EMBED_REFERRER_POLICY, EMBED_SANDBOX } from '@/lib/block/embed-attrs'

export function PublicEmbedFacade({ src, label, height }: { src: string; label: string; height: number }): ReactNode {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="pub-embed-stage" style={{ height }}>
      {loaded ? (
        <iframe
          className="pub-embed-iframe"
          data-testid="public-embed-frame"
          title={label}
          src={src}
          sandbox={EMBED_SANDBOX}
          allow={EMBED_ALLOW}
          referrerPolicy={EMBED_REFERRER_POLICY}
          loading="lazy"
        />
      ) : (
        <div className="pub-embed-facade" data-testid="public-embed-facade">
          <span className="pub-embed-facade-host">{label}</span>
          <span className="pub-embed-facade-note">이 사이트의 화면을 이 페이지 안에 불러옵니다.</span>
          <button type="button" className="pub-embed-load" data-testid="public-embed-load" onClick={() => setLoaded(true)}>
            불러오기
          </button>
        </div>
      )}
    </div>
  )
}
