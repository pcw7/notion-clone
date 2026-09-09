/**
 * 마크다운 단축 입력 — F-01-05 / F-12-01
 *
 * 정본: 01-block-editor.md F-01-05, 12-platform-ux.md F-12-01
 *   "마크다운 입력 규칙(input rule)은 **줄 시작에서만** 트리거:
 *    `#`+space, `##`, `###`, `-`/`*`/`+`+space, `1.`+space, `[]`+space,
 *    `>`+space, `\"`+space, `---`(divider). 인라인 규칙: `**bold**`,
 *    `*italic*`, 백틱 코드, `~~strike~~`."
 *
 * ──────────────────────────────────────────────────────────────────────
 * 블록 규칙을 레지스트리에서 생성한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 접두사 목록은 이미 `block/types.ts` 의 `markdownPrefix` 에 있다. 여기에 다시
 * 적으면 두 곳이 어긋나고, 어긋나면 "슬래시 메뉴에는 있는데 마크다운으로는
 * 안 만들어지는" 타입이 생긴다. 그래서 레지스트리를 읽어 규칙을 만든다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * undo 는 변환만 되돌린다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-17 엣지 케이스: *"마크다운 자동 변환 undo | 변환만 되돌리고 입력 텍스트는
 * 유지(F-01-05)."* 이건 우리가 만들 필요가 없다 — ProseMirror 의
 * `undoInputRule` 이 정확히 그 동작이고, 키맵에 `Backspace` 로 얹으면 된다
 * (`createInputRuleKeymap`).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 코드 블록 안에서는 전면 비활성 — 지금은 해당 사항 없음
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-14: "코드 블록 안에서는 에디터의 기본 키/입력 규칙을 전부 꺼야 한다."
 * **MVP 12종에 `code` 가 없으므로**(`block/types.ts`) 지금은 끌 것이 없다.
 * 대신 규칙이 "이 블록 타입에서 동작하는가"를 레지스트리의 `hasRichText` 로만
 * 판단하게 해두었다 — `code` 를 추가할 때 여기에 `if` 를 심지 않고
 * 레지스트리에 항목을 넣어 끌 수 있다.
 */

import { InputRule, inputRules, undoInputRule } from '@tiptap/pm/inputrules'
import type { Plugin } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'

import {
  BLOCK_TYPES,
  MVP_BLOCK_TYPES,
  normalizeFormat,
  specOf,
  type BlockFormat,
  type BlockType,
} from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { containerAt } from './pm-blocks.ts'
import { newBlockId } from './pm-adapter.ts'

/** 정규식 특수문자 이스케이프. 접두사에 `*`, `+`, `[`, `.` 가 들어 있다. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 접두사가 만드는 properties.
 *
 * `[x] ` 만 특별하다 — 마크다운의 체크된 항목이므로 `checked: true` 로 만든다.
 * 나머지 to_do 접두사(`[] `, `[ ] `)는 false 다.
 */
function propertiesForPrefix(type: BlockType, prefix: string): Record<string, unknown> {
  if (type !== 'to_do') return {}
  return { checked: prefix.trim() === '[x]' }
}

/**
 * 블록 타입 변환 입력 규칙 하나.
 *
 * 트리거는 **줄 시작에서만**이다(F-12-01). `^` 앵커가 그것을 보장한다 —
 * ProseMirror 의 입력 규칙은 텍스트블록의 시작부터 캐럿까지를 대상으로 매칭한다.
 */
