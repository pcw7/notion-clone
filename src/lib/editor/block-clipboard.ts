/**
 * 복사 · 붙여넣기 — F-01-10
 *
 * 정본: 01-block-editor.md F-01-10. 우선순위가 **P0(내부 복붙 + 평문) / P1(HTML ·
 * 마크다운 파싱) / P2(URL 붙여넣기 형태 선택)** 이고, 클론 대안이 *"내부
 * 라운드트립만 우선 완벽하게"* 다. 이 파일은 P0 까지다 — 외부 HTML 을 블록으로
 * 파싱하는 일은 하지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 클립보드에 세 벌을 싣는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본이 요구한 3종이다.
 *
 *   | MIME | 무엇 | 누가 읽나 |
 *   |---|---|---|
 *   | `application/x-notion-clone-blocks+json` | 블록 트리 JSON | **우리 앱** (무손실) |
 *   | `text/html` | `toDOM` 으로 만든 HTML | 다른 앱 (서식 유지) |
 *   | `text/plain` | 마크다운에 가까운 평문 | 메모장·코드 편집기 |
 *
 * HTML 만으로는 무손실이 안 된다. `toDOM` 은 화면에 필요한 것만 내보내므로
 * `properties`(할 일의 `checked`, 이미지 URL, `unsupported` 의 원본 페이로드)가
 * 빠진다. 그래서 JSON 이 따로 있고, 우리 앱끼리는 그것만 읽는다.
 *
 * ⚠ **이 JSON 포맷은 되돌리기 비싼 결정이다.** 정본의 리스크 표: *"커스텀 클립보드
 * MIME 과 subtree 직렬화 포맷 — 포맷을 바꾸면 이전 버전 클립보드가 깨진다."*
 * 그래서 `version` 을 싣고, 모르는 버전이면 **조용히 평문 경로로 떨어진다**
 * (거부하지 않는다 — 사용자는 붙여넣기가 안 되는 이유를 알 수 없다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 붙여넣을 때 id 는 언제나 새로 발급한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본: *"모든 블록에 새 UUID 재발급(원본 ID 재사용 금지 — 중복 ID 사고 방지)."*
 * 같은 문서에 붙이면 중복 id 가 되고(프로젝터가 한 행에 두 번 써서 블록이 사라진다),
 * 다른 문서에 붙이면 **다른 페이지의 블록과 같은 uuid** 가 되어 INSERT 가 PK 에
 * 걸린다. 클립보드 JSON 의 id 는 그래서 참고용이고, 붙는 순간 전부 바뀐다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 하위 페이지는 복사되지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 본문의 `page` 블록은 그 페이지 자체다(C-3). 복사본을 붙이면 **존재하지 않는
 * 페이지를 가리키는 `type='page'` 행**을 만들게 되고, 그 행은 `lifecycle` 이 없어
 * `ck_lifecycle_page` 에 걸려 저장이 통째로 실패한다. 페이지를 복제하는 것은
 * 서버 작업(서브트리 깊은 복사)이라 편집기 클립보드가 할 수 있는 일이 아니다.
 *
 * 그래서 **JSON 에서 빼고 복사한 순간 알려준다.** 삭제(#27)·복제(#30)가 하위
 * 페이지를 거부하는 것과 같은 이유다.
 */

import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Command } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { isKnownBlockType, specOf, PAGE_TYPE } from '../block/types.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import {
  isBlockSelection,
  replaceBlockSelection,
  deleteBlockSelectionCommand,
} from './block-selection.ts'
import type { CommandDeps } from './commands.ts'
import { validateDoc, type EditorBlock } from './document.ts'
import { blockFromContainer, containerFor, newBlockId } from './pm-adapter.ts'
import { containerAt } from './pm-blocks.ts'

/** 정본의 `application/x-{app}-blocks+json`. */
export const BLOCKS_MIME = 'application/x-notion-clone-blocks+json'

/** 포맷 버전. 모르는 버전은 평문으로 떨어진다(머리말). */
export const CLIPBOARD_VERSION = 1

/** 정본 엣지 케이스: *"1회 블록 수 상한(예: 5000)"*. */
export const MAX_PASTE_BLOCKS = 5000

export const HAS_SUBPAGE_NOTICE =
  '하위 페이지는 복사되지 않았습니다. 페이지는 "이동"으로 옮기거나 새로 만들어야 합니다.'

// ── 내보내기 ──────────────────────────────────────────────────────────

