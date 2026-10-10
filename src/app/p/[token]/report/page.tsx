/**
 * /p/[token]/report — 공개 페이지 신고 화면 (게시 · 공유 6b-1b · F-17-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 페이지 신고 ②⑧ · [보강] 공개 화면 ⑥⑧
 *
 *   ?page=<id>   하위 페이지를 신고할 때(없으면 게시 루트)
 *   ?sent=1      접수됐다
 *   ?error=<까닭> 실패 — 사유 · 길이 · 너무 잦음 · 출처
 *
 * 신고할 페이지는 공개 화면과 같은 판정으로 연다 — 열 수 없으면 404(신고할 길이 없다 · 이유를 말하지 않는다). 스크립트 없이 도는 폼이고
 * 세션을 읽지 않는다. 색인하지 않는다.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { isUuid } from '@/lib/ids'
import { MAX_REPORT_DETAIL } from '@/lib/moderation/report'
import { titleText } from '../../public-blocks'
import { loadPublicPage } from '../../public-page'
import { DMCA_NOTE, REPORT_REASON_OPTIONS, reportFailureMessage } from '../../report-messages'

/**
 * referrer 는 `same-origin` 이다(공개 화면의 `no-referrer` 와 다르다) — `no-referrer` 면 브라우저가 같은 출처의 폼 POST 에도
 * `Origin: null` 을 보내(Fetch 규격) 보내는 곳의 출처 검사가 막는다(e2e 가 잡았다). 이 화면에서 나가는 링크는 같은 출처뿐이라 토큰이
 * 밖으로 새지 않는다.
 */
export const metadata: Metadata = { title: '페이지 신고', robots: 'noindex, nofollow', referrer: 'same-origin' }

export default async function ReportPage({ params, searchParams }: PageProps<'/p/[token]/report'>) {
  const { token } = await params
  const query = await searchParams
  const raw = typeof query.page === 'string' ? query.page : undefined
  const pageId = raw !== undefined && isUuid(raw) ? raw : undefined
  if (raw !== undefined && pageId === undefined) notFound()

  const read = await loadPublicPage(token, pageId)
  if (!read.ok) notFound()
  const view = read.value
  const backHref = pageId === undefined ? `/p/${token}` : `/p/${token}/${pageId}`
  const sent = query.sent === '1'
  const error = reportFailureMessage(query.error)

  return (
    <main className="pub-page" data-testid="public-report">
      <p className="pub-note">
        <a href={backHref}>← {titleText(view.title)}</a>
      </p>
      <h1 className="pub-title">페이지 신고</h1>
      {sent ? (
        <div role="status" data-testid="public-report-sent">
          <p>신고가 접수되었습니다. 운영자가 검토합니다.</p>
          <p className="pub-note">검토 결과는 따로 알리지 않습니다.</p>
        </div>
      ) : (
        <form method="post" action={`/p/${token}/report/submit`} className="pub-report-form" data-testid="public-report-form">
          {pageId !== undefined && <input type="hidden" name="page" value={pageId} />}
          <fieldset>
            <legend>무엇이 문제인가요?</legend>
            {REPORT_REASON_OPTIONS.map((option) => (
              <label key={option.value} className="pub-report-reason">
                <input type="radio" name="reason" value={option.value} required data-testid={`public-report-reason-${option.value}`} />
                <span>
                  <strong>{option.label}</strong> <span className="pub-note">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="pub-note" data-testid="public-report-dmca">{DMCA_NOTE}</p>
          <label className="pub-report-detail">
            <span>자세한 설명(선택)</span>
            <textarea name="detail" maxLength={MAX_REPORT_DETAIL} rows={5} data-testid="public-report-detail" />
          </label>
          {/* 사람에게는 보이지 않는 칸 — 채워져 오면 봇이다(F-17-10) */}
          <div className="pub-report-trap" aria-hidden="true">
            <label>
              웹사이트
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          {error !== null && (
            <p role="alert" className="pub-report-error" data-testid="public-report-error">
              {error}
            </p>
          )}
          <button type="submit" data-testid="public-report-submit">
            신고하기
          </button>
        </form>
      )}
    </main>
  )
}
