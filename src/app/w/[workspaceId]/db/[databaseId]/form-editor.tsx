'use client'

/**
 * 폼 편집 화면 — 데이터베이스의 폼 탭 (인접 제품 7a-3 · F-13-01 · F-13-02)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ②③⑧
 *
 * 판정은 서버다(`database/form.ts` — 라우트 `PATCH /forms/{viewId}` · `PUT /forms/{viewId}/questions`) — 여기는 서버가 준 폼을 그리고,
 * 고칠 때마다 보내고, 돌아온 폼으로 다시 그린다(초안을 오래 들지 않는다).
 *
 *   · 머리 — 폼 제목 · 설명(칸을 떠날 때 저장)
 *   · 질문 — 순서대로(위 · 아래) · 제목 · 도움말 · 필수 · 빼기 — 바뀔 때마다 목록을 통째로 보낸다(정본 ②)
 *   · 질문 더하기 — 서버가 준 "더할 수 있는 속성"(받는 타입만)
 *   · 제출 문구 · 확인 화면(제목 · 본문)
 *   · 공유 — 공개 · 닫기(바꿀 수 있는 사람에게만) · 공개면 주소 · 복사 · 열기 · 정책이 막으면 그렇다고
 *
 * 고칠 수 없는 사람(`canEdit` 거짓)에게는 같은 화면이 읽기로 선다.
 */

import { useState } from 'react'

import type { FormDetail, FormQuestion } from '@/lib/database/form'
import { FORM_PUBLIC_HINT, NO_QUESTIONS, formEditorFailureMessage, formUrlOf } from './form-editor-messages'

const FIELD =
  'w-full rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-700'
const BUTTON =
  'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800'

type QuestionDraft = { propertyId: string; label: string | null; helpText: string | null; required: boolean }

const draftOf = (q: FormQuestion): QuestionDraft => ({ propertyId: q.propertyId, label: q.label, helpText: q.helpText, required: q.required })

