/**
 * 공개 화면의 임베드 — F-09-10 (44번 트랙 EM-1 · 정본 §3.4 [보강 EM-1] ③ ⑤)
 *
 * 편집기와 같은 규칙 · 같은 격리다(`embedPlanOf`). 자기 출처는 **이 요청의 호스트**와 견준다(`host` · 프록시 뒤라면 `x-forwarded-host` ·
 * 설정한 공개 주소). 알려진 서비스는 서버가 iframe 을 그리고, 일반 주소는 눌러야 불러온다(`PublicEmbedFacade` — 눌러야 하므로 클라이언트).
 */

import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import { readCaption } from '@/lib/block/image'
import { readEmbedHeight, readEmbedUrl } from '@/lib/block/embed-block'
import { EMBED_ALLOW, EMBED_REFERRER_POLICY, EMBED_SANDBOX, embedPlanOf, embedStageHeight, ownHostsOf } from '@/lib/block/embed-source'
import { PublicEmbedFacade } from './public-embed-facade'

const FOREIGN_REL = 'noopener noreferrer nofollow ugc'

export async function PublicEmbed({ properties }: { properties: Record<string, unknown> }): Promise<ReactNode> {
  const url = readEmbedUrl(properties)
  if (url === null) return null
  const caption = readCaption(properties).trim()
  const requestHeaders = await headers()
  const own = ownHostsOf([requestHeaders.get('host'), requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim(), process.env.NEXT_PUBLIC_APP_URL])
  const plan = embedPlanOf(url, own)
  // 저장된 높이(EM-3) — 정한 높이 모양만 따른다(동영상은 비율)
  const stored = readEmbedHeight(properties)

  let body: ReactNode
  if (plan.kind === 'refused') {
    body = (
      <div className="pub-embed-refused" data-testid="public-embed-refused">
        <p>{plan.reason}</p>
        <a href={url} target="_blank" rel={FOREIGN_REL}>
          {url}
        </a>
      </div>
    )
  } else if (plan.kind === 'generic') {
    body = <PublicEmbedFacade src={plan.src} label={plan.label} height={embedStageHeight(plan, stored) ?? plan.height} />
  } else {
    body = (
      <div className="pub-embed-stage" style={plan.aspect !== undefined ? { aspectRatio: String(plan.aspect) } : { height: embedStageHeight(plan, stored) ?? undefined }}>
        <iframe
          className="pub-embed-iframe"
          data-testid="public-embed-frame"
          title={plan.label}
          src={plan.src}
          sandbox={EMBED_SANDBOX}
          allow={EMBED_ALLOW}
          referrerPolicy={EMBED_REFERRER_POLICY}
          loading="lazy"
        />
      </div>
    )
  }

  return (
    <figure className="pub-block pub-embed" data-testid="public-embed" data-kind={plan.kind}>
      {body}
      {plan.kind !== 'refused' && (
        <p className="pub-embed-meta">
          <span>{plan.label}</span>
          <a href={url} target="_blank" rel={FOREIGN_REL}>
            원래 주소 열기
          </a>
        </p>
      )}
      {caption !== '' && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
