'use client'

/**
 * 알림 보내기 액션의 편집 칸 — 자동화 AN-2 (F-08-07)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AN-1] ① · [보강 AN-2] ①③
 *
 * **지연 로드되는 조각이다**(③) — 데이터베이스 화면은 번들 예산에 닿아 있어, 액션 목록이 이 액션을 그릴 때만 받는다(`action-editor.tsx` 의
 * `next/dynamic`). 그래서 이 파일은 속성 · 멤버를 스스로 읽고, 부르는 쪽에는 받은 설정(`config`)과 바뀐 설정만 오간다.
 *
 * 칸 셋: 받는 멤버(워크스페이스의 멤버 · 게스트는 목록에 없다 · 20명에서 더 고를 수 없다) · 사람 칸(행이 있는 편집기에서만 — 그 표의
 * 사람 속성 여럿) · 메시지(글 + "값 넣기"가 넣는 `{{row:속성 id}}` 슬롯 — 편집 중에는 속성 이름의 칩). 저장되는 글은 토큰 글 그대로다.
 */

import { useEffect, useRef, useState } from 'react'

import { textRun, toPlainText, type RichTextRun } from '@/lib/contracts/rich-text'
import type { PropertySummary } from '@/lib/database/property'
import { isAutomationCellType } from '@/lib/database/property-types'
import { joinNotifyMessage as join, MAX_NOTIFY_MESSAGE, MAX_NOTIFY_USERS, splitNotifyMessage as split } from './notify-message'
import * as api from './table-api'

type NotifyConfig = { readonly to: { readonly users: readonly string[]; readonly people_property_ids: readonly string[] } }

const box = 'min-w-0 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'

/** 설정의 모양을 믿지 않고 읽는다(모르는 모양은 빈 값). */
function read(config: Record<string, unknown>) {
  const to = (config.to ?? {}) as Partial<NotifyConfig['to']>
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const message = Array.isArray(config.message) ? toPlainText(config.message as RichTextRun[]) : ''
  return { users: ids(to.users), people: ids(to.people_property_ids), message }
}

