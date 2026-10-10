'use client'

/**
 * 버튼 블록의 설정 — 라벨 · 액션 (자동화 5e-1 · F-08-06)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑰
 *
 * 편집기 밖의 오버레이다(블록 수식의 입력창과 같은 까닭 — 편집기 안에서 입력칸을 열면 PM 과 다툰다). 라벨은 본문의 것이라 저장할 때 편집기
 * 명령으로 Y.Doc 에 쓰고(`onSaveLabel`), 액션은 서버에 쓴다(`PUT …/pages/{pageId}/buttons/{blockId}`). 액션 편집은 버튼 속성 · DB
 * automation 과 같은 부품이다 — **일하는 행이 없다**(`dataSourceId` 빈 글 · 값 바꾸기 · 보낼 속성이 서지 않는다).
 *
 * 꺼진 버튼(웹훅이 네 번 실패해 멈췄다)이면 까닭과 "다시 켜기"를 둔다(⑮ 와 같다).
 */

import { useEffect, useState } from 'react'

import { ActionListEditor, toAction, toDraft, type ActionDraft } from '../db/[databaseId]/action-editor'
import { buttonActionProblemMessage, buttonDisabledMessage } from '../db/[databaseId]/button-messages'
import type { ButtonActionJson } from '../db/[databaseId]/table-api'
import { MAX_BUTTON_LABEL } from '@/lib/block/button'

type State = { readonly actions: readonly ButtonActionJson[]; readonly enabled: boolean; readonly disabledReason: string | null }

const urlOf = (workspaceId: string, pageId: string, blockId: string) => `/api/workspaces/${workspaceId}/pages/${pageId}/buttons/${blockId}`

const FAILED: Record<string, string> = {
  forbidden: '이 페이지를 고칠 권한이 없습니다.',
  locked: '페이지가 잠겨 있어 고칠 수 없습니다.',
  not_found: '버튼을 찾을 수 없습니다. 그사이 지워졌을 수 있습니다.',
}

export function ButtonBlockSettings({
  workspaceId,
  pageId,
  blockId,
  initialLabel,
  onSaveLabel,
  onClose,
}: {
  workspaceId: string
  pageId: string
  blockId: string
  initialLabel: string
  onSaveLabel: (label: string) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(initialLabel)
  const [drafts, setDrafts] = useState<readonly ActionDraft[] | null>(null)
  /** 꺼졌으면 그 까닭(사람이 껐으면 null) — 켜져 있으면 undefined. */
  const [off, setOff] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void fetch(urlOf(workspaceId, pageId, blockId))
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (State & { error?: string }) | null
        if (!alive) return
        if (!res.ok || body === null) {
          setError(FAILED[body?.error ?? ''] ?? '버튼 설정을 읽지 못했습니다.')
          return
        }
        setDrafts(body.actions.map(toDraft))
        setOff(body.enabled ? undefined : body.disabledReason)
      })
      .catch(() => alive && setError('연결에 실패했습니다.'))
    return () => {
      alive = false
    }
  }, [workspaceId, pageId, blockId])

  const save = async () => {
    if (drafts === null) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(urlOf(workspaceId, pageId, blockId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actions: drafts.map(toAction) }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string; problem?: string; index?: number } | null
      if (!res.ok) {
        setError(body?.error === 'invalid_action' ? buttonActionProblemMessage(body.problem, body.index) : (FAILED[body?.error ?? ''] ?? '저장하지 못했습니다.'))
        return
      }
      // 라벨은 본문의 것 — 편집기 명령으로(같은 라벨이면 쓰지 않는다)
      onSaveLabel(label)
      onClose()
    } catch {
      setError('연결에 실패했습니다. 버튼 설정이 저장되지 않았습니다.')
    } finally {
      setBusy(false)
    }
  }

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(urlOf(workspaceId, pageId, blockId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
      if (res.ok) setOff(undefined)
      else setError('다시 켜지 못했습니다.')
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-24" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label="버튼 설정"
        data-testid="button-block-settings"
        className="flex max-h-[32rem] w-[32rem] flex-col gap-2 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
      >
        <label className="flex items-center gap-1">
          <span className="w-10 shrink-0 text-neutral-500">이름</span>
          <input
            type="text"
            aria-label="버튼 이름"
            data-testid="button-block-label"
            value={label}
            maxLength={MAX_BUTTON_LABEL}
            placeholder="버튼"
            onChange={(e) => setLabel(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        {off !== undefined && (
          <div role="note" data-testid="button-block-disabled" className="flex items-center gap-2 rounded bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span className="min-w-0 flex-1">{buttonDisabledMessage(off)}</span>
            <button
              type="button"
              data-testid="button-block-enable"
              disabled={busy}
              onClick={() => void enable()}
              className="shrink-0 rounded border border-amber-400 px-2 py-0.5 hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900"
            >
              다시 켜기
            </button>
          </div>
        )}
        <p className="font-semibold">누르면</p>
        {drafts === null ? (
          <p className="text-neutral-500">{error ?? '읽는 중…'}</p>
        ) : (
          <ActionListEditor
            workspaceId={workspaceId}
            dataSourceId=""
            drafts={drafts}
            onChange={setDrafts}
            editLabel="값 바꾸기"
            rowLabel="누른 행"
            testIdPrefix="button-block"
          />
        )}
        {error !== null && drafts !== null && (
          <p role="alert" data-testid="button-block-error" className="text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-1">
          <button type="button" data-testid="button-block-cancel" onClick={onClose} className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            취소
          </button>
          <button
            type="button"
            data-testid="button-block-save"
            disabled={busy || drafts === null}
            onClick={() => void save()}
            className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
