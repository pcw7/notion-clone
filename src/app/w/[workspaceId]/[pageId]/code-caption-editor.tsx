/**
 * 코드 블록의 캡션 입력 — 편집기 밖의 입력칸 (잔여 묶음 8a-2 · F-01-14)
 *
 * ⚠ `'use client'` 를 달지 않는다 — `block-menu.tsx` 와 같은 이유.
 *
 * 캡션 자리(코드 상자 바로 아래)에 겹쳐 그리지만 **편집기 밖**이다(`code-language-menu.tsx` 머리말과 같은 까닭 — 한글 조합 · 키가
 * 편집기로 새지 않고, 노드 뷰가 새로 만들어져도 쓰던 글자가 남는다).
 *
 *   · **여러 줄 입력칸**(textarea)이다 — 캡션은 줄바꿈을 가질 수 있다(RichText). 한 줄 input 은 받은 줄바꿈을 지워, 열고 닫기만 해도
 *     캡션을 고쳐 썼다(8a-2 설계 비평). 글자만큼 늘어나고, 받은 캡션을 가리도록 그 높이만큼은 늘 크다(`minHeight` · 불투명한 배경)
 *   · Enter · Tab · 바깥 누르기(blur 포함)로 저장, Shift+Enter 는 줄바꿈, Esc 는 저장하지 않고 닫는다. 한글 조합 중의 Enter 는 조합의
 *     것이다
 *   · **고친 것만 쓴다** — 글자를 쳤고(입력이 있었다) 연 순간의 글자와 다를 때만 저장한다. 열고 닫기만 하면 쓰지 않는다 — 연 뒤에
 *     다른 참여자가 바꾼 캡션을 되돌리지 않고, 받은 서식도 지킨다. 고쳤다면 그 글자가 이긴다(props 통째 LWW · 정본 ⑦)
 *   · 저장은 한 번뿐이다 — Enter 뒤에 입력칸이 사라지며 blur 가 한 번 더 와도 두 번 쓰지 않는다
 *   · 받은 캡션에 서식 · 링크 · 멘션이 있으면 고치면 평문이 된다고 먼저 말한다(정본 §3.4 [보강] 코드 블록 ⑤ · 입력칸의 설명으로
 *     이어 화면 읽기 프로그램도 읽는다)
 *   · 길이는 입력칸이 막는다(`MAX_CAPTION`) — 받은 캡션이 더 길면 그 길이까지. 저장할 때 자르지 않는다(`withCodeCaption`)
 */

import { useCallback, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from 'react'

import { MAX_CAPTION } from '@/lib/block/image'

export type CodeCaptionEditorProps = {
  /** 연 순간의 캡션 평문. */
  initial: string
  /** 지금 캡션에 평문으로 옮기면 잃는 것이 있는가 — 연 뒤에 다른 참여자가 바꾸면 따라 바뀐다. */
  formatted: boolean
  /** 프레임 기준 좌표 · 폭 · 가려야 할 캡션의 높이. */
  top: number
  left: number
  width: number
  minHeight: number
  onSave: (text: string) => void
  /**
   * 닫는다. `restoreFocus`: 편집기로 포커스를 돌려줄 것인가. `outside`: 바깥을 눌러 닫았으면 누른 곳 — 편집기 안이면 부르는 쪽이
   * 포커스를 돌려준다(누른 크롬 버튼은 포커스를 가져가지 않는다).
   */
  onClose: (restoreFocus: boolean, outside?: EventTarget | null) => void
  /** 부르는 쪽이 이 입력을 닫게 하는 길(트리거를 다시 눌렀을 때) — 쓰던 글자는 저장한다. */
  closeRef?: MutableRefObject<((restoreFocus: boolean) => void) | null>
  /** 이 입력을 연 트리거인가 — 바깥 누르기가 건너뛴다(트리거의 click 이 닫는다). */
  isTrigger?: (target: EventTarget | null) => boolean
}

export function CodeCaptionEditor({
  initial,
  formatted,
  top,
  left,
  width,
  minHeight,
  onSave,
  onClose,
  closeRef,
  isTrigger,
}: CodeCaptionEditorProps) {
  const doneRef = useRef(false)
  const dirtyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const noticeId = useId()

  const finish = useCallback(
    (text: string | null, restoreFocus: boolean, outside?: EventTarget | null): void => {
      if (doneRef.current) return
      doneRef.current = true
      if (text !== null && dirtyRef.current && text !== initial) onSave(text)
      onClose(restoreFocus, outside)
    },
    [initial, onSave, onClose],
  )

  /** 글자만큼 늘린다 — 스크롤 막대 없이 전부 보이게. */
  const grow = (input: HTMLTextAreaElement): void => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }

  useEffect(() => {
    if (inputRef.current) grow(inputRef.current)
  }, [])

  // 바깥을 누르면 저장하고 닫는다 — 크롬 버튼은 mousedown 을 막아 blur 가 오지 않으므로 blur 만으로는 닫히지 않는다.
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node) || isTrigger?.(event.target)) return
      finish(inputRef.current?.value ?? null, false, event.target)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [finish, isTrigger])

  useEffect(() => {
    if (!closeRef) return
    closeRef.current = (restoreFocus) => finish(inputRef.current?.value ?? null, restoreFocus)
    return () => {
      closeRef.current = null
    }
  }, [closeRef, finish])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault()
      finish(event.currentTarget.value, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      finish(null, true)
    }
  }

  return (
    <div
      ref={rootRef}
      // 안의 포커스를 받지 않는 자리(안내문 · 틈)를 눌러도 입력칸이 포커스를 지킨다 — 잃으면 blur 가 저장하고 닫았다(8a-2 리뷰).
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault()
      }}
      data-testid="code-caption-editor"
      className="absolute z-30 flex flex-col gap-1"
      style={{ top, left, width: Math.max(width, 200) }}
    >
      <textarea
        ref={inputRef}
        data-testid="code-caption-input"
        aria-label="코드 캡션"
        aria-describedby={formatted ? noticeId : undefined}
        autoFocus
        rows={1}
        defaultValue={initial}
        maxLength={Math.max(MAX_CAPTION, initial.length)}
        placeholder="캡션을 입력하세요"
        onInput={(e) => {
          dirtyRef.current = true
          grow(e.currentTarget)
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // 창 · 탭을 떠나며 생긴 blur 는 아니다 — 돌아오면 같은 입력칸이 포커스를 되찾는다(쓰던 캡션을 저장하고 닫지 않는다 · 8a-2 리뷰).
          if (!document.hasFocus()) return
          finish(e.currentTarget.value, false)
        }}
        style={{ minHeight }}
        className="w-full resize-none overflow-hidden rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-600 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
      />
      {formatted && (
        <p
          id={noticeId}
          data-testid="code-caption-formatted"
          className="rounded bg-white px-1 text-xs text-neutral-500 dark:bg-neutral-900"
        >
          고치면 캡션의 서식 · 링크가 평문이 됩니다.
        </p>
      )}
    </div>
  )
}
