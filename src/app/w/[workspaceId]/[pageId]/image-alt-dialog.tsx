'use client'

/**
 * 이미지의 대체 텍스트 — 대화상자 (플랫폼 잔여 10d-1b · F-12-13)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 이미지의 대체 텍스트 ⑤
 *
 * 편집기 밖의 오버레이다(버튼 블록 설정과 같은 까닭 — 편집기 안에서 입력칸을 열면 PM 과 다툰다). 글 칸(대체 텍스트 · 1000자 — 스크린 리더가
 * 읽는 말 · 캡션과 따로) · "장식 이미지"(고르면 글 칸이 잠긴다 — 스크린 리더가 건너뛴다) · 저장 · 취소. `Esc` 는 저장하지 않고 닫는다 ·
 * `Ctrl/Cmd+Enter` 는 저장. 열면 글 칸에 포커스. 저장 · 닫기 뒤의 포커스는 부르는 쪽(편집기)이 돌려받는다.
 */

import { useEffect, useId, useRef, useState } from 'react'

import { MAX_ALT_TEXT, type ImageAlt } from '@/lib/block/image'

const BUTTON = 'rounded-md border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

export function ImageAltDialog({ initial, onSave, onClose }: { initial: ImageAlt; onSave: (alt: ImageAlt) => void; onClose: () => void }) {
  const [text, setText] = useState(initial.text)
  const [decorative, setDecorative] = useState(initial.decorative)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const helpId = useId()

  useEffect(() => {
    textRef.current?.focus()
  }, [])

  const save = () => onSave({ text, decorative })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="image-alt-dialog"
        className="flex w-full max-w-md flex-col gap-3 rounded-lg bg-white p-4 shadow-2xl dark:bg-neutral-900"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            save()
          }
        }}
      >
        <h2 id={titleId} className="text-base font-medium">
          대체 텍스트
        </h2>
        <p id={helpId} className="text-xs text-neutral-500">
          화면을 읽어 주는 프로그램이 이 그림 대신 읽는 말입니다. 그림 아래에 보이는 캡션과 따로입니다.
        </p>
        <textarea
          ref={textRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_ALT_TEXT}
          rows={3}
          disabled={decorative}
          aria-label="대체 텍스트"
          aria-describedby={helpId}
          data-testid="image-alt-text"
          className="w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={decorative} onChange={(event) => setDecorative(event.target.checked)} data-testid="image-alt-decorative" />
          장식 이미지 — 읽을 말이 없다(화면을 읽어 주는 프로그램이 건너뛴다)
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} data-testid="image-alt-cancel" className={BUTTON}>
            취소
          </button>
          <button type="button" onClick={save} data-testid="image-alt-save" className={`${BUTTON} bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900`}>
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
