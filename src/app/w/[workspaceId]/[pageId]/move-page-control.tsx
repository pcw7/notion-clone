'use client'

/**
 * "이동" — F-02-08 의 목적지 피커.
 *
 * 사이드바 드래그 앤 드롭(W5-b)이 같은 연산의 다른 진입점이 된다. 그래서
 * 이 컴포넌트는 **목록과 호출만** 하고, 어디로 옮길 수 있는지는 서버가 정한다
 * (`listMovableTargets` · `listTeamspaceDestinations`). 자손 제외 · 권한 규칙이 화면과 서버 양쪽에 있으면
 * 언젠가 어긋나고, 그때 화면은 고를 수 있는데 서버는 거부하는 상태가 된다.
 *
 * 경로 라벨도 서버가 준다 — 볼 수 있는 조상의 제목만 온다. 후보 목록에서 조상 제목을 찾던 예전 방식은 볼 수 없는 조상을
 * 후보에 넣어야 성립했다(그래서 제목이 샜다).
 *
 * 7c-3: 자리는 페이지 · **워크스페이스 최상위 · teamspace 최상위** 셋이다. 뒤의 둘에는 옮기면 누가 보는지를 한 줄로 붙인다
 * (06 F-06-20 — 이동은 권한 전이다). 뿌리가 바뀌는 이동에 전체 권한이 없으면 서버가 거부하고 그 까닭을 말한다(`move-messages.ts`).
 *
 * 7c-13: 자리를 누르면 **먼저 미리보기를 받는다**(`…/move/preview` — 서버가 실제로 옮겨 보고 되돌린 결과). 볼 수 있는 사람이
 * 바뀌면 누가 못 보게 되고 누가 새로 보는지, 따로 공유된 하위 페이지가 여전히 열려 있는지를 보이고 **한 번 더 묻는다**. 바뀌지
 * 않으면 곧바로 옮긴다(`moveNeedsConfirm`). 미리보기가 거부하면 그 까닭을 말한다 — 옮기기와 같은 거부다.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { teamspaceIcon } from '../teamspace-messages'
import { moveFailureMessage, moveNeedsConfirm, movePreviewLines, type MovePreviewView } from './move-messages'

type MoveBody = { targetParentId: string | null } | { targetTeamspaceId: string } | { targetPrivate: true }

export type MoveTargetOption = {
  id: string
  title: string
  /** 루트→부모 순서의 볼 수 있는 조상 제목. */
  path: string[]
}

export type MoveTeamspaceOption = { id: string; name: string; icon: string | null }

const UNTITLED = '제목 없음'
const OPTION =
  'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'

