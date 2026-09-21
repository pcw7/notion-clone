'use client'

/**
 * `New ▾` — 템플릿 6c-4조각 (F-08-02 · F-08-03)
 *
 * 정본: 08-templates-automation.md
 *   F-08-02 *"`New ▾`에서 해당 템플릿 선택 시 그 상태로 새 행 생성."*
 *   F-08-03 *"`New ▾` → 템플릿 우측 `•••` → `Set as default` … 이후 그 뷰의 `New` 클릭은 템플릿이 적용된 페이지를
 *            바로 연다."* · *"기본 템플릿이 지정되면 템플릿 선택 메뉴를 건너뛴다."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 버튼 둘 — 누르면 만들고, 화살표는 고르게 한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 주 버튼은 **기본 템플릿이 있으면 그것으로, 없으면 빈 항목으로** 곧바로 만든다 — 08 의 "메뉴를 건너뛴다"가 그것이다.
 * 라벨이 그 이름을 말한다(`newRowLabel`). 화살표는 목록을 연다: 빈 항목 · 템플릿들 · 그리고 뷰의 기본 지정.
 *
 * **만드는 일은 부르는 쪽이 한다**(`onCreate`). 표는 행을 끝에 붙이고 제목 칸을 열고, 보드는 그 열의 값을 함께
 * 보내 카드를 그 열에 세운다 — 만든 행을 어디에 끼울지는 각자의 상태가 안다. 이 컴포넌트는 **무엇으로** 만들지만
 * 정한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 기본 지정은 뷰의 것이다 — 그래서 여기 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 템플릿 자체는 표(data source)의 것이라 도구줄의 "템플릿" 패널이 관리한다(6c-3). 그런데 **기본 템플릿은 뷰의
 * 것**이다(`view.default_template_page_id` · §3.2-35) — 같은 표의 보드 뷰와 표 뷰가 다른 기본을 가질 수 있다.
 * 그래서 지정은 그 뷰의 `New` 옆에 둔다. 08 의 "This view only / All views" 다이얼로그는 없다 — 지정은 뷰별뿐이다.
 *
 * 목록은 열 때 받는다(`template-panel.tsx` 와 같은 이유 · 같은 API).
 */

import { useEffect, useRef, useState } from 'react'

import { UNTITLED_TEMPLATE, type DefaultTemplate } from '@/lib/database/new-row'
import * as api from './table-api'

export function NewRowMenu(props: {
  workspaceId: string
  viewId: string
  dataSourceId: string
  /** 이 뷰의 기본 템플릿. 주 버튼이 이것으로 만든다. */
  defaultTemplate: DefaultTemplate | null
  /** 기본 템플릿을 바꿀 수 있는가(`edit_structure` — 뷰를 고치는 일이다). */
  canSetDefault: boolean
  /** 만들고 있는 중이면 두 버튼 모두 누를 수 없다. */
  busy: boolean
  /** 무엇으로 만들지 — 템플릿 id 또는 빈 항목(`null`). */
  onCreate: (templateId: string | null) => void
  onDefaultChange: (next: DefaultTemplate | null) => void
  /** 주 버튼의 글자와 이름(스크린 리더). 표는 `newRowLabel`, 보드 열은 `+`. */
  label: string
  ariaLabel?: string
  /** 목록이 펼쳐지는 쪽. 보드의 오른쪽 열에서 왼쪽 기준으로 열면 화면 밖으로 나간다. */
  align?: 'left' | 'right'
  /** 표의 꼬리줄과 보드의 열이 다른 testid 를 쓴다(기존 e2e 가 그 이름으로 누른다). */
  testId: string
}) {
  const { workspaceId, viewId, dataSourceId, defaultTemplate, canSetDefault, busy, onCreate, onDefaultChange } = props
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<api.TemplateJson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 열 때 받는다 — 누른 자리에서(effect 안의 동기 setState 는 린트가 막는다 · §3.3-180).
  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setTemplates(null)
    setError(null)
    const listed = await api.listTemplates(workspaceId, dataSourceId)
    if (listed.ok) setTemplates(listed.value)
    else setError(listed.message)
  }

  const pick = (templateId: string | null) => {
    setOpen(false)
    onCreate(templateId)
  }

  const setDefault = async (next: DefaultTemplate | null) => {
    setSaving(true)
    setError(null)
    const saved = await api.updateView(workspaceId, viewId, { defaultTemplateId: next?.id ?? null })
    setSaving(false)
    if (!saved.ok) {
      setError(saved.message)
      return
    }
    onDefaultChange(next)
  }

  return (
    <div
      ref={boxRef}
      className="relative inline-flex items-stretch"
      // Esc 는 목록만 닫는다. 표의 칸 키 처리까지 가지 않게 여기서 멈춘다 — 목록이 열린 채로 표가 선택을 풀면 안 된다.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        data-testid={props.testId}
        disabled={busy}
        onClick={() => {
          // 목록이 열려 있어도 주 버튼은 주 버튼이다 — 누르면 닫고 만든다.
          setOpen(false)
          onCreate(defaultTemplate?.id ?? null)
        }}
        aria-label={props.ariaLabel}
        className="rounded-l-md px-2 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
      >
        {props.label}
      </button>
      <button
        type="button"
        data-testid={`${props.testId}-menu`}
        aria-label="템플릿 고르기"
        aria-expanded={open}
        disabled={busy}
        onClick={() => void toggle()}
        className="rounded-r-md px-1 text-neutral-400 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
      >
        ▾
      </button>

      {open && (
        <div
          data-testid="db-new-menu"
          className={`absolute top-full z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-1 text-left text-sm font-normal shadow-lg dark:border-neutral-800 dark:bg-neutral-950 ${
            props.align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <button
            type="button"
            data-testid="db-new-blank"
            onClick={() => pick(null)}
            className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            빈 항목
            {defaultTemplate === null && <span className="ml-auto text-xs text-neutral-400">기본</span>}
          </button>

          {templates === null && !error && <p className="px-2 py-1.5 text-neutral-400">불러오는 중…</p>}

          {templates !== null && templates.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-neutral-400" data-testid="db-new-no-templates">
              템플릿이 없습니다. 도구줄의 &ldquo;템플릿&rdquo;에서 만들 수 있습니다.
            </p>
          )}

          {templates !== null && templates.length > 0 && (
            <ul className="mt-1 flex flex-col border-t border-neutral-100 pt-1 dark:border-neutral-900">
              {templates.map((t) => {
                const isDefault = defaultTemplate?.id === t.id
                const name = t.title || UNTITLED_TEMPLATE
                return (
                  <li key={t.id} className="flex items-center gap-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900">
                    <button
                      type="button"
                      data-testid="db-new-template"
                      data-template-id={t.id}
                      onClick={() => pick(t.id)}
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                    >
                      {name}
                    </button>
                    {isDefault ? (
                      <span className="flex-none px-1.5 text-xs text-blue-700 dark:text-blue-300" data-testid="db-new-default-badge">
                        기본
                      </span>
                    ) : null}
                    {canSetDefault && (
                      <button
                        type="button"
                        data-testid={isDefault ? 'db-new-unset-default' : 'db-new-set-default'}
                        data-template-id={t.id}
                        disabled={saving}
                        onClick={() => void setDefault(isDefault ? null : { id: t.id, title: t.title })}
                        className="flex-none rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800"
                        aria-label={isDefault ? `${name}을(를) 이 뷰의 기본에서 해제` : `${name}을(를) 이 뷰의 기본으로`}
                      >
                        {isDefault ? '해제' : '기본으로'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {error && (
            <p role="alert" data-testid="db-new-error" className="px-2 py-1 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
