/**
 * 제안 메타 표의 투영 — 본문의 sid 마크를 `suggestion` 행에 맞춘다 (SG-2 · F-05-12 · 판결 U-2 · 불변식 S8)
 *
 * 정본: 00-canonical-data-model.md 제안 편집 (U-2) · [보강 SG-1] ④ · 마이그레이션 0140
 *
 * 본문 투영과 **같은 트랜잭션**에서 돈다(`block/body-write.ts` `finish` — 곧바로 투영 · 밀린 투영 · 명령 · 통째 저장이 모두 거기를 지난다).
 *
 *   - 문서에 있는데 표에 없는 sid → `open`(종류 · 사람 · 그 글의 앞 80자 · 처음 본 시각)
 *   - 표에서 `open` 인데 문서에 sid 마크가 없다 → `stale`(S8 — 앵커를 잃은 것이 아니라 마크가 사라졌다). 다시 나타나면(되돌리기) `open`
 *   - `accepted` · `rejected` 는 건드리지 않는다 — 수락 · 거절(SG-3)이 쓴다. 다른 페이지의 행도 건드리지 않는다(같은 sid 를 써도)
 *
 * ⚠ 마크는 **참여자가 Y.Doc 에 쓴 값**이다 — sid · author_id 의 모양(uuid)을 보고, 사람은 이 워크스페이스의 활성 멤버여야 넣는다. 아니면
 * 그 마크는 표에 넣지 않는다(던지지 않는다 — 본문 투영을 막지 않는다). author_id 는 **보여 주는 메타**일 뿐이다 — 남의 이름으로 제안을 단 것처럼
 * 보이게 할 수는 있어도, 수락 · 거절은 누른 사람의 편집 권한으로 판정한다(SG-3).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withoutNul } from '../contracts/json-safe.ts'
import type { Tx } from '../db/tx.ts'
import type { SuggestionMark } from '../editor/suggestion-original.ts'
import { isUuid } from '../ids.ts'
import { notifySuggestionsCreated } from '../notification/fanout.ts'

/** 미리보기 길이 — 0140 `ck_suggestion_preview` 와 같다. */
export const SUGGESTION_PREVIEW_CHARS = 80

/** 미리보기 — 그 sid 글의 앞 80자(코드 포인트 — Postgres `char_length` 와 같은 단위). 비었으면 null. */
export function suggestionPreview(text: string): string | null {
  const preview = Array.from(withoutNul(text)).slice(0, SUGGESTION_PREVIEW_CHARS).join('')
  return preview === '' ? null : preview
}

/** 문서의 제안 마크(`readBodyYDoc` 의 `suggestions`)로 이 페이지의 메타 행을 맞춘다. 호출자가 페이지 행을 잠갔다. */
export async function projectSuggestions(
  tx: Tx,
  ctx: SessionContext,
  pageId: string,
  marks: readonly SuggestionMark[],
): Promise<void> {
  // 모양이 맞는 것만 · sid 하나에 한 줄 — 대소문자만 다른 sid 는 같은 uuid 다(한 문장에서 같은 행을 두 번 고치면 던진다)
  const bySid = new Map<string, SuggestionMark>()
  for (const mark of marks) {
    if (!isUuid(mark.sid) || !isUuid(mark.authorId)) continue
    const sid = mark.sid.toLowerCase()
    if (!bySid.has(sid)) bySid.set(sid, mark)
  }
  const sids = [...bySid.keys()]

  await tx.query(
    `UPDATE suggestion SET state = 'stale'
      WHERE page_id = $1 AND state = 'open' AND NOT (id = ANY($2::uuid[]))`,
    [pageId, sids],
  )
  if (sids.length === 0) return

  const rows = [...bySid].map(([sid, m]) => ({ sid, authorId: m.authorId.toLowerCase(), kind: m.kind, preview: suggestionPreview(m.text) }))
  // xmax = 0 이면 새로 넣은 행이다(stale → open 되살림은 xmax 가 남는다) — 처음 본 sid 만 알린다(SG-4)
  const written = await tx.query<{ id: string; author_id: string; inserted: boolean }>(
    `INSERT INTO suggestion (id, page_id, author_id, kind, preview, state, created_at)
     SELECT m.id, $1, m.author_id, m.kind, m.preview, 'open', now()
       FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[]) AS m(id, author_id, kind, preview)
      WHERE EXISTS (SELECT 1 FROM workspace_member w
                     WHERE w.workspace_id = $6 AND w.user_id = m.author_id AND w.status = 'active')
     ON CONFLICT (id) DO UPDATE SET state = 'open'
      WHERE suggestion.state = 'stale' AND suggestion.page_id = EXCLUDED.page_id
     RETURNING id, author_id, (xmax = 0) AS inserted`,
    [
      pageId,
      rows.map((r) => r.sid),
      rows.map((r) => r.authorId),
      rows.map((r) => r.kind),
      rows.map((r) => r.preview),
      ctx.workspaceId,
    ],
  )
  const fresh = written.filter((r) => r.inserted).map((r) => ({ id: r.id, authorId: r.author_id }))
  await notifySuggestionsCreated(tx, ctx, { pageId, suggestions: fresh })
}
