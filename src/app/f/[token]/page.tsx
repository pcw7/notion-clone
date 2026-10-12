/**
 * /f/[token] — 공개 폼 (인접 제품 7a-2b · F-13-02 · F-17-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑥⑦
 *
 * 세션을 읽지 않는다 — 판정은 `readPublicForm` 하나(열 수 없으면 404 · 이유를 말하지 않는다). 화면을 줄 때마다 새 제출 토큰을 싣는다
 * (서명 — DB 에 쓰지 않는다). 칸 · 제출 · 확인 화면은 `PublicFormView`(브라우저)가 그린다.
 *
 * referrer 는 `same-origin` — `no-referrer` 면 브라우저가 같은 출처의 POST 에도 `Origin: null` 을 보내 제출의 출처 검사가 막는다
 * (신고 화면에서 e2e 가 잡은 것과 같다).
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { issueSubmissionToken, readPublicForm } from '@/lib/database/form-submit'
import { PublicFormView } from './public-form'

/** 같은 요청에서 메타데이터와 화면이 두 번 읽지 않게. */
const load = cache((token: string) => readPublicForm(token))

export async function generateMetadata({ params }: PageProps<'/f/[token]'>): Promise<Metadata> {
  const { token } = await params
  const form = await load(token)
  return { title: form?.title ?? '없는 폼', robots: 'noindex, nofollow', referrer: 'same-origin' }
}

export default async function PublicFormPage({ params }: PageProps<'/f/[token]'>) {
  const { token } = await params
  const form = await load(token)
  if (form === null) notFound()
  return (
    <main className="pub-page" data-testid="public-form">
      <PublicFormView
        token={token}
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