/** 하위 페이지를 걷어낸다. 자손에 섞여 있어도 찾아낸다. */
export function stripPageRefs(blocks: readonly EditorBlock[]): {
  blocks: EditorBlock[]
  dropped: number
} {
  let dropped = 0
  const walk = (list: readonly EditorBlock[]): EditorBlock[] =>
    list.flatMap((block) => {
      if (block.type === PAGE_TYPE) {
        dropped += 1
        return []
      }
      const children = block.children ?? []
      return [{ ...block, children: children.length > 0 ? walk(children) : [] }]
    })
  return { blocks: walk(blocks), dropped }
}

function countBlocks(blocks: readonly EditorBlock[]): number {
  return blocks.reduce((n, b) => n + 1 + countBlocks(b.children ?? []), 0)
}

/**
 * 평문 — 마크다운에 가깝게.
 *
 * 정본은 **Notion-flavored enhanced markdown** 으로 맞추면 *"노션 ↔ 클론 상호
 * 붙여넣기가 상당 부분 무손실"* 이 된다고 한다. 그건 `<details>` · `<callout>` 같은
 * 확장 문법까지 가야 해서 P1 이다. 여기서는 표준 마크다운으로 표현되는 것만 쓰고,
 * 나머지(토글·콜아웃)는 가장 가까운 표준 문법으로 낮춘다.
 */
export function plainTextForBlocks(blocks: readonly EditorBlock[]): string {
  const lines: string[] = []
  const walk = (list: readonly EditorBlock[], depth: number): void => {
    for (const block of list) {
      const indent = '  '.repeat(depth)
      const text = toPlainText(block.title ?? [])
      const checked = (block.properties as { checked?: boolean } | undefined)?.checked === true
      const url = (block.properties as { url?: string } | undefined)?.url ?? ''
      switch (block.type) {
        case 'heading_1':
          lines.push(`${indent}# ${text}`)
          break
        case 'heading_2':
          lines.push(`${indent}## ${text}`)
          break
        case 'heading_3':
          lines.push(`${indent}### ${text}`)
          break
        case 'bulleted_list_item':
        case 'toggle':
          lines.push(`${indent}- ${text}`)
          break
        case 'numbered_list_item':
          lines.push(`${indent}1. ${text}`)
          break
        case 'to_do':
          lines.push(`${indent}- [${checked ? 'x' : ' '}] ${text}`)
          break
        case 'quote':
        case 'callout':
          lines.push(`${indent}> ${text}`)
          break
        case 'divider':
          lines.push(`${indent}---`)
          break
        case 'image':
          lines.push(`${indent}![](${url})`)
          break
        default:
          lines.push(`${indent}${text}`)
      }
      walk(block.children ?? [], depth + 1)
    }
  }
  walk(blocks, 0)
  return lines.join('\n')
}

export type SerializedSelection = {
  /** `BLOCKS_MIME` 에 실을 JSON. */
  readonly json: string
  readonly text: string
  /** 하위 페이지 때문에 빠진 블록 수. 0 이 아니면 사용자에게 알린다. */
  readonly dropped: number
  /** HTML 을 만들 원본 — 화면 쪽이 `DOMSerializer` 로 옮긴다. */
  readonly blocks: readonly EditorBlock[]
}

/** 선택된 최상위 블록들을 클립보드에 실을 형태로. */
export function serializeBlocks(doc: PmNode, rootPositions: readonly number[]): SerializedSelection | null {
  const source: EditorBlock[] = []
  for (const pos of rootPositions) {
    const node = doc.nodeAt(pos)
    if (node) source.push(blockFromContainer(node))
  }
  if (source.length === 0) return null

  const { blocks, dropped } = stripPageRefs(source)
  return {
    json: JSON.stringify({ version: CLIPBOARD_VERSION, blocks }),
    text: plainTextForBlocks(blocks),
    dropped,
    blocks,
  }
}

// ── 읽기 ──────────────────────────────────────────────────────────────

export type ParsedClipboard =
  | { readonly ok: true; readonly blocks: EditorBlock[] }
  /** 우리 포맷이 아니거나 읽을 수 없다 — 부르는 쪽은 평문 경로로 간다. */
  | { readonly ok: false; readonly reason: 'absent' | 'unreadable' | 'other_version' | 'too_many' }

