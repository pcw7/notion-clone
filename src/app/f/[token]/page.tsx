/**
 * /f/[token] — 공개 폼 (인접 제품 7a-2b · F-13-02 · F-17-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑥⑦
 *
 * 웹 공개 폼은 세션을 읽지 않는다 — 판정은 `readPublicForm` 하나(열 수 없으면 404 · 이유를 말하지 않는다). 화면을 줄 때마다 새 제출
 * 토큰을 싣는다(서명 — DB 에 쓰지 않는다). 칸 · 제출 · 확인 화면은 `PublicFormView`(브라우저)가 그린다.
 *
 * 워크스페이스 멤버만의 폼(7b-1 · 정본 ⑨)은 로그인 세션을 묻는다(`resolveFormRespondent`) — 로그인하지 않았으면 로그인으로 가는 길만
 * (제목 · 설명도 싣지 않는다 · 메타데이터의 제목도), 그 워크스페이스의 멤버가 아니면 404, 멤버면 폼 + 응답자 줄.
 *
 * 응답을 마감한 폼(7b-2 — 상한 · 마감 시각 · 정본 ⑩)은 그 폼을 볼 수 있는 사람에게 제목과 "마감했습니다" 만 — 404 가 아니다.
 *
 * 한 사람당 한 번인 폼(7b-3 · 정본 ⑪)에 이미 낸 멤버에게는 제목과 "이미 응답했습니다" 만(마감이 먼저) · 받은 뒤의 확인 화면에 "다른 응답
 * 제출" 이 없다. 웹 공개 폼은 켜 두어도 그대로다(응답자를 모른다).
 *
 * referrer 는 `same-origin` — `no-referrer` 면 브라우저가 같은 출처의 POST 에도 `Origin: null` 을 보내 제출의 출처 검사가 막는다
 * (신고 화면에서 e2e 가 잡은 것과 같다).
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { readSessionToken } from '@/lib/auth/session-cookie'
import { publicTitle } from '@/lib/nav/screen-title'
import { alreadyResponded, issueSubmissionToken, readPublicForm, resolveFormRespondent } from '@/lib/database/form-submit'
import { ALREADY_RESPONDED, FORM_CLOSED, WORKSPACE_FORM_LOGIN } from '../form-messages'
import { PublicFormView } from './public-form'

/** 같은 요청에서 메타데이터와 화면이 두 번 읽지 않게 — 폼과 응답자(워크스페이스 멤버만의 폼이면 세션을 묻는다). */
const load = cache(async (token: string) => {
  const form = await readPublicForm(token)
  if (form === null) return null
  return { form, respondent: await resolveFormRespondent(form, await readSessionToken()) }
})

export async function generateMetadata({ params }: PageProps<'/f/[token]'>): Promise<Metadata> {
  const { token } = await params
  const loaded = await load(token)
  // 로그인하지 않은 사람 · 멤버가 아닌 사람에게는 폼의 제목을 싣지 않는다(워크스페이스 안의 이름이다)
  const title = loaded === null ? '없는 폼' : loaded.respondent.kind === 'anonymous' || loaded.respondent.kind === 'member' ? loaded.form.title : '폼'
  // 공개 화면 — 앱의 제목 틀을 씌우지 않는다(10d-7a)
  return { title: publicTitle(title), robots: 'noindex, nofollow', referrer: 'same-origin' }
}

export default async function PublicFormPage({ params }: PageProps<'/f/[token]'>) {
  const { token } = await params
  const loaded = await load(token)
  if (loaded === null || loaded.respondent.kind === 'denied') notFound()
  const { form, respondent } = loaded
  if (respondent.kind === 'login') {
    return (
      <main className="pub-page" data-testid="public-form-login">
        <p className="pub-form-description">{WORKSPACE_FORM_LOGIN}</p>
        <a href={`/login?next=${encodeURIComponent(`/f/${token}`)}`} className="pub-form-again" data-testid="public-form-login-link">
          로그인
        </a>
      </main>
    )
  }
  if (form.closedBecause !== null) {
    return (
      <main className="pub-page" data-testid="public-form-closed">
        <h1 className="pub-title">{form.title}</h1>
        <p className="pub-form-description">{FORM_CLOSED}</p>
      </main>
    )
  }
  if (await alreadyResponded(form, respondent)) {
    return (
      <main className="pub-page" data-testid="public-form-answered">
        <h1 className="pub-title">{form.title}</h1>
        <p className="pub-form-description">{ALREADY_RESPONDED}</p>
      </main>
    )
  }
  return (
    <main className="pub-page" data-testid="public-form">
      <PublicFormView
        token={token}
        respondentName={respondent.kind === 'member' ? respondent.name : null}
        allowAnother={!(form.onePerRespondent && respondent.kind === 'member')}
        submission={issueSubmissionToken(form.viewId)}
        form={{
          title: form.title,
          description: form.description,
          submitLabel: form.submitLabel,
          confirmationTitle: form.confirmationTitle,
          confirmationBody: form.confirmationBody,
          questions: form.questions.map((q) => ({ ...q, options: [...q.options] })),
        }}
      />
    </main>
  )
}
