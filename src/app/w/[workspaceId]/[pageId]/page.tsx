/**
 * 페이지 화면 — `/w/{workspaceId}/{pageId}`
 *
 * 경로 · 머리 단추 · 아이콘 · 제목 · 백링크 · 본문(협업 편집기) · 하위 페이지 목록.
 *
 * **데이터베이스 행도 여기서 연다**(8f-1 · F-16-07) — 행은 페이지다(C-3). 다른 것은 셋이다:
 *   · 경로는 조상 대신 그 행의 데이터베이스(`rowTrail`)
 *   · 제목의 정본은 제목 **셀**이다(`RowTitle` — `renamePage` 는 행을 거부한다)
 *   · 본문 위에 **속성 묶음** — 스키마 순서의 모든 속성을 세로로(`DatabaseTable variant="record"` — 템플릿 화면과 같은 모양 · 같은 함수).
 *     모듈 배치(어떤 속성을 어디에)는 데이터 소스의 것이고 본문은 행의 것이다(F-16-07). 숨기기 · 순서는 레이아웃(8f-2)
 * 행에 맞지 않는 머리 단추(공유 · 옮기기 · 내보내기 · 복제)는 세우지 않는다 — 행의 권한 · 자리는 데이터베이스가 정한다(§7).
 *
 * 몸(`PageContent`)은 데이터베이스 화면의 피크(8n-1 · F-02-20)와 함께 쓴다 — 여기는 세션 · 워크스페이스 밖의 사람 · id 해석만 한다.
 */

import { notFound } from 'next/navigation'

import { asBlockId } from '@/lib/ids'
import { requirePageVisitor } from '@/lib/auth/page-session'
import { outsiderNoAccessState } from '@/lib/permissions/access-request'
import { feedClock } from '@/lib/database/row-feed'
import { NoAccess } from './no-access'
import { PageContent } from './page-content'

export default async function PageView({ params, searchParams }: PageProps<'/w/[workspaceId]/[pageId]'>) {
  const { workspaceId, pageId: rawPageId } = await params
  // 읽기 전의 시각 — 행 페이지의 속성 묶음이 구독할 때 들고 가 그 사이의 레이아웃 변경을 메운다(#250)
  const renderedAt = feedClock()
  // 인박스의 접근 요청 줄은 공유 패널을 연 채로 온다(`?share=1` · 7e-1).
  const { share } = await searchParams

  const visitor = await requirePageVisitor(workspaceId)

  let pageId
  try {
    pageId = asBlockId(rawPageId)
  } catch {
    notFound()
  }

  // 워크스페이스 밖의 사람(7g-2) — 요청할 수 있는 페이지면(정책이 허락하고 · 살아 있는 페이지) 요청 화면, 아니면 404. 그 사람에게는
  // 이 워크스페이스의 아무것도 읽지 않는다(정본 §3.3 [보강] 접근 요청 ⑩ (b)).
  if ('outsider' in visitor) {
    const outsiderState = await outsiderNoAccessState(visitor.outsider, pageId)
    if (outsiderState === null) notFound()
    return <NoAccess workspaceId={workspaceId} pageId={pageId} requested={outsiderState.requested} outsider />
  }
  // 몸은 데이터베이스 화면의 피크와 함께 쓴다(8n-1 · `page-content.tsx`)
  return <PageContent ctx={visitor.member} workspaceId={workspaceId} pageId={pageId} shareOpen={share === '1'} renderedAt={renderedAt} frame="page" />
}
