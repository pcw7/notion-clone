'use client'

/**
 * 페이지 머리의 아이콘 — 보이기 · 추가 · 바꾸기 · 제거 (잔여 묶음 8c-1 · F-02-05)
 *
 * 데이터베이스 머리도 이것을 쓴다(8c-3b · `kind="database"`) — 저장하는 길(`databases/{id}` 의 `PATCH`)과 거부의 말만 다르다. 권한은
 * 이름과 같다(`edit_structure` · 데이터베이스 잠금 — `setDatabaseIcon`).
 *
 * 노션과 같은 흐름이다(F-02-05 시나리오):
 *   · 아이콘이 없으면 제목 위에 **"아이콘 추가"** — 마우스를 올리거나 포커스가 있을 때 보인다. 누르면 **무작위 이모지를 곧바로**
 *     단다(고르개를 열지 않는다 — 노션의 Add icon)
 *   · 아이콘을 누르면 고르개(`emoji-picker.tsx`) — 고르면 닫고, 무작위는 연 채로 바꾸고, 제거하면 닫는다
 *   · 고칠 수 없으면(권한 · 잠금) 아이콘만 보인다 — 버튼이 아니다. 서버도 거부한다(`setPageIcon`)
 *
 * 이미지 아이콘(8c-4)도 같은 고르개의 "이미지" 탭에서 고른다 — 파일을 올리거나(먼저 올리고 그 파일 id 를 아이콘으로) 이미지 주소를 넣는다.
 *
 * 저장은 고를 때마다 곧바로(`PATCH` 의 `icon`) — 화면은 먼저 바꾸고, 거부되면 마지막으로 저장된 값으로 되돌리고 까닭을 말한다. 저장되면
 * 서버 렌더(사이드바 · 경로)를 다시 그린다(`router.refresh` — 제목과 같다). 다른 곳에서 바뀌어 서버가 새 값을 주면 따라간다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { DATABASE_GLYPH, PAGE_GLYPH, pageIconLabel, samePageIcon, type PageIcon } from '@/lib/block/page-icon'
import { randomEmoji } from '@/lib/emoji/catalog'
import { EmojiPicker } from './emoji-picker'
import { loadEmojiCatalog } from './emoji-catalog-loader'
import { PageIconView } from '../page-icon-view'

type IconOwner = 'page' | 'database'

const MESSAGES: Record<IconOwner, Record<string, string>> = {
  page: {
    locked: '잠긴 페이지입니다 — 잠금을 풀어야 아이콘을 바꿀 수 있습니다.',
    forbidden: '이 페이지를 고칠 권한이 없습니다.',
    invalid_icon: '아이콘은 이모지 한 글자 · 이 워크스페이스에 올린 이미지 · 이미지 주소여야 합니다.',
  },
  database: {
    locked: '잠긴 데이터베이스입니다 — 잠금을 풀어야 아이콘을 바꿀 수 있습니다.',
    forbidden: '이 데이터베이스의 구조를 고칠 권한이 없습니다.',
    invalid_icon: '아이콘은 이모지 한 글자 · 이 워크스페이스에 올린 이미지 · 이미지 주소여야 합니다.',
  },
}

const OWNER_LABEL: Record<IconOwner, string> = { page: '페이지', database: '데이터베이스' }

export function PageIconControl({
  workspaceId,
  pageId,
  kind = 'page',
  initialIcon,
  readOnly = false,
}: {
  workspaceId: string
  /** 아이콘의 주인 — 페이지(행 · 템플릿 포함) 또는 데이터베이스의 id. */
  pageId: string
  kind?: IconOwner
  initialIcon: PageIcon | null
  /** 고칠 수 없다 — 볼 수만 있거나 잠긴 페이지 · 데이터베이스. */
  readOnly?: boolean
}) {
  const router = useRouter()
  const [icon, setIcon] = useState<PageIcon | null>(initialIcon)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 마지막으로 서버에 반영된 값. */
  const saved = useRef<PageIcon | null>(initialIcon)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  /** 제거한 뒤 — 고르개와 아이콘 버튼이 사라지고 "아이콘 추가"가 선다. 그리로 포커스를 옮긴다(아니면 body 에 떨어진다). */
  const focusAfterRender = useRef(false)

  useEffect(() => {
    if (!focusAfterRender.current) return
    focusAfterRender.current = false
    triggerRef.current?.focus()
  })

  // 다른 곳에서 바뀌어 서버 렌더가 새 값을 주면 따라간다(제목과 같은 규칙 — 저장된 값이 달라졌을 때만).
  useEffect(() => {
    if (!samePageIcon(initialIcon, saved.current)) {
      saved.current = initialIcon
      setIcon(initialIcon)
    }
  }, [initialIcon])

  const save = useCallback(
    async (next: PageIcon | null): Promise<void> => {
      if (readOnly) return
      setError(null)
      setIcon(next)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/${kind === 'database' ? 'databases' : 'pages'}/${pageId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ icon: next }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: unknown }
          setError(MESSAGES[kind][String(data.error)] ?? '아이콘을 저장하지 못했습니다.')
          setIcon(saved.current)
          return
        }
        saved.current = next
        // 사이드바 · 경로가 서버 렌더이므로 다시 그린다.
        router.refresh()
      } catch {
        setError('연결에 실패했습니다.')
        setIcon(saved.current)
      }
    },
    [kind, pageId, readOnly, router, workspaceId],
  )

  /** 무작위 이모지 — 목록을 처음 쓰면 받아 온다. 지금 아이콘은 고르지 않는다. */
  const saveRandom = useCallback(
    async (except: string | null): Promise<void> => {
      setBusy(true)
      try {
        const entry = randomEmoji(await loadEmojiCatalog(), except)
        if (entry !== null) await save({ type: 'emoji', emoji: entry.emoji })
      } catch {
        setError('이모지 목록을 불러오지 못했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [save],
  )

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])
  const isTrigger = useCallback((target: EventTarget | null) => target instanceof Node && !!triggerRef.current?.contains(target), [])

  // 이미지 아이콘은 글자 한 칸의 정사각형으로 그린다(머리의 글자 크기 — 이모지와 같은 자리). 불러오지 못하면 기본 글리프로(단추가 비지 않게).
  const glyph = kind === 'database' ? DATABASE_GLYPH : PAGE_GLYPH
  const face = (shown: PageIcon) => (shown.type === 'emoji' ? shown.emoji : <PageIconView icon={shown} fallback glyph={glyph} />)

  if (readOnly) {
    if (icon === null) return null
    return (
      <div data-testid="page-icon" role="img" aria-label={`${OWNER_LABEL[kind]} 아이콘 ${pageIconLabel(icon)}`} className="w-fit text-6xl leading-none">
        {face(icon)}
      </div>
    )
  }

  return (
    <div className="relative w-fit">
      {icon === null ? (
        <button
          ref={triggerRef}
          type="button"
          data-testid="page-icon-add"
          disabled={busy}
          onClick={() => void saveRandom(null)}
          className="rounded px-1.5 py-0.5 text-sm text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:opacity-100 group-hover/header:opacity-100 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          ☺ 아이콘 추가
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          data-testid="page-icon"
          aria-label={`아이콘 바꾸기 — 지금 ${pageIconLabel(icon)}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded text-6xl leading-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {face(icon)}
        </button>
      )}
      {open && icon !== null && (
        <EmojiPicker
          current={icon.type === 'emoji' ? icon.emoji : null}
          removable
          onPick={(emoji) => {
            close(true)
            void save({ type: 'emoji', emoji })
          }}
          workspaceId={workspaceId}
          onPickImage={(image) => {
            close(true)
            void save(image)
          }}
          onRandom={() => void saveRandom(icon.type === 'emoji' ? icon.emoji : null)}
          onRemove={() => {
            setOpen(false)
            focusAfterRender.current = true
            void save(null)
          }}
          onClose={close}
          isTrigger={isTrigger}
        />
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