export function MovePageControl({
  workspaceId,
  pageId,
  currentParentId,
  currentTeamspaceId,
  currentPrivate = false,
  targets,
  teamspaces,
}: {
  workspaceId: string
  pageId: string
  currentParentId: string | null
  /** 지금 teamspace 의 최상위에 있으면 그 teamspace. */
  currentTeamspaceId: string | null
  /** 지금 **내 개인 최상위**에 있는가(7c-7). 워크스페이스 최상위와 부모가 같아서(`workspace`) 따로 받는다. */
  currentPrivate?: boolean
  targets: MoveTargetOption[]
  /** 옮길 수 있는 teamspace 최상위(내가 둘 수 있는 것만). */
  teamspaces: MoveTeamspaceOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 확인을 기다리는 이동 — 미리보기가 볼 수 있는 사람이 바뀐다고 했다. */
  const [pending, setPending] = useState<{ body: MoveBody; preview: MovePreviewView } | null>(null)

  // ⚠ 개인 최상위도 부모는 워크스페이스다(판결문 C-9) — 주인까지 봐야 "현재 위치"가 맞는다(7c-7).
  const atWorkspaceRoot = currentParentId === null && currentTeamspaceId === null && !currentPrivate
  const q = filter.trim().toLowerCase()

  const rows = useMemo(() => {
    const withPath = targets.map((t) => ({
      ...t,
      label: t.title || UNTITLED,
      path: t.path.map((title) => title || UNTITLED).join(' / '),
    }))
    if (q === '') return withPath
    return withPath.filter((t) => t.label.toLowerCase().includes(q) || t.path.toLowerCase().includes(q))
  }, [targets, q])

  const teamspaceRows = q === '' ? teamspaces : teamspaces.filter((t) => t.name.toLowerCase().includes(q))

  /** 요청 하나 — 거부되면 문구를 세우고 null. */
  async function post(path: string, body: MoveBody): Promise<Record<string, unknown> | null> {
    const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      setError(moveFailureMessage(data.error))
      return null
    }
    return data
  }

  async function act(run: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const commit = async (body: MoveBody) => {
    if ((await post('move', body)) === null) return
    setPending(null)
    setOpen(false)
    setFilter('')
    router.refresh()
  }

  /** 자리를 골랐다 — 미리보기를 받고, 볼 수 있는 사람이 바뀌면 묻고, 아니면 곧바로 옮긴다. */
  const choose = (body: MoveBody) =>
    act(async () => {
      const data = await post('move/preview', body)
      if (data === null) return
      const preview = data.preview as MovePreviewView
      if (moveNeedsConfirm(preview)) setPending({ body, preview })
      else await commit(body)
    })

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setPending(null)
        }}
        aria-expanded={open}
        data-testid="move-open"
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        이동
      </button>

      {open && (
        <div
          data-testid="move-picker"
          className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {pending !== null ? (
            <div data-testid="move-preview" className="flex flex-col gap-2 p-1">
              <p className="text-sm font-medium">옮기면 이 페이지를 볼 수 있는 사람이 바뀝니다</p>
              <ul className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
                {movePreviewLines(pending.preview).map((line) => (
                  <li key={line.key} data-testid={`move-preview-${line.key}`}>
                    {line.text}
                  </li>
                ))}
              </ul>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="move-preview-confirm"
                  disabled={busy}
                  onClick={() => void act(() => commit(pending.body))}
                  className="rounded border border-neutral-900 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-100"
                >
                  옮기기
                </button>
                <button
                  type="button"
                  data-testid="move-preview-cancel"
                  disabled={busy}
                  onClick={() => setPending(null)}
                  className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
                >
                  다른 곳 고르기
                </button>
              </span>
            </div>
          ) : (
            <>
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="페이지 · teamspace 검색"
                aria-label="이동할 위치 검색"
                className="mb-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
              />

              <ul className="max-h-64 overflow-auto">
                {!atWorkspaceRoot && (
                  <li>
                    <button
                      type="button"
                      disabled={busy}
                      data-testid="move-to-workspace"
                      onClick={() => void choose({ targetParentId: null })}
                      className={OPTION}
                    >
                      워크스페이스 최상위
                      <span className="block text-xs text-neutral-400">워크스페이스 모든 멤버가 봅니다</span>
                    </button>
                  </li>
                )}

                {(q === '' || '개인 페이지'.includes(q)) && (
                  <li>
                    <button
                      type="button"
                      disabled={busy || currentPrivate}
                      data-testid="move-to-private"
                      onClick={() => void choose({ targetPrivate: true })}
                      className={OPTION}
                    >
                      <span aria-hidden className="mr-1 text-neutral-400">
                        ⚿
                      </span>
                      개인 페이지
                      {currentPrivate ? (
                        <span className="ml-2 text-xs text-neutral-400">현재 위치</span>
                      ) : (
                        <span className="block text-xs text-neutral-400">나만 봅니다 — 이 페이지에 따로 준 공유가 걷힙니다</span>
                      )}
                    </button>
                  </li>
                )}

                {teamspaceRows.map((t) => (
                  <li key={`teamspace:${t.id}`}>
                    <button
                      type="button"
                      disabled={busy || t.id === currentTeamspaceId}
                      data-testid="move-to-teamspace"
                      data-teamspace-id={t.id}
                      onClick={() => void choose({ targetTeamspaceId: t.id })}
                      className={OPTION}
                    >
                      <span aria-hidden className="mr-1 text-neutral-400">
                        {teamspaceIcon(t.icon)}
                      </span>
                      {t.name}
                      {t.id === currentTeamspaceId ? (
                        <span className="ml-2 text-xs text-neutral-400">현재 위치</span>
                      ) : (
                        <span className="block text-xs text-neutral-400">{t.name} 멤버가 봅니다</span>
                      )}
                    </button>
                  </li>
                ))}

                {rows.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={busy || t.id === currentParentId}
                      data-testid="move-to-page"
                      data-page-id={t.id}
                      onClick={() => void choose({ targetParentId: t.id })}
                      className={OPTION}
                    >
                      {t.label}
                      {t.id === currentParentId && (
                        <span className="ml-2 text-xs text-neutral-400">현재 위치</span>
                      )}
                      {t.path !== '' && (
                        <span className="block truncate text-xs text-neutral-400">{t.path}</span>
                      )}
                    </button>
                  </li>
                ))}

                {rows.length === 0 && teamspaceRows.length === 0 && (
                  <li className="px-2 py-3 text-center text-sm text-neutral-400">
                    옮길 수 있는 곳이 없습니다
                  </li>
                )}
              </ul>
            </>
          )}

          {error && (
            <p role="alert" data-testid="move-error" className="mt-1 px-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