/**
 * 클립보드 JSON 을 블록 트리로.
 *
 * **검증은 저장할 때 쓰는 것과 같은 함수(`validateDoc`)로 한다.** 클립보드는 다른
 * 창·다른 버전·손으로 만든 값이 들어올 수 있는 입구다. 여기서만 무르게 굴면 그
 * 문서가 저장 단계에서 거부되고, 사용자는 붙여넣은 한참 뒤에 "저장 안 됨"을 본다.
 */
export function parseClipboardBlocks(raw: string | null | undefined): ParsedClipboard {
  if (!raw) return { ok: false, reason: 'absent' }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  const value = payload as { version?: unknown; blocks?: unknown }
  if (value?.version !== CLIPBOARD_VERSION) return { ok: false, reason: 'other_version' }
  if (!Array.isArray(value.blocks)) return { ok: false, reason: 'unreadable' }

  const blocks = value.blocks as EditorBlock[]
  if (countBlocks(blocks) > MAX_PASTE_BLOCKS) return { ok: false, reason: 'too_many' }
  if (validateDoc({ blocks }).length > 0) return { ok: false, reason: 'unreadable' }

  // 하위 페이지는 복사될 때 빠지지만, 다른 버전·손으로 만든 클립보드가 들고 올 수 있다.
  return { ok: true, blocks: stripPageRefs(blocks).blocks }
}

/** 붙는 모든 블록에 새 id 를 준다(머리말). */
export function withFreshBlockIds(
  blocks: readonly EditorBlock[],
  newId: () => string = newBlockId,
): EditorBlock[] {
  return blocks.map((block) => ({
    ...block,
    id: newId(),
    children: withFreshBlockIds(block.children ?? [], newId),
  }))
}

/**
 * 평문 → 블록. **한 줄이 한 문단**이다.
 *
 * ProseMirror 기본 파서는 빈 줄로만 문단을 나누고 한 줄바꿈은 블록 안에 남긴다.
 * 노션은 줄마다 블록을 만든다 — 목록을 복사해 붙이는 흔한 경우가 그래야 맞는다.
 * 마크다운 접두사는 해석하지 않는다(P1). 붙인 뒤 입력 규칙으로 바꾸면 된다.
 */
export function textToBlocks(text: string, newId: () => string = newBlockId): EditorBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // 끝의 빈 줄은 버린다 — 줄바꿈으로 끝나는 텍스트가 빈 블록을 만들지 않게.
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => ({
    id: newId(),
    type: 'paragraph',
    title: line === '' ? [] : [textRun(line)],
    properties: {},
    format: {},
    children: [],
  }))
}

// ── 붙여넣기 ──────────────────────────────────────────────────────────

/**
 * 블록들을 지금 위치에 넣는다.
 *
 * 세 경우가 다르다.
 *
 *   - **블록 선택** — 고른 블록들을 대체한다(`replaceBlockSelection`). 슬라이스의
 *     양끝이 닫혀 있어(openStart/openEnd 0) 통째로 들어간다
 *   - **캐럿, 그 블록에 자식이 없다** — 정본: *"붙여넣기 대상이 텍스트 중간 | 첫
 *     블록은 인라인 병합, 나머지는 새 블록으로 분리."* 그게 바로 ProseMirror
 *     슬라이스의 **열린 양끝**이 뜻하는 것이라, 양끝을 열어 `replaceSelection` 에
 *     넘기면 우리가 병합·분할을 구현하지 않아도 된다. 텍스트를 담지 않는
 *     블록(구분선·이미지)이 양끝이면 열 수 없으므로 그때만 닫는다
 *   - **캐럿, 그 블록에 자식이 있다** — ⚠ 여기서 `replaceSelection` 에 맡기면
 *     ProseMirror 가 컨테이너를 쪼개면서 **자식을 뒤 블록으로 옮긴다.** 마스터 문서
 *     §7-4 가 "최빈 버그"로 지목하고 Enter 분할이 이미 금지한 그 동작이다
 *     (실제 브라우저 검증에서 이 경로로 자식이 딸려가는 것을 봤다). 그래서 텍스트를
 *     쪼개지 않고 **화면에서 바로 다음 줄**에 넣는다 — 펼쳐진 자식이 있으면 첫 자식,
 *     접혀 있으면 그 블록 뒤. 분할(판결 ④)·`+` 버튼과 같은 자리 규칙이다
 */
