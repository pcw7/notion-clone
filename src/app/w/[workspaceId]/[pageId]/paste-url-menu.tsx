/**
 * 주소를 붙여넣은 뒤 고르는 메뉴 — 링크로 두기 · 북마크 · 임베드 · 페이지 멘션 (44번 트랙 EM-2 · 정본 §3.4 [보강 EM-2] ③)
 *
 * 지연 로드한다(`body-editor.tsx` 가 `import()` — 'use client' 를 달지 않는다) — 주소를 붙여넣은 때만 받는다(번들 예산). 자리 · 키 · 접근성을 모두
 * 여기서 한다: 포커스는 편집기에 남고(키는 창에서 먼저 잡는다 — 슬래시 · 멘션 메뉴와 같다), 지금 항목은 편집기 루트가 가리키게 한다
 * (`combobox-a11y.ts` 의 메타 트랜잭션). 링크로 두기가 첫 항목이다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorState, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { applyPasteUrlChoice, type PasteUrlKey, type PasteUrlOpen } from '@/lib/editor/paste-url-apply'
import { internalPageIdOf, pasteUrlOptions, type PasteUrlChoice } from '@/lib/editor/paste-url-choices'


/** 편집기 모듈을 가져오지 않는다(번들 예산 — `paste-url-apply.ts` 머리말) — 키 · 되돌리기 끊기는 화면이 넘긴다. */
export type PasteUrlEnv = {
  readonly key: PasteUrlKey
  /** 편집기 루트의 조합 위젯 상태 키(`combobox-a11y.ts` 의 `comboboxKey`). */
  readonly comboboxKey: PluginKey
  readonly separate: (state: EditorState) => void
}

const LISTBOX_ID = 'blk-paste-url-menu'
const optionId = (i: number) => `blk-paste-url-option-${i}`

export default function PasteUrlMenu({
  view,
  range,
  workspaceId,
  env,
}: {
  view: EditorView
  range: PasteUrlOpen
  workspaceId: string
  env: PasteUrlEnv
}) {
  const { url } = range
  const options = useMemo(() => pasteUrlOptions(url, window.location.origin, workspaceId), [url, workspaceId])
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const pick = useCallback(
    (choice: PasteUrlChoice) => {
      const pageId = choice === 'mention' ? internalPageIdOf(url, window.location.origin, workspaceId) : null
      applyPasteUrlChoice(view, env, choice, pageId)
      view.focus()
    },
    [view, url, workspaceId, env],
  )

  // 편집기 루트가 열린 목록과 지금 항목을 가리킨다(F-12-13) — 닫히면(이 판이 사라지면) 거둔다.
  useEffect(() => {
    view.dispatch(view.state.tr.setMeta(env.comboboxKey, { listboxId: LISTBOX_ID, activeId: optionId(index) }))
  }, [view, env, index])
  useEffect(
    () => () => {
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(env.comboboxKey, null))
    },
    [view, env],
  )

  // 키 — 편집기가 포커스를 가진 키만. 먹는 키는 편집기까지 보내지 않는다(그 밖의 키는 플러그인이 보고 닫는다).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== view.dom || event.isComposing) return
      const count = options.length
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setIndex((i) => (event.key === 'ArrowDown' ? (i + 1) % count : (i - 1 + count) % count))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        pick(options[Math.min(index, count - 1)].choice)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        view.dispatch(view.state.tr.setMeta(env.key, { close: true }))
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [view, env, options, index, pick])

  // 메뉴 밖을 누르면 아무것도 바꾸지 않고 닫는다(편집기 안은 플러그인이 닫는다).
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Node && listRef.current?.contains(event.target)) return
      view.dispatch(view.state.tr.setMeta(env.key, { close: true }))
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [view, env])

  // 그 자리(링크 글자의 시작) 아래 — 편집기 상자 기준. 범위가 매핑으로 옮겨지면 다시 그려질 때 따라간다.
  const coords = view.coordsAtPos(range.from)
  const box = view.dom.getBoundingClientRect()

  return (
    <ul
      ref={listRef}
      id={LISTBOX_ID}
      role="listbox"
      aria-label="주소 붙여넣기"
      data-testid="paste-url-menu"
      style={{ left: coords.left - box.left, top: coords.bottom - box.top }}
      className="absolute z-10 w-56 overflow-auto popover-surface py-1"
    >
      {options.map((option, i) => (
        <li key={option.choice}>
          <button
            type="button"
            id={optionId(i)}
            role="option"
            aria-selected={i === index}
            data-testid="paste-url-option"
            data-choice={option.choice}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(option.choice)}
            onMouseEnter={() => setIndex(i)}
            className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${i === index ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
