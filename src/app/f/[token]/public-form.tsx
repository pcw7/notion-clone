'use client'

/**
 * 공개 폼의 칸 · 제출 · 확인 화면 (인접 제품 7a-2b · F-13-02 · F-17-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑦
 *
 * 판정 · 방어는 서버다(`POST /f/{token}/submit` → `submitFormResponse`) — 여기는 칸을 그리고 답을 보낼 뿐이다. 입력은 잃지 않는다:
 * 실패하면 그대로 두고 값이 틀린 질문 아래에 까닭을, 나머지는 한 줄로 말한다. 받으면 같은 자리에 확인 화면 — "다른 응답 제출" 은 화면을
 * 새로 연다(새 제출 토큰 — 쓴 토큰은 다시 쓸 수 없다).
 *
 * 허니팟 칸(`website`)은 화면 밖에 있고 탭으로 닿지 않는다 — 사람은 비워 두고, 칸을 모두 채우는 봇이 채운다.
 */

import { useState, type FormEvent } from 'react'

import type { PublicFormQuestion } from '@/lib/database/form-submit'
import { ANOTHER_RESPONSE, MY_RESPONSE, REQUIRED_MARK, formFailureMessage, respondentNote, responsePathOf } from '../form-messages'

type FormProps = {
  readonly title: string
  readonly description: string | null
  readonly submitLabel: string
  readonly confirmationTitle: string
  readonly confirmationBody: string | null
  readonly questions: readonly PublicFormQuestion[]
}

type Answers = Record<string, string | boolean>

export function PublicFormView({
  token,
  submission,
  form,
  respondentName = null,
  allowAnother = true,
}: {
  token: string
  submission: string
  form: FormProps
  /** 워크스페이스 멤버만의 폼(7b-1)이면 응답자의 이름 — 응답에 이름이 남는다고 미리 말한다. 웹 공개 폼은 null(익명). */
  respondentName?: string | null
  /** 확인 화면의 "다른 응답 제출" — 한 사람당 한 번인 폼의 멤버(7b-3)에게는 없다. */
  allowAnother?: boolean
}) {
  const [answers, setAnswers] = useState<Answers>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [trap, setTrap] = useState('')
  const [sent, setSent] = useState(false)
  // 응답자가 그 행을 받았으면 그 주소(7b-4) — 확인 화면의 "내 응답 보기"
  const [mine, setMine] = useState<string | null>(null)

  const set = (propertyId: string, value: string | boolean) => setAnswers((current) => ({ ...current, [propertyId]: value }))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setIssues({})
    try {
      const res = await fetch(`/f/${token}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submission, answers, website: trap }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        issues?: { path: string; message: string }[]
        responsePath?: unknown
      } | null
      if (res.ok && body?.ok === true) {
        setMine(responsePathOf(body.responsePath))
        setSent(true)
        return
      }
      setError(formFailureMessage(body?.error))
      if (body?.error === 'invalid_value' && Array.isArray(body.issues)) {
        setIssues(Object.fromEntries(body.issues.map((issue) => [issue.path, issue.message])))
      }
    } catch {
      setError('연결에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <section data-testid="public-form-sent">
        <h1 className="pub-title">{form.confirmationTitle}</h1>
        {form.confirmationBody !== null && <p className="pub-form-description">{form.confirmationBody}</p>}
        {mine !== null && (
          <a href={mine} className="pub-form-again" data-testid="public-form-mine">
            {MY_RESPONSE}
          </a>
        )}
        {/* 새 화면 — 새 제출 토큰 */}
        {allowAnother && (
          <a href={`/f/${token}`} className="pub-form-again" data-testid="public-form-again">
            {ANOTHER_RESPONSE}
          </a>
        )}
      </section>
    )
  }

  return (
    <form className="pub-form" onSubmit={(e) => void submit(e)} noValidate data-testid="public-form-body">
      <h1 className="pub-title" data-testid="public-form-title">
        {form.title}
      </h1>
      {form.description !== null && <p className="pub-form-description">{form.description}</p>}
      {respondentName !== null && (
        <p className="pub-form-description" data-testid="form-respondent">
          {respondentNote(respondentName)}
        </p>
      )}

      {form.questions.map((q) => {
        const id = `q-${q.propertyId}`
        const issue = issues[q.propertyId]
        return (
          <div key={q.propertyId} className="pub-form-question" data-testid="public-form-question" data-property-id={q.propertyId}>
            <label htmlFor={id} className="pub-form-label">
              {q.label}
              {q.required && (
                <span className="pub-form-required" aria-hidden="true">
                  {' '}
                  {REQUIRED_MARK}
                </span>
              )}
            </label>
            {q.helpText !== null && <p className="pub-form-help">{q.helpText}</p>}
            <QuestionInput id={id} question={q} value={answers[q.propertyId]} invalid={issue !== undefined} onChange={(v) => set(q.propertyId, v)} />
            {issue !== undefined && (
              <p className="pub-form-issue" role="alert" data-testid="public-form-issue">
                {issue}
              </p>
            )}
          </div>
        )
      })}

      {/* 허니팟 — 사람에게 보이지 않는다(화면 밖 · 탭 · 자동 완성 없음) */}
      <div className="pub-report-trap" aria-hidden="true">
        <label>
          웹사이트
          <input name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>

      {error !== null && (
        <p className="pub-form-error" role="alert" data-testid="public-form-error">
          {error}
        </p>
      )}
      <button type="submit" className="pub-form-submit" disabled={busy} data-testid="public-form-submit">
        {form.submitLabel}
      </button>
    </form>
  )
}

/** 질문 하나의 칸 — 타입마다. */
function QuestionInput({
  id,
  question,
  value,
  invalid,
  onChange,
}: {
  id: string
  question: PublicFormQuestion
  value: string | boolean | undefined
  invalid: boolean
  onChange: (value: string | boolean) => void
}) {
  const common = { id, 'aria-required': question.required, 'aria-invalid': invalid || undefined, 'data-testid': 'public-form-input' }
  const text = typeof value === 'string' ? value : ''
  switch (question.type) {
    case 'title':
      return <input {...common} type="text" className="pub-form-field" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'rich_text':
      return <textarea {...common} rows={4} className="pub-form-field" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <input {...common} type="text" inputMode="decimal" className="pub-form-field" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'date':
      return <input {...common} type="date" className="pub-form-field" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'checkbox':
      return (
        <input
          {...common}
          type="checkbox"
          className="pub-form-check"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      )
    case 'select':
      return (
        <div role="radiogroup" aria-label={question.label} aria-required={question.required} className="pub-form-options" data-testid="public-form-input" id={id}>
          {question.options.map((option) => (
            <label key={option.id} className="pub-form-option">
              <input
                type="radio"
                name={id}
                value={option.id}
                checked={value === option.id}
                onChange={() => onChange(option.id)}
                data-testid="public-form-option"
              />
              {option.name}
            </label>
          ))}
        </div>
      )
  }
}
