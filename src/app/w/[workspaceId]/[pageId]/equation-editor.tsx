/**
 * 블록 수식의 입력창 — 편집기 밖의 입력칸 + 실시간 미리보기 (Phase 2 1a · F-01-20)
 *
 * ⚠ `'use client'` 를 달지 않는다 — `code-caption-editor.tsx` 와 같은 이유(편집기 화면만 쓴다).
 *
 * 블록 바로 아래에 겹쳐 그리지만 **편집기 밖**이다(코드 캡션과 같은 까닭 — 한글 조합 · 키가 편집기로 새지 않고, 노드 뷰가 새로 만들어져도
 * 쓰던 식이 남는다).
 *
 *   · 여러 줄 입력칸 — 긴 식은 줄을 나눠 쓴다(줄바꿈은 수식 모드에서 공백이다). 글자만큼 늘어난다
 *   · **쓰는 동안 미리 그린다**(F-01-20 *"입력 중 실시간 프리뷰"*) — 블록 자체는 저장할 때 바뀐다(글자마다 Y.Doc 을 쓰지 않는다). 틀린
 *     식은 까닭을 붉게 보이고 그래도 저장할 수 있다(F-01-20 — 저장은 유지)
 *   · Enter · "완료" · 바깥 누르기(blur 포함)로 저장, Shift+Enter 는 줄바꿈, Esc 는 저장하지 않고 닫는다. 한글 조합 중의 Enter 는 조합의 것
 *   · **고친 것만 쓴다** — 입력이 있었고 연 순간의 식과 다를 때만(연 뒤에 다른 참여자가 바꾼 식을 되돌리지 않는다 · props 통째 LWW)
 *   · 저장은 한 번뿐이다 · 길이는 입력칸이 막는다(`MAX_EQUATION_LENGTH` — 받은 식이 더 길면 그 길이까지)
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from 'react'

import { MAX_EQUATION_LENGTH } from '@/lib/block/equation'
import { loadKatex, renderEquation, type EquationRender } from '@/lib/editor/equation-render'

export type EquationEditorProps = {
  /** 인라인 수식인가(1b) — 미리보기를 글자 사이의 모양으로 그린다 · 이름이 달라진다. */
  inline?: boolean
  /** 연 순간의 식. */
  initial: string
  /** 프레임 기준 좌표 · 폭. */
  top: number
  left: number
  width: number
  onSave: (text: string) => void
  /** 닫는다 — `restoreFocus`: 편집기로 포커스를 돌려줄 것인가. `outside`: 바깥을 눌러 닫았으면 누른 곳. */
  onClose: (restoreFocus: boolean, outside?: EventTarget | null) => void
  /** 부르는 쪽이 이 입력을 닫게 하는 길(블록을 다시 눌렀을 때) — 쓰던 식은 저장한다. */
  closeRef?: MutableRefObject<((restoreFocus: boolean) => void) | null>
  /** 이 입력을 연 블록인가 — 바깥 누르기가 건너뛴다(블록의 click 이 닫는다). */
  isTrigger?: (target: EventTarget | null) => boolean
}

/** 미리보기 — 비었으면 null. */
type Preview = EquationRender | null

export function EquationEditor({ inline = false, initial, top, left, width, onSave, onClose, closeRef, isTrigger }: EquationEditorProps) {
  const doneRef = useRef(false)
  const dirtyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [text, setText] = useState(initial)
  const [preview, setPreview] = useState<Preview>(null)

  const finish = useCallback(
    (value: string | null, restoreFocus: boolean, outside?: EventTarget | null): void => {
      if (doneRef.current) return
      doneRef.current = true
      if (value !== null && dirtyRef.current && value !== initial) onSave(value)
      onClose(restoreFocus, outside)
    },
    [initial, onSave, onClose],
  )

  /** 글자만큼 늘린다. */
  const grow = (input: HTMLTextAreaElement): void => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    grow(input)
    // 캐럿은 끝에 — 이어 쓰는 일이 가장 흔하다.
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])

  // 미리 그리기 — KaTeX 는 처음 쓸 때 불러 온다. 늦게 온 결과가 새 글자를 덮지 않게 그때의 글자인지 본다.
  useEffect(() => {
    let current = true
    if (text.trim() === '') {
      void Promise.resolve().then(() => {
        if (current) setPreview(null)
      })
      return () => {
        current = false
      }
    }
    void loadKatex(text).then(
      (katex) => {
        if (current) setPreview(renderEquation(katex, text, !inline))
      },
      () => {
        if (current) setPreview({ ok: false, message: '미리보기를 불러 오지 못했습니다' })
      },
    )
    return () => {
      current = false
    }
  }, [text, inline])

  // 바깥을 누르면 저장하고 닫는다.
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
    if (event.key === 'Enter' && !event.shiftKey) {
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
      // 포커스를 받지 않는 자리(미리보기 · 틈)를 눌러도 입력칸이 포커스를 지킨다 — 잃으면 blur 가 저장하고 닫는다.
      onMouseDown={(e) => {
        if (e.target !== inputRef.current && !(e.target instanceof HTMLButtonElement)) e.preventDefault()
      }}
      data-testid="equation-editor"
      className="absolute z-30 flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{ top, left, width: Math.max(Math.min(width, 560), 280) }}
    >
      <div className="flex items-start gap-2">
        <textarea
          ref={inputRef}
          data-testid="equation-input"
          aria-label={inline ? '인라인 수식(KaTeX)' : '수식(KaTeX)'}
          autoFocus
          rows={1}
          value={text}
          maxLength={Math.max(MAX_EQUATION_LENGTH, initial.length)}
          placeholder="E = mc^2"
          spellCheck={false}
          onChange={(e) => {
            dirtyRef.current = true
            setText(e.currentTarget.value)
            grow(e.currentTarget)
          }}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            // 창 · 탭을 떠나며 생긴 blur 는 아니다(돌아오면 같은 입력칸이 포커스를 되찾는다).
            if (!document.hasFocus()) return
            finish(e.currentTarget.value, false)
          }}
          className="min-h-8 flex-1 resize-none overflow-hidden rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-sm text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
        />
        <button
          type="button"
          data-testid="equation-done"
          onClick={() => finish(inputRef.current?.value ?? null, true)}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          완료
        </button>
      </div>
      {preview !== null && preview.ok && (
        <div
          data-testid="equation-preview"
          className="blk-equation-render overflow-x-auto"
          // KaTeX 의 출력 — `trust: false` 라 링크 · 이미지 · 속성을 만들지 않는다(`equation-render.ts`).
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      )}
      {preview !== null && !preview.ok && (
        <p data-testid="equation-preview-error" role="status" className="text-xs text-red-600 dark:text-red-400">
          {preview.message}
        </p>
      )}
    </div>
  )
}
