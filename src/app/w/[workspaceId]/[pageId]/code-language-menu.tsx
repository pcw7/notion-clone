/**
 * 코드 블록의 언어 목록 — 검색형 콤보박스 (잔여 묶음 8a-2 · F-01-14)
 *
 * ⚠ `'use client'` 를 달지 않는다 — `block-menu.tsx` 와 같은 이유(이미 클라이언트 그래프 안이고, 함수 props 는 경계를 넘지 못한다).
 *
 * **편집기 밖에 그린다**(`body-editor.tsx` 의 프레임 안 · `view.dom` 밖). 편집 영역 안에 두면 한글 조합 · 키 · 붙여넣기가
 * ProseMirror 로 새지 않게 막아야 하고, 편집기가 노드 뷰를 새로 만들 때마다(참조 제목 · 멘션 이름 갱신) 열린 목록과 검색어가
 * 사라진다. 여기서는 입력칸이 포커스를 가진다 — 편집기는 이 키들을 보지 않는다.
 *
 * 키: ↑↓ 순환 · Enter 고르기 · Esc 닫고 편집기로 · Tab 닫기. **한글 조합 중에는 손대지 않는다**(조합을 끝내는 Enter 가 고르기가
 * 되지 않게). 바깥을 누르면 닫는다 — 편집기 밖이면 누른 곳이 포커스를 가져가고, 편집기 안이면 부르는 쪽이 편집기로 돌려준다(누른
 * 크롬 버튼은 mousedown 을 막아 포커스를 가져가지 않는다 — 돌려주지 않으면 포커스가 body 에 떨어져 친 글자가 갈 곳이 없다).
 *
 * 접근성: 입력칸 `role=combobox` · `aria-expanded` · `aria-controls` · `aria-activedescendant`, 목록 `role=listbox`, 항목
 * `role=option` · `aria-selected`. 지금 언어에는 ✓.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from 'react'

import { codeLanguageOptions } from '@/lib/block/code'

export type CodeLanguageMenuProps = {
  /** 저장된 언어 — 없거나 plain text 면 null. 목록 밖의 값도 그대로 온다. */
  current: string | null
  /** 프레임 기준 좌표. */
  top: number
  left: number
  /** 고른 언어 — plain text 면 null. */
  onPick: (language: string | null) => void
  /** `restoreFocus`: 편집기로 포커스를 돌려줄 것인가. `outside`: 바깥을 눌러 닫았으면 누른 곳. */
  onClose: (restoreFocus: boolean, outside?: EventTarget | null) => void
  /** 부르는 쪽이 이 목록을 닫게 하는 길(트리거를 다시 눌렀을 때). */
  closeRef?: MutableRefObject<((restoreFocus: boolean) => void) | null>
  /** 이 목록을 연 트리거인가 — 바깥 누르기가 건너뛴다(트리거의 click 이 닫는다). */
  isTrigger?: (target: EventTarget | null) => boolean
}

export function CodeLanguageMenu({ current, top, left, onPick, onClose, closeRef, isTrigger }: CodeLanguageMenuProps) {
  const [query, setQuery] = useState('')
  const options = useMemo(() => codeLanguageOptions(query, current), [query, current])
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.current)))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-option-${i}`

  // 활성 항목이 보이게 한다 — 목록이 길다(90개).
  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: 'nearest' })
    // optionId 는 listId 로만 정해진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // 바깥을 누르면 닫는다 — capture 로 받아야 편집기가 선택을 옮기기 전에 본다. 이 목록을 연 트리거는 건너뛴다(트리거의 click 이 닫는다).
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node) || isTrigger?.(event.target)) return
      onClose(false, event.target)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose, isTrigger])

  useEffect(() => {
    if (!closeRef) return
    closeRef.current = (restoreFocus) => onClose(restoreFocus)
    return () => {
      closeRef.current = null
    }
  }, [closeRef, onClose])

  const pick = (index: number): void => {
    const option = options[index]
    if (!option) return
    onPick(option.id)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    // 한글 조합 중의 Enter · 화살표는 조합의 것이다(229 는 조합 중에 오는 keyCode).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const count = Math.max(options.length, 1)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % count)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + count) % count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // window 의 Esc 리스너(코멘트 패널 같은 것)가 함께 돌지 않게. 편집기는 이 키를 보지 않는다 — 입력칸이 편집기 밖이다(§3.3-41).
      event.stopPropagation()
      onClose(true)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      onClose(true)
    }
  }

  return (
    <div
      ref={rootRef}
      // 목록 안의 포커스를 받지 않는 자리(여백 · "맞는 언어가 없습니다")를 눌러도 검색칸이 포커스를 지킨다 — 잃으면 키가 죽는다(8a-2 리뷰).
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault()
      }}
      data-testid="code-language-menu"
      className="absolute z-30 flex w-64 flex-col rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{ top, left }}
    >
      <input
        ref={inputRef}
        data-testid="code-language-search"
        role="combobox"
        aria-label="언어 검색"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options.length > 0 ? optionId(active) : undefined}
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          // 검색어가 바뀌면 맨 위 후보로.
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        placeholder="언어 검색"
        className="m-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
      <ul ref={listRef} id={listId} role="listbox" aria-label="언어" className="max-h-64 overflow-auto py-1">
        {options.length === 0 && <li className="px-3 py-1.5 text-sm text-neutral-500">맞는 언어가 없습니다</li>}
        {options.map((option, i) => (
          <li
            key={option.id ?? 'plain text'}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            data-testid="code-language-option"
            onClick={() => pick(i)}
            // 포인터가 실제로 움직였을 때만 — 키보드로 옮긴 활성 항목을 보이려고 목록이 굴러가면 가만히 있는 포인터 밑으로 다른 항목이
            // 들어와 경계 이벤트(mouseenter)가 오고, 그것이 키보드의 자리를 되돌렸다(8a-2 리뷰). 스크롤은 mousemove 를 내지 않는다.
            onMouseMove={() => {
              if (active !== i) setActive(i)
            }}
            className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm ${
              i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
            }`}
          >
            <span>{option.label}</span>
            {option.current && (
              <span aria-hidden className="text-xs text-neutral-500">
                ✓
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