function blockTypeRule(type: BlockType, prefix: string): InputRule {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}$`)

  return new InputRule(pattern, (state, _match, start, end) => {
    const info = containerAt(state.selection.$from)
    if (!info) return null

    // 이미 그 타입이면 접두사를 텍스트로 남긴다 — "- - 항목" 을 쓰려는 경우다.
    const currentType = info.contentNode.type.name
    if (currentType === type) return null
    // 텍스트를 담지 않는 블록 안에서는 입력 규칙이 돌 일이 없다.
    if (!info.contentNode.isTextblock) return null

    const format = normalizeFormat(type, info.contentNode.attrs.format as BlockFormat)
    const tr = state.tr

    if (specOf(type).hasRichText) {
      tr.delete(start, end)
      tr.setNodeMarkup(info.contentPos, blockSchema.nodes[type], {
        props: propertiesForPrefix(type, prefix),
        format,
      })
      return tr
    }

    // divider 처럼 텍스트를 담지 않는 타입. 내용 노드를 통째로 갈고,
    // 캐럿을 둘 자리가 없어지므로 뒤에 빈 문단을 만든다.
    if (info.contentNode.content.size > end - start) return null // 다른 텍스트가 있으면 변환하지 않는다

    tr.replaceWith(
      info.contentPos,
      info.contentPos + info.contentNode.nodeSize,
      blockSchema.nodes[type].create({ props: {}, format }),
    )
    const container = tr.doc.nodeAt(info.pos)
    if (container) {
      tr.insert(
        info.pos + container.nodeSize,
        blockSchema.nodes.blockContainer.create({ blockId: newBlockId() }, [
          blockSchema.nodes.paragraph.create({ props: {}, format: {} }),
        ]),
      )
    }
    return tr
  })
}

/** 레지스트리의 `markdownPrefix` 를 전부 규칙으로. */
export function blockInputRules(): InputRule[] {
  const rules: InputRule[] = []
  for (const type of MVP_BLOCK_TYPES) {
    for (const prefix of BLOCK_TYPES[type].markdownPrefix ?? []) {
      rules.push(blockTypeRule(type, prefix))
    }
  }
  return rules
}

// ── 인라인 규칙 ───────────────────────────────────────────────────────

/**
 * `**굵게**` 처럼 감싸는 마크 규칙.
 *
 * ProseMirror 에는 `textblockTypeInputRule`·`wrappingInputRule` 은 있지만
 * **마크 규칙은 없다.** 직접 만든다 — 여는 구분자와 닫는 구분자 사이에
 * 마크를 걸고 구분자를 지운다.
 *
 * 닫는 구분자 **직전 문자가 공백이면 매칭하지 않는다.** 그러지 않으면
 * `2 * 3 * 4` 를 쓰다가 `* 3 *` 가 기울임으로 변한다.
 */
function markRule(markName: string, delimiter: string): InputRule {
  const d = escapeRegExp(delimiter)
  // (구분자)(공백 아님으로 시작하고 공백 아님으로 끝나는 내용)(구분자)
  const pattern = new RegExp(`(?:^|[^${d}\\w])${d}([^\\s${d}][^${d}]*[^\\s${d}]|[^\\s${d}])${d}$`)

  return new InputRule(pattern, (state, match, start, end) => {
    const inner = match[1]
    if (inner === undefined) return null

    const markType = blockSchema.marks[markName]
    // match[0] 은 앞의 한 글자를 포함할 수 있다. 실제 구분자 시작 위치를 잡는다.
    const openOffset = match[0].length - (inner.length + delimiter.length * 2)
    const from = start + openOffset

    const tr = state.tr
    tr.delete(from, end)
    tr.insertText(inner, from)
    tr.addMark(from, from + inner.length, markType.create())
    // 이후 타이핑에 마크가 이어지지 않게 한다 — `**굵게**보통` 을 위해서.
    tr.removeStoredMark(markType)
    return tr
  })
}

/**
 * 인라인 마크 규칙 (F-12-01 열거: `**bold**` · `*italic*` · 백틱 코드 · `~~strike~~`).
 *
 * 순서가 중요하다. `**` 가 `*` 보다 **먼저** 와야 `**굵게**` 가 기울임으로
 * 해석되지 않는다.
 */
export function inlineInputRules(): InputRule[] {
  return [
    markRule('bold', '**'),
    markRule('italic', '*'),
    markRule('strikethrough', '~~'),
    markRule('code', '`'),
  ]
}

// ── 플러그인 / 키맵 ───────────────────────────────────────────────────

export function inputRulesPlugin(): Plugin {
  return inputRules({ rules: [...blockInputRules(), ...inlineInputRules()] })
}

/**
 * 입력 규칙 되돌리기.
 *
 * F-01-17: "마크다운 자동 변환 undo → 변환만 되돌리고 입력 텍스트는 유지."
 * `undoInputRule` 이 그 동작이고, **블록 병합보다 먼저** 시도되어야 한다 —
 * `# ` 를 쳐서 헤딩이 된 직후의 Backspace 는 "헤딩 취소"이지 "앞 블록과 병합"이
 * 아니다. 키맵을 합칠 때 이 커맨드를 앞에 둔다.
 */
export function undoInputRuleCommand(): Command {
  return undoInputRule
}
