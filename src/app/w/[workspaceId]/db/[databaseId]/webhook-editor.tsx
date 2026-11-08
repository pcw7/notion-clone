'use client'

/**
 * 웹훅 보내기 액션의 편집 칸 — 자동화 5c-3 (F-08-09) · AN-2 에서 `action-editor.tsx` 에서 떼어 지연 로드한다
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 버튼 속성 ⑭ · [보강 AN-2] ③ — 데이터베이스 화면의 번들 예산 때문에 이 액션을 그릴 때만 받는다.
 */

import type { ActionDraft, Field, HeaderDraft } from './action-editor'

/** 웹훅의 헤더 상한(서버 `MAX_WEBHOOK_HEADERS` 와 같다). */
const MAX_HEADERS = 10

/** 웹훅 칸 — 받는 주소 · 헤더 · 보낼 속성(⑭). 저장된 주소 · 헤더 값은 보이지 않는다 — 비워 두면 그대로. */
export default function Webhook({
  p,
  fields,
  draft,
  onChange,
}: {
  p: string
  fields: readonly Field[]
  draft: Extract<ActionDraft, { kind: 'webhook' }>
  onChange: (next: Extract<ActionDraft, { kind: 'webhook' }>) => void
}) {
  const box = 'min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'
  const setHeader = (i: number, next: HeaderDraft | null) =>
    onChange({ ...draft, headers: next === null ? draft.headers.filter((_, j) => j !== i) : draft.headers.map((h, j) => (j === i ? next : h)) })
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1">
        <span className="w-10 shrink-0 text-neutral-500">주소</span>
        <input
          type="url"
          aria-label="받는 주소"
          data-testid={`${p}-webhook-url`}
          value={draft.url}
          placeholder={draft.urlHint === null ? 'https://…' : `지금: ${draft.urlHint} — 비우면 그대로`}
          autoComplete="off"
          onChange={(e) => onChange({ ...draft, url: e.target.value })}
          className={box}
        />
      </label>
      {draft.headers.map((h, i) => (
        <div key={i} className="flex items-center gap-1" data-testid={`${p}-webhook-header`}>
          <input
            type="text"
            aria-label="헤더 이름"
            data-testid={`${p}-webhook-header-name`}
            value={h.name}
            disabled={h.saved}
            onChange={(e) => setHeader(i, { ...h, name: e.target.value })}
            className={`${box} max-w-[8rem]`}
          />
          <input
            type="text"
            aria-label={`${h.name || '헤더'} 값`}
            data-testid={`${p}-webhook-header-value`}
            value={h.value}
            placeholder={h.saved ? '저장된 값 — 비우면 그대로' : '값'}
            autoComplete="off"
            onChange={(e) => setHeader(i, { ...h, value: e.target.value })}
            className={box}
          />
          <button type="button" aria-label="이 헤더 빼기" onClick={() => setHeader(i, null)} className="px-1 text-neutral-400 hover:text-red-600">
            ×
          </button>
        </div>
      ))}
      {draft.headers.length < MAX_HEADERS && (
        <button
          type="button"
          data-testid={`${p}-webhook-add-header`}
          onClick={() => onChange({ ...draft, headers: [...draft.headers, { name: '', value: '', saved: false }] })}
          className="self-start text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          + 헤더
        </button>
      )}
      {fields.length === 0 ? (
        <p className="text-neutral-500">보낼 속성이 없습니다 — 페이지의 id 와 주소만 갑니다.</p>
      ) : (
      <fieldset className="flex flex-col gap-0.5">
        <legend className="text-neutral-500">보낼 속성 — 고르지 않으면 행의 id 와 주소만</legend>
        {fields.map((f) => (
          <label key={f.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              data-testid={`${p}-webhook-property`}
              data-property-id={f.id}
              checked={draft.properties.includes(f.id)}
              onChange={(e) =>
                onChange({ ...draft, properties: e.target.checked ? [...draft.properties, f.id] : draft.properties.filter((x) => x !== f.id) })
              }
            />
            {f.name}
          </label>
        ))}
      </fieldset>
      )}
      <p className="text-neutral-500">
        몸은 <code>{'{ run_id, page, properties }'}</code> — 받는 쪽은 <code>run_id</code> 로 겹친 것을 거르세요. 네 번 실패하면 멈춥니다.
      </p>
    </div>
  )
}
