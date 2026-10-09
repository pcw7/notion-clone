'use client'

/**
 * 식 편집기 — 속성 추가 폼과 머리 메뉴의 "식 고치기"가 함께 쓴다 (수식 2i-3b조각 · F-03-12)
 *
 *   *"편집기에서 컴파일 에러"* (03 F-03-12 · 타입 불일치)
 *
 * 치는 동안 **서버가 저장할 때 쓰는 그 함수**로 식을 읽는다(`checkFormulaDraft`). 틀리면 이유와 몇 번째 글자인지, 그리고 식 아래에
 * 그 자리를 밑줄로 다시 보인다(입력칸 위에 겹쳐 그리지 않는다 — 글꼴 · 줄바꿈 · 스크롤을 맞출 일이 없다). 맞으면 결과 타입과 **첫 행의
 * 값**을 미리 보인다. 다른 수식을 거쳐 돌아오는 고리 · 깊이는 화면이 보지 못한다 — 저장할 때 서버가 이유를 준다(부르는 쪽이 그린다).
 *
 * "속성 · 함수 넣기" — 누르면 캐럿 자리에 `prop("이름")` · `함수(` 를 넣는다. 함수 설명은 함수 표(`functions.ts`)의 한 줄이다.
 */

import { useMemo, useRef, useState } from 'react'

import { cellText } from '@/lib/database/cell-format'
import { checkFormulaDraft, formulaCell, type FormulaDraftCheck, type FormulaPlan } from '@/lib/database/formula-plan'
import { formulaTypeOfCell } from '@/lib/database/formula-schema'
import { FUNCTIONS } from '@/lib/formula/functions'
import type { FormulaType, FormulaValue } from '@/lib/formula/formula'

const RESULT_LABEL: Readonly<Record<FormulaType, string>> = { number: '숫자', text: '텍스트', boolean: '참/거짓', date: '날짜' }
const CATEGORIES = ['수', '글', '논리', '날짜', '변환'] as const

const FIELD =
  'rounded border border-neutral-300 bg-transparent px-2 py-1 text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:text-neutral-100'
const CHIP = 'rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

/** 미리보기의 글자 — 빈 값은 "빈 값"(0 이 아니다) · 참거짓은 말로. 나머지는 칸과 같은 모양(`cellText`). */
export function previewText(value: FormulaValue | undefined): string {
  if (value === null || value === undefined) return '빈 값'
  if (value.type === 'boolean') return value.value ? '참' : '거짓'
  const cell = formulaCell(value)
  return cell === null ? '빈 값' : cellText(cell)
}

