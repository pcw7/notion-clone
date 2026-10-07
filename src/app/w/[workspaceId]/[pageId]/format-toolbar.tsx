/**
 * 서식 툴바 — 고른 글자 위 (Phase 2 1e-2 · F-01-03 · F-01-21 시나리오 5 · 화면)
 *
 * ⚠ `'use client'` 를 달지 않는다 — `block-gutter.tsx` 와 같은 이유(이미 클라이언트 그래프 안이고, 함수 props 는 경계를 넘지 못한다).
 *
 * 언제 서는지 · 무엇이 켜졌는지 · 링크 주소를 어떻게 다듬는지는 `lib/editor/format-toolbar.ts` 가 정한다. 여기서는 그리고, 누르면 그
 * 명령을 부르고, 편집기의 선택을 지킨다.
 *
 *   · 버튼을 눌러도 편집기의 선택이 남는다 — 누르는 순간의 기본 동작(포커스 옮기기)을 막는다. 링크 입력칸만 포커스를 받는다
 *   · 색 — 글자색 10(기본 포함) · 배경색 9. 고르면 그 범위만(인라인 · 블록 색과 다른 계층) · 마지막 색으로 기억한다(Ctrl/Cmd+Shift+H)
 *   · 링크 — 입력칸(지금 링크가 기본값) · Enter 로 걸고 비우면 뗀다 · Esc 로 닫는다 · 받을 수 없는 주소는 이유를 말한다. Ctrl/Cmd+K 도 이
 *     입력칸을 연다(`linkRequest`)
 *   · 수식 — 고른 글자를 인라인 수식으로(`insertInlineEquationCommand` 와 같다 — 입력창이 열린다)
 *   · 버튼은 탭 순서에 두지 않는다 — 키보드 길은 단축키다(Mod-B · I · U · Shift-S · E · K · Shift-E · Shift-H)
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { EditorView } from '@tiptap/pm/view'

import { COLORS, type Color } from '@/lib/contracts/rich-text'
import { colorLabel } from '@/lib/editor/color-names'
import { FORMAT_BUTTONS, normalizeLinkInput, type FormatToolbarState } from '@/lib/editor/format-toolbar'
import { rememberColor } from '@/lib/editor/last-color'
import { setLink, setTextColor, toggleFormat } from '@/lib/editor/marks'

/** 툴바가 설 자리 — 프레임 기준. 고른 범위의 위 · 아래 경계와 가운데. */
export type FormatToolbarAt = { readonly top: number; readonly bottom: number; readonly center: number }

const TEXT_COLORS: readonly Color[] = COLORS.filter((c) => !c.endsWith('_background'))
const BACKGROUND_COLORS: readonly Color[] = COLORS.filter((c) => c.endsWith('_background'))

export function FormatToolbar({
  view,
  at,
  state,
  linkRequest,
  onEquation,
}: {
  view: EditorView
  at: FormatToolbarAt
  state: FormatToolbarState
  /** 늘어날 때마다 링크 입력칸을 연다(Ctrl/Cmd+K). */
  linkRequest: number
  /** 고른 글자를 인라인 수식으로. */
  onEquation: () => void
}) {
  const [mode, setMode] = useState<'buttons' | 'colors' | 'link'>('buttons')
  const [linkError, setLinkError] = useState<string | null>(null)
  const lastRequest = useRef(linkRequest)

  // Ctrl/Cmd+K — 입력칸을 연다. 처음 그릴 때의 값은 지난 요청이다.
  useEffect(() => {
    if (linkRequest === lastRequest.current) return
    lastRequest.current = linkRequest
    setLinkError(null)
    setMode('link')
  }, [linkRequest])

  const run = (command: (s: EditorView['state'], d: EditorView['dispatch']) => boolean): void => {
    command(view.state, view.dispatch.bind(view))
  }

  const submitLink = (raw: string): void => {
    const result = normalizeLinkInput(raw)
    if (!result.ok) {
      setLinkError(result.reason === 'scheme' ? 'http · https · mailto 주소만 걸 수 있습니다.' : '주소가 너무 깁니다.')
      return
    }
    run(setLink(result.href))
    setMode('buttons')
    view.focus()
  }

  const onLinkKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitLink(event.currentTarget.value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setMode('buttons')
      view.focus()
    }
  }

  // 위에 자리가 없으면 아래로.
  const above = at.top > 48
  return (
    <div
      role="toolbar"
      aria-label="서식"
      className="blk-format-toolbar"
      data-placement={above ? 'above' : 'below'}
      style={{ top: above ? at.top - 8 : at.bottom + 8, left: at.center }}
      // 편집기의 선택을 지킨다 — 입력칸만 포커스를 받는다.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      {mode === 'buttons' && (
        <>
          {FORMAT_BUTTONS.map((b) => (
            <button
              key={b.mark}
              type="button"
              tabIndex={-1}
              aria-label={b.label}
              aria-pressed={state.formats.includes(b.mark)}
              title={`${b.label} (${b.shortcut.replace('Mod', 'Ctrl')})`}
              className="blk-format-button"
              data-mark={b.mark}
              onClick={() => run(toggleFormat(b.mark))}
            >
              {b.glyph}
            </button>
          ))}
          <span aria-hidden className="blk-format-sep" />
          <button type="button" tabIndex={-1} aria-label="링크" aria-pressed={state.link !== null} title="링크 (Ctrl+K)" className="blk-format-button" onClick={() => {
            setLinkError(null)
            setMode('link')
          }}>
            🔗
          </button>
          <button type="button" tabIndex={-1} aria-label="수식" title="수식 (Ctrl+Shift+E)" className="blk-format-button" onClick={onEquation}>
            √x
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="색"
            aria-haspopup="menu"
            title="색"
            className="blk-format-button"
            data-color={state.color === 'default' ? undefined : state.color}
            onClick={() => setMode('colors')}
          >
            A ▾
          </button>
        </>
      )}

      {mode === 'colors' && (
        <div role="menu" aria-label="색" className="blk-format-colors">
          {[['글자색', TEXT_COLORS], ['배경색', BACKGROUND_COLORS]].map(([title, list]) => (
            <div key={title as string} className="blk-format-color-group">
              <span className="blk-format-color-title">{title as string}</span>
              {(list as readonly Color[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  tabIndex={-1}
                  role="menuitemradio"
                  aria-checked={state.color === c}
                  aria-label={colorLabel(c)}
                  title={colorLabel(c)}
                  className="blk-format-color"
                  onClick={() => {
                    run(setTextColor(c))
                    rememberColor(c)
                    setMode('buttons')
                  }}
                >
                  <span aria-hidden className="blk-menu-swatch" data-color={c}>
                    가
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {mode === 'link' && (
        <div className="blk-format-link">
          <input
            // 열릴 때 곧바로 친다 — 마우스 · Ctrl/Cmd+K 둘 다.
            autoFocus
            type="text"
            aria-label="링크 주소"
            placeholder="주소를 넣고 Enter · 비우면 링크를 뗀다"
            defaultValue={state.link ?? ''}
            className="blk-format-link-input"
            onKeyDown={onLinkKey}
            onChange={() => setLinkError(null)}
          />
          {linkError !== null && (
            <span role="alert" className="blk-format-link-error">
              {linkError}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
