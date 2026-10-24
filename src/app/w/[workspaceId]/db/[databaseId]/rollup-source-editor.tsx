'use client'

/**
 * 롤업의 관계 · 대상 바꾸기 — 열 머리 메뉴의 편집기 (§7 정리 10n-39 · F-03-11)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 — [보강 10n-31] 고치기 · [보강 10n-39] 관계 · 대상 바꾸기 화면
 *
 * 관계 → 속성 → 계산을 고른다 — 추가 폼과 **같은 규칙**(`resolveRollupSource`: 목록에 없으면 첫째 · 대상은 모을 수 있는 셀 타입만 · 계산은
 * 대상이 고를 수 있으면 그대로, 아니면 기본으로 접힌다). 관계가 대상 표를 정하므로 관계를 고를 때마다 그 표의 속성을 읽는다(늦게 온 옛 답은
 * 버린다). 지금 설정으로 열린다 — 설정이 끊긴 롤업(관계 · 대상이 지워졌다)을 다시 잇는 자리이기도 하다. 관계는 이 표의 **보이는** 관계형
 * 열에서 고른다(추가 폼과 같다 — 숨긴 열은 이 화면이 모른다).
 *
 * 바꾸기는 부르는 쪽이 한다(`onSave` — `PATCH …/rollups/{id}`). 실패하면 이유를 보이고 편집기에 머문다.
 */

import { useEffect, useRef, useState } from 'react'

import { ROLLUP_FUNCTION_LABEL, resolveRollupSource, type RollupFunction } from '@/lib/database/rollup-functions'
import type { PropertySummary } from '@/lib/database/property'
import * as api from './table-api'
import type { RelationChoice } from './add-column'

const FIELD =
  'rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:text-neutral-100'

export type RollupSource = {
  readonly relationPropertyId: string
  readonly targetPropertyId: string
  readonly function: RollupFunction
}

export function RollupSourceEditor({
  workspaceId,
  relations,
  current,
  onSave,
  onClose,
}: {
  workspaceId: string
  /** 이 표의 보이는 관계형 열. */
  relations: readonly RelationChoice[]
  /** 지금 설정 — 이것으로 열린다. */
  current: RollupSource
  /** 바꾼다 — 실패하면 사람이 읽을 이유, 성공하면 null. */
  onSave: (next: RollupSource) => Promise<string | null>
  onClose: () => void
}) {
  const [relationId, setRelationId] = useState(current.relationPropertyId)
  /** 고른 관계의 대상 표의 속성 — `null` 은 아직 받는 중. */
  const [targets, setTargets] = useState<readonly PropertySummary[] | null>(null)
  const [targetId, setTargetId] = useState(current.targetPropertyId)
  const [fn, setFn] = useState<RollupFunction>(current.function)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLSelectElement>(null)
  /** 마지막으로 물은 것 — 늦게 온 옛 답을 버린다(관계를 빨리 바꿔 고를 때). */
  const asked = useRef(0)

  const resolved = resolveRollupSource({ relations, relationId, targets, targetId, fn })

  /** 그 관계의 대상 표의 속성을 묻는다 — 답은 마지막으로 물은 것일 때만 받아들인다. */
  const loadTargets = (choice: RelationChoice | undefined) => {
    const seq = ++asked.current
    if (choice === undefined) return
    void api.readProperties(workspaceId, choice.targetDataSourceId).then((result) => {
      if (seq !== asked.current) return
      if (!result.ok) {
        setError(result.message)
        setTargets([])
        return
      }
      setTargets(result.value)
    })
  }

  // 지금 관계의 대상 표를 읽는다 · 포커스는 첫 칸에(패널의 Escape 가 닿는다)
  useEffect(() => {
    firstRef.current?.focus()
    loadTargets(relations.find((r) => r.propertyId === current.relationPropertyId) ?? relations[0])
    // 열릴 때 한 번 — 그 뒤에는 관계를 고를 때 읽는다(`pickRelation`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickRelation = (id: string) => {
    setRelationId(id)
    setTargets(null)
    setError(null)
    loadTargets(relations.find((r) => r.propertyId === id))
  }

  const incomplete = resolved.relation === undefined || resolved.target === undefined

  return (
    <form
      data-testid="db-rollup-source-editor"
      aria-label="관계 · 대상 바꾸기"
      onSubmit={async (e) => {
        e.preventDefault()
        if (incomplete || busy || resolved.relation === undefined || resolved.target === undefined) return
        setBusy(true)
        setError(null)
        const failure = await onSave({ relationPropertyId: resolved.relation.propertyId, targetPropertyId: resolved.target.id, function: resolved.fn })
        setBusy(false)
        if (failure === null) onClose()
        else setError(failure)
      }}
      className="flex w-64 flex-col gap-2 p-2"
    >
      {relations.length === 0 ? (
        <p className="text-xs text-neutral-500" data-testid="db-rollup-source-no-relation">
          이 표에 보이는 관계형 속성이 없습니다.
        </p>
      ) : (
        <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
          관계
          <select
            ref={firstRef}
            data-testid="db-rollup-source-relation"
            value={resolved.relation?.propertyId ?? ''}
            onChange={(e) => pickRelation(e.target.value)}
            className={FIELD}
          >
            {relations.map((r) => (
              <option key={r.propertyId} value={r.propertyId}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
        속성
        <select
          data-testid="db-rollup-source-target"
          value={resolved.target?.id ?? ''}
          disabled={targets === null || resolved.targetChoices.length === 0}
          onChange={(e) => setTargetId(e.target.value)}
          className={FIELD}
        >
          {targets === null ? (
            <option value="">불러오는 중…</option>
          ) : resolved.targetChoices.length === 0 ? (
            <option value="">모을 수 있는 속성이 없습니다</option>
          ) : (
            resolved.targetChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))
          )}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
        계산
        <select
          data-testid="db-rollup-source-fn"
          value={resolved.fn}
          disabled={resolved.functions.length === 0}
          onChange={(e) => setFn(e.target.value as RollupFunction)}
          className={FIELD}
        >
          {resolved.functions.map((f) => (
            <option key={f} value={f}>
              {ROLLUP_FUNCTION_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <button type="button" data-testid="db-rollup-source-cancel" onClick={onClose} className="rounded px-2 py-0.5 text-sm text-neutral-500">
          취소
        </button>
        <button
          type="submit"
          data-testid="db-rollup-source-save"
          disabled={busy || incomplete}
          className="rounded-md border border-neutral-300 px-2 py-0.5 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          바꾸기
        </button>
      </div>
    </form>
  )
}