export function FormEditor({ workspaceId, initial }: { workspaceId: string; initial: FormDetail }) {
  const [form, setForm] = useState<FormDetail>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const base = `/api/workspaces/${workspaceId}/forms/${form.viewId}`
  const readOnly = !form.canEdit

  const send = async (url: string, method: 'PATCH' | 'PUT', body: unknown, done?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => null)) as { form?: FormDetail; error?: string } | null
      if (!res.ok || data?.form === undefined) {
        setError(formEditorFailureMessage(data?.error))
        return
      }
      setForm(data.form)
      if (done !== undefined) setNotice(done)
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = (patch: Record<string, unknown>, done?: string) => send(base, 'PATCH', patch, done)
  const saveQuestions = (next: QuestionDraft[]) => send(`${base}/questions`, 'PUT', { questions: next })
  const drafts = form.questions.map(draftOf)
  const replaceAt = (index: number, patch: Partial<QuestionDraft>) =>
    saveQuestions(drafts.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  const move = (index: number, delta: -1 | 1) => {
    const next = [...drafts]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item!)
    void saveQuestions(next)
  }

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setNotice('주소를 복사했습니다.')
    } catch {
      setNotice('주소를 고른 뒤 직접 복사하세요.')
    }
  }

  const settings = form.settings
  const address = settings.access === 'public' && settings.token !== null && typeof window !== 'undefined' ? formUrlOf(window.location.origin, settings.token) : null

  return (
    <section data-testid="form-editor" className="flex max-w-2xl flex-col gap-6">
      {/* 머리 */}
      <div className="flex flex-col gap-2">
        <TextDraft
          label="폼 제목"
          testId="form-title"
          value={settings.title}
          placeholder={form.name}
          disabled={readOnly || busy}
          onCommit={(value) => void saveSettings({ title: value })}
          className={`${FIELD} text-lg font-semibold`}
        />
        <TextDraft
          label="설명"
          testId="form-description"
          value={settings.description}
          placeholder="이 폼에 대한 설명(선택)"
          multiline
          disabled={readOnly || busy}
          onCommit={(value) => void saveSettings({ description: value })}
          className={FIELD}
        />
      </div>

      {/* 질문 */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">질문</h2>
        {drafts.length === 0 && <p className="text-xs text-neutral-500">{NO_QUESTIONS}</p>}
        <ol className="flex flex-col gap-2">
          {form.questions.map((q, i) => (
            <li
              key={q.propertyId}
              data-testid="form-question"
              data-property-id={q.propertyId}
              className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <div className="flex items-center gap-2">
                <TextDraft
                  label="질문 제목"
                  testId="form-question-label"
                  value={q.label}
                  placeholder={q.propertyName}
                  disabled={readOnly || busy}
                  onCommit={(value) => void replaceAt(i, { label: value })}
                  className={`${FIELD} font-medium`}
                />
                <span className="shrink-0 text-xs text-neutral-400">{q.propertyName}</span>
              </div>
              <TextDraft
                label="도움말"
                testId="form-question-help"
                value={q.helpText}
                placeholder="도움말(선택)"
                disabled={readOnly || busy}
                onCommit={(value) => void replaceAt(i, { helpText: value })}
                className={`${FIELD} text-xs`}
              />
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    data-testid="form-question-required"
                    checked={q.required}
                    disabled={readOnly || busy}
                    onChange={(e) => void replaceAt(i, { required: e.target.checked })}
                  />
                  필수
                </label>
                {!readOnly && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" aria-label="위로" data-testid="form-question-up" disabled={busy || i === 0} onClick={() => move(i, -1)} className={BUTTON}>
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="아래로"
                      data-testid="form-question-down"
                      disabled={busy || i === drafts.length - 1}
                      onClick={() => move(i, 1)}
                      className={BUTTON}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`${q.label ?? q.propertyName} 질문 빼기`}
                      data-testid="form-question-remove"
                      disabled={busy}
                      onClick={() => void saveQuestions(drafts.filter((_, j) => j !== i))}
                      className={BUTTON}
                    >
                      빼기
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!readOnly && form.candidates.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              aria-label="질문으로 더할 속성"
              data-testid="form-add-select"
              value={adding}
              disabled={busy}
              onChange={(e) => setAdding(e.target.value)}
              className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
            >
              <option value="">속성 고르기…</option>
              {form.candidates.map((c) => (
                <option key={c.propertyId} value={c.propertyId}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="form-add"
              disabled={busy || adding === ''}
              onClick={() => {
                const propertyId = adding
                setAdding('')
                void saveQuestions([...drafts, { propertyId, label: null, helpText: null, required: false }])
              }}
              className={BUTTON}
            >
              질문 더하기
            </button>
          </div>
        )}
      </div>

      {/* 제출 · 확인 화면 */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">제출 뒤</h2>
        <TextDraft
          label="제출 단추"
          testId="form-submit-label"
          value={settings.submitLabel}
          placeholder="제출"
          disabled={readOnly || busy}
          onCommit={(value) => void saveSettings({ submitLabel: value })}
          className={FIELD}
        />
        <TextDraft
          label="확인 제목"
          testId="form-confirmation-title"
          value={settings.confirmationTitle}
          placeholder="제출했습니다"
          disabled={readOnly || busy}
          onCommit={(value) => void saveSettings({ confirmationTitle: value })}
          className={FIELD}
        />
        <TextDraft
          label="확인 본문"
          testId="form-confirmation-body"
          value={settings.confirmationBody}
          placeholder="제출한 사람에게 보일 말(선택)"
          multiline
          disabled={readOnly || busy}
          onCommit={(value) => void saveSettings({ confirmationBody: value })}
          className={FIELD}
        />
      </div>

      {/* 공유 */}
      <div className="flex flex-col gap-2" data-testid="form-share">
        <h2 className="text-sm font-medium">공유</h2>
        {!form.policyAllows && <p className="text-xs text-amber-700 dark:text-amber-400">워크스페이스 정책이 웹 공개를 막았습니다 — 공개된 폼도 열리지 않습니다.</p>}
        {settings.access === 'closed' && <p className="text-xs text-neutral-500">{FORM_PUBLIC_HINT}</p>}
        {address !== null && (
          <div className="flex items-center gap-1">
            <input
              readOnly
              aria-label="폼 주소"
              data-testid="form-url"
              value={address}
              onFocus={(e) => e.currentTarget.select()}
              className={`${FIELD} text-xs`}
            />
            <button type="button" data-testid="form-copy" onClick={() => void copy(address)} className={BUTTON}>
              복사
            </button>
            <a href={address} target="_blank" rel="noopener noreferrer" data-testid="form-open" className={BUTTON}>
              열기
            </a>
          </div>
        )}
        {form.canPublish ? (
          <button
            type="button"
            data-testid="form-access"
            data-access={settings.access}
            disabled={busy || (settings.access === 'closed' && !form.policyAllows)}
            onClick={() =>
              void saveSettings(
                { access: settings.access === 'public' ? 'closed' : 'public' },
                settings.access === 'public' ? '폼을 닫았습니다. 그 주소로는 응답을 받지 않습니다.' : '폼을 웹에 공개했습니다.',
              )
            }
            className={`self-start ${settings.access === 'public' ? BUTTON : 'rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50'}`}
          >
            {settings.access === 'public' ? '공개 닫기' : '웹에 공개'}
          </button>
        ) : (
          settings.access === 'public' && <p className="text-xs text-neutral-500">이 폼은 웹에 공개되어 있습니다.</p>
        )}
      </div>

      {error !== null && (
        <p role="alert" data-testid="form-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" data-testid="form-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </section>
  )
}

/**
 * 글 칸 하나 — 칸을 떠날 때(또는 Enter — 여러 줄이 아니면) 바뀌었으면 보낸다. 서버 값이 바뀌면 다시 선다(`key` — 효과 안의 setState 없이).
 * 비우면 `null`(기본 문구를 쓴다).
 */
function TextDraft(props: {
  label: string
  testId: string
  value: string | null
  placeholder: string
  disabled: boolean
  multiline?: boolean
  className: string
  onCommit: (value: string | null) => void
}) {
  return <TextDraftInner key={props.value ?? ''} {...props} />
}

function TextDraftInner({
  label,
  testId,
  value,
  placeholder,
  disabled,
  multiline = false,
  className,
  onCommit,
}: {
  label: string
  testId: string
  value: string | null
  placeholder: string
  disabled: boolean
  multiline?: boolean
  className: string
  onCommit: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const commit = () => {
    const next = draft.trim() === '' ? null : draft
    if ((next ?? '') !== (value ?? '')) onCommit(next)
  }
  const common = {
    'aria-label': label,
    'data-testid': testId,
    value: draft,
    placeholder,
    disabled,
    className,
    onBlur: commit,
  }
  return multiline ? (
    <textarea {...common} rows={2} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}
