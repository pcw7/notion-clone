/**
 * blockId 스탬프 플러그인
 *
 * `blockContainer.blockId` 의 스키마 default 는 빈 문자열 센티널이다
 * (`schema.ts` 주석: ProseMirror 는 필수 위치의 노드가 인자 없이 생성 가능해야
 * 하고, `default` 는 고정값이라 uuid 팩토리를 넣을 수 없다).
 *
 * 그래서 **노드가 생기는 즉시 id 를 찍는 자리**가 필요하다. 이 플러그인이 그것이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 중복도 함께 고친다 — 이게 더 중요하다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 빈 id 는 `validateDoc` 이 거부하므로 서버까지 새 나가도 눈에 보인다.
 * 반면 **중복 id** 는 더 조용하다. 블록을 복사해 붙이면(F-01-10) 붙은 블록이
 * 원본과 같은 `blockId` 를 갖는데, 그 문서를 저장하면
 *
 *   - `validateDoc` 이 "문서에 두 번 나타납니다"로 거부하거나
 *   - (검증을 우회하면) 프로젝터가 한 행에 두 번 써서 **블록 하나가 사라진다**
 *
 * 붙여넣기는 흔한 조작이므로 여기서 잡는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 appendTransaction 인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * `filterTransaction` 으로 막으면 사용자의 조작이 취소된다. 여기서 필요한 것은
 * 거부가 아니라 **보정**이다. `appendTransaction` 은 원래 트랜잭션 **뒤에**
 * 붙으므로 사용자 조작을 그대로 살리면서 id 만 채운다.
 *
 * `addToHistory: false` 를 준다. id 를 찍은 것이 undo 스택에 별도 항목으로
 * 쌓이면 Cmd+Z 를 두 번 눌러야 한 동작이 취소된다 — F-01-19 가 "분할은
 * 트랜잭션 1개 = undo 1회"로 요구한 것과 같은 이유다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { newBlockId } from './pm-adapter.ts'

export const blockIdPluginKey = new PluginKey('blockId')

type Fix = { pos: number; id: string }

/**
 * 비었거나 중복된 blockId 를 찾는다.
 *
 * 문서 순서상 **처음 나온 id 가 원본**이고 뒤에 나온 같은 id 가 새 id 를 받는다.
 * 위에서 아래로 붙여넣는 방향과 일치해서, 붙여넣은 쪽이 새 id 를 받는다.
 */
export function findBlockIdFixes(doc: PmNode): Fix[] {
  const fixes: Fix[] = []
  const seen = new Set<string>()

  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true
    const id = String(node.attrs.blockId ?? '')
    if (id === '' || seen.has(id)) {
      fixes.push({ pos, id: newBlockId() })
    } else {
      seen.add(id)
    }
    return true
  })

  return fixes
}

export function blockIdPlugin(): Plugin {
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((t) => t.docChanged)) return null

      const fixes = findBlockIdFixes(newState.doc)
      if (fixes.length === 0) return null

      const tr = newState.tr
      for (const fix of fixes) {
        const node = tr.doc.nodeAt(fix.pos)
        if (!node || node.type.name !== 'blockContainer') continue
        tr.setNodeMarkup(fix.pos, undefined, { ...node.attrs, blockId: fix.id })
      }
      // attrs 만 바꾸므로 위치가 밀리지 않는다 — 매핑이 필요 없다.
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
}