/** `prop("…")` 의 이름 — 따옴표 · 역슬래시를 탈출한다(`displayFormula` 와 같은 규칙). */
const quoted = (name: string) => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function FormulaEditor({
  plan,
  value,
  onChange,
  check,
  selfId,
  autoFocus,
}: {
  plan: FormulaPlan
  value: string
  onChange: (next: string) => void
  /** 부르는 쪽이 `checkFormulaDraft` 로 낸 것 — 저장 단추를 막을지도 그것으로 정한다. */
  check: FormulaDraftCheck
  /** 고치는 수식 — 넣을 속성 목록에서 뺀다(자기 자신을 읽을 수 없다). */
  selfId?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  /** 캐럿 자리(고른 글자가 있으면 그것 대신)에 넣고 캐럿을 넣은 글 뒤로. */
  const insert = (text: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + text + value.slice(end))
    const caret = start + text.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  // 수식이 읽을 수 있는 속성만 — 칸 타입과 다른 수식(`formula-schema.ts` 머리말). relation · rollup · 고유 ID 는 아직이다.
  const properties = plan.sources.filter((p) => p.id !== selfId && (p.type === 'formula' || formulaTypeOfCell(p.type) !== null))

  return (
    <div className="flex flex-col gap-1" data-testid="db-formula-editor">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'prop("수량") * prop("단가")'}
        aria-label="수식"
        aria-invalid={check.kind === 'error' || undefined}
        data-testid="db-formula-expression"
        rows={3}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        className={`${FIELD} resize-y font-mono text-xs`}
      />

      {check.kind === 'empty' && <p className="text-xs text-neutral-500">속성은 prop(&quot;이름&quot;)으로 읽습니다. 같은 행의 값으로 계산합니다.</p>}
      {check.kind === 'error' && (
        <>
          <p role="status" data-testid="db-formula-check" className="text-xs text-red-600">
            {check.error.message} ({check.error.start + 1}번째 글자)
          </p>
          {/* 틀린 자리를 식 아래에 다시 보인다. 끝에서 틀렸으면(빈 자리) 빈칸 표시를 밑줄 친다. */}
          <pre
            data-testid="db-formula-mark"
            className="whitespace-pre-wrap break-all rounded bg-neutral-50 px-1.5 py-1 font-mono text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {value.slice(0, check.error.start)}
            <mark className="bg-transparent text-red-600 underline decoration-red-500 decoration-wavy">
              {value.slice(check.error.start, check.error.end) || '␣'}
            </mark>
            {value.slice(check.error.end)}
          </pre>
        </>
      )}
      {check.kind === 'ok' && (
        <p role="status" data-testid="db-formula-check" className="text-xs text-neutral-500">
          결과: {RESULT_LABEL[check.resultType]}
          {check.preview !== undefined && <span data-testid="db-formula-preview"> · 첫 행: {previewText(check.preview)}</span>}
        </p>
      )}

      <details data-testid="db-formula-insert" className="text-xs">
        <summary className="cursor-pointer select-none text-neutral-500">속성 · 함수 넣기</summary>
        <div className="mt-1 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {properties.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-neutral-400">속성</p>
              <div className="flex flex-wrap gap-1">
                {properties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="db-formula-insert-prop"
                    data-name={p.name}
                    onClick={() => insert(`prop(${quoted(p.name)})`)}
                    className={CHIP}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {CATEGORIES.map((category) => (
            <div key={category} className="flex flex-col gap-0.5">
              <p className="text-neutral-400">{category}</p>
              <div className="flex flex-wrap gap-1">
                {FUNCTIONS.filter((f) => f.category === category).map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    data-testid="db-formula-insert-fn"
                    data-fn={f.name}
                    title={f.description}
                    onClick={() => insert(`${f.name}(`)}
                    className={CHIP}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

/**
 * 머리 메뉴의 "식 고치기" — 지금 식(사람이 읽는 모양)으로 연다. 화면의 검사가 틀렸다면 저장을 막고, 서버가 거부하면(다른 수식을 거친
 * 고리 · 깊이) 그 이유를 그 자리에 보인다. 저장하면 부르는 쪽이 다시 읽는다(계산 계획이 새로 서야 한다).
 */
export function FormulaEditForm({
  plan,
  selfId,
  initial,
  previewCells,
  onSave,
  onDone,
}: {
  plan: FormulaPlan
  selfId: string
  initial: string
  previewCells: Readonly<Record<string, unknown>> | null
  /** 실패하면 사람이 읽을 이유를, 성공하면 `null`. */
  onSave: (expression: string) => Promise<string | null>
  onDone: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const check = useMemo(() => checkFormulaDraft(plan, draft, { selfId, previewCells }), [plan, draft, selfId, previewCells])

  return (
    <form
      data-testid="db-formula-edit"
      onSubmit={async (e) => {
        e.preventDefault()
        if (busy || check.kind !== 'ok') return
        setBusy(true)
        setError(null)
        const failure = await onSave(draft)
        setBusy(false)
        if (failure === null) onDone()
        else setError(failure)
      }}
      className="flex flex-col gap-1 p-1"
    >
      <FormulaEditor
        plan={plan}
        value={draft}
        onChange={(next) => {
          setDraft(next)
          setError(null)
        }}
        check={check}
        selfId={selfId}
        autoFocus
      />
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onDone} className="rounded px-2 py-0.5 text-sm text-neutral-500">
          취소
        </button>
        <button
          type="submit"
          data-testid="db-formula-save"
          disabled={busy || check.kind !== 'ok' || draft === initial}
          className="rounded-md border border-neutral-300 px-2 py-0.5 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          {busy ? '저장하는 중…' : '저장'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
