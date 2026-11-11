/**
 * 코멘트 권한자의 제안 검사 (SG-5b · F-05-12 · 판결 U-2 · 정본 [보강 SG-1] ⑨)
 *
 * `comment` 만 가진 사람의 update 를 **적용해 본 뒤** 받을지 정한다 — 쓰기 경로 ①(`block/body-write.ts` `appendDocUpdate`)이
 * 적용 전후의 본문(`collab/ydoc.ts` `readBodyPm` — 고치지 않은 그대로)을 넘긴다.
 *
 *   ① 원문(`originalOf`)이 같다 — 원문을 바꾸지 않았다. 블록 속성(할 일 체크 같은)도 원문이다
 *   ② 남의 이름이 선 제안은 앞뒤가 같다 — sid 마다 마크 종류 · 속성 · 그 마크가 덮은 글. "남의 제안을 지우거나 바꾸기" 와 "남의
 *      이름으로 제안하기"(앞에 없던 sid 에 남의 이름)와 "내 제안을 남의 이름으로 돌리기" 가 모두 이 하나에 걸린다
 *
 * 자기 제안은 원문이 그대로인 한 마음대로 바꾸고 지운다. 남이 넣자는 글에 서식을 입히는 것은 그 제안의 글을 바꾸지 않는다 —
 * 원문에 없는 글이다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'

import { SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK, SUGGESTION_INSERT_MARK } from '../editor/schema.ts'
import { originalOf } from '../editor/suggestion-original.ts'

export type SuggestOnlyViolation = 'original_changed' | 'others_suggestion'

const SUGGESTION_MARKS: ReadonlySet<string> = new Set([SUGGESTION_INSERT_MARK, SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK])

type Trace = { readonly authors: Set<string>; readonly parts: [key: string, content: string][] }

/** sid 마다 그 마크가 덮은 것을 문서 차례로 — 같은 마크가 이어 덮은 조각은 하나로 잇는다(글이 다른 마크로 쪼개져도 같다). */
function tracesOf(doc: PmNode): Map<string, Trace> {
  const traces = new Map<string, Trace>()
  doc.descendants((node) => {
    if (!node.isInline) return true
    const content = node.isText ? (node.text ?? '') : JSON.stringify([node.type.name, node.attrs])
    for (const mark of node.marks) {
      if (!SUGGESTION_MARKS.has(mark.type.name)) continue
      const sid = String(mark.attrs.sid)
      let trace = traces.get(sid)
      if (trace === undefined) {
        trace = { authors: new Set(), parts: [] }
        traces.set(sid, trace)
      }
      trace.authors.add(String(mark.attrs.author_id))
      const key = JSON.stringify([mark.type.name, mark.attrs])
      const last = trace.parts.at(-1)
      if (last !== undefined && last[0] === key) last[1] += content
      else trace.parts.push([key, content])
    }
    return false
  })
  return traces
}

const sameTrace = (a: Trace | undefined, b: Trace | undefined): boolean =>
  JSON.stringify(a?.parts ?? null) === JSON.stringify(b?.parts ?? null)

const othersIn = (trace: Trace | undefined, userId: string): boolean => trace !== undefined && [...trace.authors].some((a) => a !== userId)

/** 받아도 되면 null, 아니면 어긴 것(머리말). */
export function suggestOnlyViolation(before: PmNode, after: PmNode, userId: string): SuggestOnlyViolation | null {
  if (!originalOf(before).doc.eq(originalOf(after).doc)) return 'original_changed'
  const was = tracesOf(before)
  const now = tracesOf(after)
  for (const sid of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(sid)
    const b = now.get(sid)
    if ((othersIn(a, userId) || othersIn(b, userId)) && !sameTrace(a, b)) return 'others_suggestion'
  }
  return null
}