export default function NotifyEditor({
  p,
  workspaceId,
  dataSourceId,
  config,
  onChange,
}: {
  p: string
  workspaceId: string
  /** 일하는 행의 표 — 버튼 블록처럼 행이 없으면 빈 글(사람 칸 · 값 넣기가 서지 않는다). */
  dataSourceId: string
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const { users, people, message } = read(config)
  const [props, setProps] = useState<readonly PropertySummary[]>([])
  const [names, setNames] = useState<Readonly<Record<string, string>>>({})
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<readonly api.PersonCandidateJson[] | null>(null)
  const [slotMenu, setSlotMenu] = useState(false)
  /** 마지막으로 커서가 있던 글 칸과 자리 — "값 넣기"가 거기에 넣는다. */
  const caret = useRef<{ index: number; at: number }>({ index: -1, at: 0 })
  const hasRow = dataSourceId !== ''

  useEffect(() => {
    if (!hasRow) return
    let alive = true
    void api.readProperties(workspaceId, dataSourceId).then((r) => {
      if (alive && r.ok) setProps(r.value)
    })
    return () => {
      alive = false
    }
  }, [workspaceId, dataSourceId, hasRow])

  // 고른 멤버의 이름 — 모르는 사람만 묻는다
  const unknown = users.filter((id) => names[id] === undefined).join(',')
  useEffect(() => {
    if (unknown === '') return
    let alive = true
    void api.loadPeopleNames(workspaceId, unknown.split(',')).then((r) => {
      if (alive && r.ok) setNames((prev) => ({ ...r.value, ...prev }))
    })
    return () => {
      alive = false
    }
  }, [workspaceId, unknown])

  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      void api.searchPeople(workspaceId, query.trim()).then((r) => {
        if (alive) setCandidates(r.ok ? r.value.filter((c) => !c.guest) : [])
      })
    }, 120)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [workspaceId, query])

  const peopleProps = props.filter((x) => x.type === 'people')
  const slotProps = props.filter((x) => isAutomationCellType(x.type))
  const nameOfProp = (id: string): string => props.find((x) => x.id === id)?.name ?? '(없는 속성)'

  const emit = (next: { users?: readonly string[]; people?: readonly string[]; message?: string }) => {
    const text = next.message ?? message
    onChange({
      ...config,
      v: 1,
      to: { users: next.users ?? users, people_property_ids: next.people ?? people },
      message: text === '' ? [] : [textRun(text)],
    })
  }

  const full = users.length >= MAX_NOTIFY_USERS
  const parts = split(message)
  const setPart = (i: number, value: string) => emit({ message: join(parts.map((s, j) => (j === i ? value : s))) })
  const insertSlot = (propertyId: string) => {
    const at = caret.current.index >= 0 && caret.current.index < parts.length && caret.current.index % 2 === 0 ? caret.current.index : parts.length - 1
    const text = parts[at]
    const cut = caret.current.index === at ? Math.min(caret.current.at, text.length) : text.length
    const next = [...parts]
    next.splice(at, 1, text.slice(0, cut), propertyId, text.slice(cut))
    caret.current = { index: at + 2, at: 0 }
    setSlotMenu(false)
    emit({ message: join(next) })
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid={`${p}-notify`}>
      <div className="flex flex-col gap-1">
        <span className="text-neutral-500">받는 멤버 — {users.length}/{MAX_NOTIFY_USERS}명</span>
        <div className="flex flex-wrap gap-1">
          {users.map((id) => (
            <span key={id} data-testid={`${p}-notify-user`} data-user-id={id} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
              {names[id] ?? '…'}
              <button type="button" aria-label={`${names[id] ?? '멤버'} 빼기`} onClick={() => emit({ users: users.filter((x) => x !== id) })} className="text-neutral-400 hover:text-red-600">
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          aria-label="알림을 받을 멤버 찾기"
          data-testid={`${p}-notify-search`}
          value={query}
          placeholder={full ? '20명까지 고를 수 있습니다' : '이름 · 메일로 찾기'}
          disabled={full}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          className={box}
        />
        {!full && (
          <ul className="flex max-h-28 flex-col overflow-auto" aria-label="멤버 후보">
            {(candidates ?? [])
              .filter((c) => !users.includes(c.id))
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`${p}-notify-candidate`}
                    data-user-id={c.id}
                    onClick={() => {
                      setNames((prev) => ({ ...prev, [c.id]: c.name }))
                      emit({ users: [...users, c.id] })
                    }}
                    className="w-full rounded px-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {c.name}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      {hasRow && peopleProps.length > 0 && (
        <fieldset className="flex flex-col gap-0.5">
          <legend className="text-neutral-500">사람 칸 — 그 행의 사람에게도</legend>
          {peopleProps.map((f) => (
            <label key={f.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                data-testid={`${p}-notify-people`}
                data-property-id={f.id}
                checked={people.includes(f.id)}
                onChange={(e) => emit({ people: e.target.checked ? [...people, f.id] : people.filter((x) => x !== f.id) })}
              />
              {f.name}
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-neutral-500">메시지 — {message.length}/{MAX_NOTIFY_MESSAGE}자(칩은 보낼 때 그 행의 값으로 바뀝니다)</span>
        <div className="flex flex-wrap items-center gap-1" data-testid={`${p}-notify-message`}>
          {parts.map((part, i) =>
            i % 2 === 1 ? (
              <span key={i} data-testid={`${p}-notify-chip`} data-property-id={part} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                {nameOfProp(part)}
                <button
                  type="button"
                  aria-label={`${nameOfProp(part)} 빼기`}
                  onClick={() => emit({ message: join(parts.filter((_, j) => j !== i)) })}
                  className="opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ) : (
              <input
                key={i}
                type="text"
                aria-label={i === 0 ? '알림 메시지' : '알림 메시지 이어서'}
                data-testid={`${p}-notify-text`}
                value={part}
                autoComplete="off"
                onChange={(e) => {
                  caret.current = { index: i, at: e.target.selectionStart ?? e.target.value.length }
                  setPart(i, e.target.value)
                }}
                onSelect={(e) => {
                  caret.current = { index: i, at: e.currentTarget.selectionStart ?? 0 }
                }}
                onBlur={(e) => {
                  caret.current = { index: i, at: e.currentTarget.selectionStart ?? 0 }
                }}
                className={`${box} [field-sizing:content] min-w-[3rem] ${i === parts.length - 1 ? 'flex-1' : ''}`}
              />
            ),
          )}
        </div>
        {hasRow && slotProps.length > 0 && (
          <div className="relative self-start">
            <button
              type="button"
              data-testid={`${p}-notify-slot-add`}
              onClick={() => setSlotMenu((v) => !v)}
              className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              + 값 넣기
            </button>
            {slotMenu && (
              <ul className="absolute left-0 z-10 mt-1 max-h-40 min-w-[8rem] overflow-auto rounded border border-neutral-200 bg-white p-1 shadow dark:border-neutral-700 dark:bg-neutral-900">
                {slotProps.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      data-testid={`${p}-notify-slot-option`}
                      data-property-id={f.id}
                      // 글 칸이 포커스를 잃어도 자리는 기억해 둔 것으로 넣는다
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertSlot(f.id)}
                      className="w-full rounded px-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
