/**
 * AI 블록의 원문 · 결과 직렬화와 해시 — 서버와 편집기가 같은 함수를 쓴다 (AI-5 · F-10-04 · 순수 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑩ · 10-ai-features.md F-10-04 엣지 케이스 *"AI 블록이 자기 자신을 컨텍스트에 포함 —
 * 반드시 제외"* · *"한 페이지에 AI 블록 여러 개 — 서로의 출력을 컨텍스트에서 제외"*
 *
 * 원문 = 페이지 본문의 원문(제안 마크 밖 — 서버는 `readBodyIn`, 편집기는 `pmToDoc(originalOf(doc))`)에서 **모든 AI 블록의 서브트리를 뺀** 블록마다
 * 한 줄(평문 복사와 같은 꼴 — `# 제목` · `- 목록` · `- [ ] 할 일` · 깊이만큼 들여쓰기). 빈 줄은 뺀다(빈 문단을 넣고 빼는 것으로 "바뀌었다"가
 * 되지 않게). 컬럼의 틀은 줄이 아니다 · 표는 통째로 한 묶음.
 *
 * 해시는 동기 · 결정적인 53비트(cyrb53) + 길이 — 보안이 아니라 "같은 글인가" 를 본다. **제목은 넣지 않는다**(편집기의 본문 밖이라 편집기가
 * 같은 값을 짓지 못한다 — 제목만 바꾸면 "바뀌었다"가 되지 않는다). 상한으로 자르기 **전의** 전체 원문이다.
 */

import { AI_BLOCK_INSTRUCTION_MAX, AI_BLOCK_TYPE, aiBlockStamp, isAiBlockKind, type AiBlockKind } from '../block/ai-block.ts'
import { isPlainRecord } from '../contracts/json-safe.ts'
import { plainTextForBlocks } from '../editor/block-clipboard.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'

export type AiBlockProps = {
  readonly kind: AiBlockKind
  readonly instruction: string
  readonly generatedAt: string | null
  readonly sourceHash: string | null
  readonly resultHash: string | null
}

/** AI 블록의 속성 → 읽은 모양(모양이 틀린 칸은 없는 것으로 · 모르는 종류는 custom — `block/ai-block.ts`). */
export function readAiBlock(props: unknown): AiBlockProps {
  const p = isPlainRecord(props) ? props : {}
  return {
    kind: isAiBlockKind(p.kind) ? p.kind : 'custom',
    instruction: typeof p.instruction === 'string' ? p.instruction.slice(0, AI_BLOCK_INSTRUCTION_MAX) : '',
    generatedAt: aiBlockStamp(p.generatedAt),
    sourceHash: aiBlockStamp(p.sourceHash),
    resultHash: aiBlockStamp(p.resultHash),
  }
}

/** 블록마다 한 줄 — AI 블록의 서브트리는 통째로 뺀다(머리말). */
export function aiSourceLines(blocks: readonly EditorBlock[]): string[] {
  const out: string[] = []
  const walk = (list: readonly EditorBlock[], depth: number): void => {
    for (const block of list) {
      if (block.type === AI_BLOCK_TYPE) continue
      if (block.type === 'column_list' || block.type === 'column') {
        walk(block.children ?? [], depth)
        continue
      }
      const table = block.type === 'table'
      const own = plainTextForBlocks([table ? block : { ...block, children: [] }])
      if (own.trim() !== '') {
        const indent = '  '.repeat(depth)
        out.push(own.split('\n').map((l) => indent + l).join('\n'))
      }
      if (!table) walk(block.children ?? [], depth + 1)
    }
  }
  walk(blocks, 0)
  return out
}

/** 페이지의 원문(AI 블록을 모두 뺀 것). */
export const aiSourceText = (doc: EditorDoc): string => aiSourceLines(doc.blocks).join('\n')

/** AI 블록의 결과(자식)의 글 — 안에 끼워 넣은 AI 블록은 뺀다. */
export const aiResultText = (children: readonly EditorBlock[]): string => aiSourceLines(children).join('\n')

/** 글의 해시 — `길이(36진)-cyrb53(16진 14자리)`. */
export function aiTextHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return `${text.length.toString(36)}-${n.toString(16).padStart(14, '0')}`
}

/** 문서에서 id 로 블록을 찾는다(깊이와 상관없이). */
export function findBlockIn(blocks: readonly EditorBlock[], id: string): EditorBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block
    const inner = findBlockIn(block.children ?? [], id)
    if (inner !== null) return inner
  }
  return null
}