export function pasteBlocksCommand(blocks: readonly EditorBlock[], deps: CommandDeps): Command {
  return (state, dispatch) => {
    if (blocks.length === 0) return false

    const fresh = withFreshBlockIds(blocks, deps.newId ?? newBlockId)
    const containers = fresh.map(containerFor)
    const sel = state.selection
    const tr = state.tr

    if (isBlockSelection(sel)) {
      const slice = new Slice(Fragment.fromArray(containers), 0, 0)
      if (!replaceBlockSelection(tr, sel, slice, deps.newId)) return false
    } else if (containerAt(sel.$from)?.groupNode?.childCount) {
      const info = containerAt(sel.$from)
      if (!info) return false
      const at =
        info.groupPos !== null && !deps.isCollapsed(info.id)
          ? info.groupPos + 1
          : info.pos + info.node.nodeSize
      tr.insert(at, containers)
    } else {
      // 텍스트를 담고 자식이 없는 블록만 양끝을 열 수 있다. 구분선·이미지나
      // 자식이 딸린 블록은 열면 슬라이스가 성립하지 않는다.
      const openable = (block: EditorBlock): number =>
        isKnownBlockType(block.type) &&
        specOf(block.type).hasRichText &&
        (block.children?.length ?? 0) === 0
          ? 2
          : 0
      const slice = new Slice(
        Fragment.fromArray(containers),
        openable(fresh[0]),
        openable(fresh[fresh.length - 1]),
      )
      tr.replaceSelection(slice)
    }

    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

// ── 플러그인 ──────────────────────────────────────────────────────────

export const clipboardPluginKey = new PluginKey('blockClipboard')

/** 화면에서 HTML 을 만들 때 쓴다. 브라우저에서만 불린다. */
export type ClipboardHtml = (blocks: readonly EditorBlock[]) => string

/**
 * 복사·잘라내기·붙여넣기.
 *
 * **블록 선택일 때만 복사를 가로챈다.** 텍스트 선택(블록 경계를 넘는 부분 선택
 * 포함)은 ProseMirror 의 기본 경로가 이미 맞게 처리한다 — 정본이 1급 요구사항으로
 * 꼽은 그 동작은 단일 contenteditable 을 고른 시점에 이미 얻었다(§7-4).
 */
export function clipboardPlugin(deps: CommandDeps, toHtml: ClipboardHtml): Plugin {
  const write = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
    const sel = view.state.selection
    if (!isBlockSelection(sel)) return false
    const data = event.clipboardData
    if (!data) return false

    const out = serializeBlocks(view.state.doc, sel.rootPositions)
    if (!out) return false

    event.preventDefault()
    data.setData(BLOCKS_MIME, out.json)
    data.setData('text/plain', out.text)
    data.setData('text/html', toHtml(out.blocks))
    if (out.dropped > 0) deps.onRefused?.(HAS_SUBPAGE_NOTICE)

    // 잘라내기는 복사한 뒤 지운다. 하위 페이지가 섞여 있으면 삭제 쪽이 거부하고
    // 이유를 알린다(#27) — 복사는 이미 끝났으므로 내용이 사라지지는 않는다.
    if (cut) deleteBlockSelectionCommand(deps)(view.state, view.dispatch.bind(view))
    return true
  }

  return new Plugin({
    key: clipboardPluginKey,
    props: {
      handleDOMEvents: {
        copy: (view, event) => write(view, event as ClipboardEvent, false),
        cut: (view, event) => write(view, event as ClipboardEvent, true),
      },

      handlePaste: (view, event) => {
        const parsed = parseClipboardBlocks(event.clipboardData?.getData(BLOCKS_MIME))
        if (!parsed.ok) {
          if (parsed.reason === 'too_many') {
            deps.onRefused?.(`한 번에 붙여넣을 수 있는 블록은 ${MAX_PASTE_BLOCKS}개까지입니다.`)
            return true
          }
          // 우리 포맷이 아니다 — HTML·평문 기본 경로로 넘긴다.
          return false
        }
        return pasteBlocksCommand(parsed.blocks, deps)(view.state, view.dispatch.bind(view))
      },

      /**
       * 평문 붙여넣기. 한 줄이 한 문단이다(`textToBlocks` 머리말).
       *
       * `Mod+Shift+V`(서식 없이 붙여넣기)도 이 경로로 온다 — ProseMirror 가
       * `plain` 일 때 HTML 을 무시하고 이 파서를 부른다.
       */
      clipboardTextParser: (text) => {
        const blocks = withFreshBlockIds(textToBlocks(text), deps.newId ?? newBlockId)
        const containers = blocks.map(containerFor)
        const open = blocks.length > 0 ? 2 : 0
        return new Slice(Fragment.fromArray(containers), open, open)
      },
    },
  })
}
