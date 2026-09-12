/**
 * ProseMirror 에디터 조립.
 *
 * React 컴포넌트에서 분리해 둔다 — 조립 순서에 규칙이 있고, 그 규칙을
 * JSX 사이에 흩어놓으면 나중에 플러그인 하나를 잘못된 자리에 끼우게 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 Tiptap 이 아니라 ProseMirror 를 직접 쓰는가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 §6·F-12-01 의 권고는 *"에디터를 처음부터 만들지 말 것"* 이고,
 * 우리는 만들지 않았다 — 문서 모델 · 뷰 · 스텝 · 위치 매핑 · 히스토리 ·
 * 입력 규칙 · 키맵이 전부 ProseMirror 것이다. Tiptap 은 그 위의 **확장 레이어**다.
 *
 * 그 레이어를 쓰지 않은 이유는 하나다: **Tiptap 은 스키마를 소유한다.**
 * Tiptap 에서 스키마는 extension 목록에서 생성되는데, 우리 스키마는
 * §5.1 의 요구대로 **블록 타입 레지스트리에서 생성**되어야 한다
 * (`schema.ts`). 두 생성기를 겹치면 "레지스트리에 넣었는데 에디터에는 없는"
 * 상태가 가능해지고, 그게 정확히 레지스트리를 만든 이유를 무너뜨린다.
 *
 * 그래서 의존성은 `@tiptap/pm` **하나**만 남긴다. 이 패키지는 서로 호환되는
 * `prosemirror-*` 묶음을 핀으로 고정해 주므로, `prosemirror-model` 이 두 벌
 * 로드되는 고전적 사고를 막아 준다.
 */

import { baseKeymap } from '@tiptap/pm/commands'
import { dropCursor } from '@tiptap/pm/dropcursor'
import { gapCursor } from '@tiptap/pm/gapcursor'
import { history } from '@tiptap/pm/history'
import { keydownHandler } from '@tiptap/pm/keymap'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import { EditorState, type Command, type Plugin, type Transaction } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'

import { blockIdPlugin } from './block-id-plugin.ts'
import { clipboardPlugin } from './block-clipboard.ts'
import { imageDropPlugin } from './image-drop.ts'
import { blockSelectionPlugin } from './block-selection-plugin.ts'
import { collapsePlugin } from './collapse-plugin.ts'
import { createKeydownHandler, type EditorKeymapDeps } from './keymap.ts'
import { inputRulesPlugin } from './input-rules.ts'
import { createNodeViews, type NodeViewDeps } from './node-views.ts'
import { containerFor, docToPm } from './pm-adapter.ts'
import { blockSchema } from './schema.ts'
import type { EditorBlock } from './document.ts'
import { slashMenuPlugin } from './slash-menu.ts'
import type { EditorDoc } from './document.ts'

export type CreateEditorOptions = {
  readonly mount: HTMLElement
  readonly doc: EditorDoc
  readonly editable: boolean
  readonly deps: EditorKeymapDeps & NodeViewDeps
  readonly onTransaction: (view: EditorView, tr: Transaction) => void
}

/**
 * `baseKeymap` 에서 우리가 다시 정의한 키를 뺀다.
 *
 * `Enter`·`Backspace`·`Delete` 는 우리 규칙이 있고, `baseKeymap` 의
 * `joinBackward` 계열이 뒤에서 돌면 규칙이 거부한 병합을 **구조적으로** 해버린다.
 * 남기는 것은 `Mod-a`(전체 선택)뿐이다 — 나머지 글자 지우기는 브라우저의
 * contenteditable 이 처리하고 ProseMirror 가 DOM 변화를 읽어 반영한다.
 *
 * `Mod-a` 는 이제 우리 3단 확장(F-12-01)이 먼저 받는다. 여기 남은 것은 그 커맨드가
 * `false` 를 돌려줄 때(캐럿이 어느 블록에도 없을 때)의 폴백이다.
 */
function safeBaseKeymap(): Record<string, Command> {
  const kept: Record<string, Command> = {}
  for (const [key, command] of Object.entries(baseKeymap)) {
    if (key === 'Mod-a') kept[key] = command
  }
  return kept
}

/**
 * 클립보드에 실을 HTML. 스키마의 `toDOM` 을 그대로 쓴다.
 *
 * `DOMSerializer` 는 진짜 DOM 이 필요해서(`document`) 브라우저에서만 돈다. 순수
 * 부분(JSON · 평문)은 `block-clipboard.ts` 에 있고 DOM 없이 테스트된다.
 */
function clipboardHtml(blocks: readonly EditorBlock[]): string {
  const fragment = Fragment.fromArray(blocks.map(containerFor))
  const serialized = DOMSerializer.fromSchema(blockSchema).serializeFragment(fragment, { document })
  const wrapper = document.createElement('div')
  wrapper.append(serialized)
  return wrapper.innerHTML
}

export function createEditor(options: CreateEditorOptions): EditorView {
  const ourKeys = createKeydownHandler(options.deps)
  const baseKeys = keydownHandler(safeBaseKeymap())

  const plugins: Plugin[] = [
    // 순서: 입력 규칙이 슬래시 메뉴보다 앞이어야 `# ` 같은 접두사가 먼저 잡힌다.
    inputRulesPlugin(),
    slashMenuPlugin(),
    // 블록 선택 하이라이트(F-01-09). 상태는 `state.selection` 이 갖고 있고
    // 이 플러그인은 그리기만 한다.
    blockSelectionPlugin(),
    // 이미지 드롭·붙여넣기(F-01-15)는 **클립보드 플러그인보다 앞**이다. 스크린샷을
    // 붙이면 파일과 HTML 이 같이 실려 오는 경우가 있어서, 뒤에 두면 HTML 경로가
    // 먼저 먹는다.
    imageDropPlugin(options.deps),
    // 복사·붙여넣기(F-01-10). 클립보드 HTML 은 스키마의 `toDOM` 으로 만든다 —
    // 화면에 그리는 것과 같은 규칙이라 따로 어긋날 자리가 없다.
    clipboardPlugin(options.deps, clipboardHtml),
    // 접힘(F-01-13). 편집기 DOM 에 속성을 직접 달면 PM 이 다시 그리며 지운다 —
    // 데코레이션으로만 그린다(`collapse-plugin.ts` 머리말).
    collapsePlugin(options.deps.isCollapsed),
    // id 스탬프는 마지막이다. 다른 플러그인이 만든 노드까지 훑어야 한다.
    blockIdPlugin(),
    history(),
    // 원자 블록(divider·image) 앞뒤에 캐럿을 둘 자리를 만든다.
    gapCursor(),
    dropCursor(),
  ]

  const state = EditorState.create({
    schema: blockSchema,
    doc: docToPm(options.doc),
    plugins,
  })

  // `dispatchTransaction` 안에서 `this` 는 타입상 EditorView 가 아니다.
  // 클로저로 잡아 쓰는 편이 캐스팅보다 정직하다.
  const view: EditorView = new EditorView(options.mount, {
    state,
    editable: () => options.editable,
    // ★ IME 게이트가 여기 하나뿐이다 — `createKeydownHandler` 내부.
    handleKeyDown: (v, event) => ourKeys(v, event) || baseKeys(v, event),
    nodeViews: createNodeViews(options.deps),
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr))
      options.onTransaction(view, tr)
    },
    attributes: {
      class: 'blk-editor',
      // 스크린리더가 "편집 가능한 문서 하나"로 읽는다. §7-4 가 단일
      // contenteditable 을 고른 이유 중 하나가 a11y 다.
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': '페이지 본문',
    },
  })

  return view
}
