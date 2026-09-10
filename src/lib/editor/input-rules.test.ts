/**
 * 마크다운 단축 입력 · 서식 · 키맵 — F-01-05 / F-01-03 / F-12-01
 *
 * 입력 규칙은 실제 타이핑으로 검증한다. `inputRules` 플러그인의
 * `handleTextInput` 을 직접 불러 "한 글자씩 치는" 상황을 재현한다 — 규칙의
 * 정규식만 단위 테스트하면 "패턴은 맞는데 트리거되지 않는" 경우를 놓친다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { EditorState, TextSelection } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import { blockSchema } from './schema.ts'
import { docToPm } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { inputRulesPlugin } from './input-rules.ts'
import { activeColor, activeFormats, setLink, setTextColor, toggleFormat } from './marks.ts'
import { isBlockSelection, selectBlockCommand } from './block-selection.ts'
import { chain, createEditorKeymap } from './keymap.ts'
import type { EditorBlock } from './document.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(id: string, type = 'paragraph', text = ''): EditorBlock {
  return {
    id,
    type: type as EditorBlock['type'],
    title: text === '' ? [] : [textRun(text)],
    properties: {},
    format: {},
    children: [],
  }
}

/** 입력 규칙 플러그인이 붙은 상태. */
function stateWith(blocks: EditorBlock[]): EditorState {
  return EditorState.create({
    schema: blockSchema,
    doc: docToPm({ blocks }),
    plugins: [inputRulesPlugin()],
  })
}

function caretAt(state: EditorState, blockId: string, offset: number): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info, `블록을 찾지 못했다: ${blockId}`)
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)),
  )
}

/**
 * 문자열을 **한 글자씩** 타이핑한다.
 *
 * `handleTextInput` 을 직접 부르는 이유: 입력 규칙은 "마지막에 들어온 글자"를
 * 트리거로 삼으므로, 텍스트를 한 번에 넣으면 규칙이 돌지 않는다. 실제 타이핑을
 * 재현해야 규칙이 진짜 동작하는지 알 수 있다.
 */
function type(state: EditorState, text: string): EditorState {
  let current = state
  const plugin = current.plugins.find((p) => p.props.handleTextInput)
  assert.ok(plugin, '입력 규칙 플러그인이 없다')

  for (const char of text) {
    const { from, to } = current.selection
    // handleTextInput 은 EditorView 를 받지만 state·dispatch 만 쓴다.
    const view = {
      state: current,
      dispatch: (tr: ReturnType<EditorState['tr']['insertText']>) => {
        current = current.apply(tr)
      },
      composing: false,
    }
    const handled = plugin.props.handleTextInput?.call(plugin, view as never, from, to, char, () => null)
    if (!handled) {
      current = current.apply(current.tr.insertText(char, from, to))
    }
  }
  return current
}

function firstContent(state: EditorState) {
  return state.doc.child(0).child(0).child(0)
}

function shape(state: EditorState): unknown[] {
  const out: unknown[] = []
  state.doc.child(0).forEach((container) => {
    const content = container.child(0)
    out.push([content.type.name, content.isTextblock ? content.textContent : ''])
  })
  return out
}

// ── 블록 접두사 ───────────────────────────────────────────────────────

describe('블록 마크다운 접두사 (레지스트리에서 생성)', () => {
  test('레지스트리의 모든 접두사가 해당 타입을 만든다', () => {
    // 접두사 목록을 여기 다시 적지 않는다 — 레지스트리와 어긋나면
    // "슬래시 메뉴에는 있는데 마크다운으로는 안 되는" 타입이 생긴다.
    const cases: readonly [string, string][] = [
      ['# ', 'heading_1'],
      ['## ', 'heading_2'],
      ['### ', 'heading_3'],
      ['- ', 'bulleted_list_item'],
      ['* ', 'bulleted_list_item'],
      ['+ ', 'bulleted_list_item'],
      ['1. ', 'numbered_list_item'],
      ['1) ', 'numbered_list_item'],
      ['[] ', 'to_do'],
      ['[ ] ', 'to_do'],
      ['[x] ', 'to_do'],
      ['> ', 'toggle'],
      ['" ', 'quote'],
    ]

    for (const [prefix, expected] of cases) {
      const a = nextId()
      const state = type(caretAt(stateWith([blk(a)]), a, 0), prefix)
      assert.equal(firstContent(state).type.name, expected, `접두사 ${JSON.stringify(prefix)}`)
      assert.equal(firstContent(state).textContent, '', '접두사가 텍스트로 남았다')
    }
  })

  test('`[x] ` 는 checked=true 로 만든다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '[x] ')
    assert.deepEqual(firstContent(state).attrs.props, { checked: true })
  })

  test('`[] ` 와 `[ ] ` 는 checked=false 다', () => {
    for (const prefix of ['[] ', '[ ] ']) {
      const a = nextId()
      const state = type(caretAt(stateWith([blk(a)]), a, 0), prefix)
      assert.deepEqual(firstContent(state).attrs.props, { checked: false }, prefix)
    }
  })

  test('접두사 뒤에 이어 쓴 텍스트가 그 블록에 들어간다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '## 제목입니다')
    assert.equal(firstContent(state).type.name, 'heading_2')
    assert.equal(firstContent(state).textContent, '제목입니다')
  })

  test('줄 시작이 아니면 트리거되지 않는다 (F-12-01)', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a, 'paragraph', '앞말')]), a, 2), ' - ')
    assert.equal(firstContent(state).type.name, 'paragraph')
    assert.equal(firstContent(state).textContent, '앞말 - ')
  })

  test('이미 같은 타입이면 접두사를 텍스트로 남긴다', () => {
    // "- - 항목" 을 쓰려는 경우. 변환하면 사용자가 원한 글자가 사라진다.
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a, 'bulleted_list_item')]), a, 0), '- ')
    assert.equal(firstContent(state).type.name, 'bulleted_list_item')
    assert.equal(firstContent(state).textContent, '- ')
  })

  test('block_color 를 유지한다', () => {
    const a = nextId()
    const withColor: EditorBlock = { ...blk(a), format: { block_color: 'blue_background' } }
    const state = type(caretAt(stateWith([withColor]), a, 0), '# ')
    assert.equal(firstContent(state).attrs.format.block_color, 'blue_background')
  })
})

describe('`---` divider', () => {
  test('빈 블록에서 divider 가 되고 뒤에 빈 문단이 생긴다', () => {
    // divider 는 텍스트를 담지 않으므로 캐럿을 둘 자리가 없어진다.
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '---')
    assert.deepEqual(shape(state), [
      ['divider', ''],
      ['paragraph', ''],
    ])
  })

  test('텍스트가 있는 블록에서는 변환하지 않는다 — 텍스트를 버리지 않는다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a, 'paragraph', '내용')]), a, 2), '---')
    assert.deepEqual(shape(state), [['paragraph', '내용---']])
  })
})

// ── 인라인 규칙 ───────────────────────────────────────────────────────

describe('인라인 마크다운', () => {
  function marksOn(state: EditorState, index: number): string[] {
    const content = firstContent(state)
    return content.child(index).marks.map((m) => m.type.name)
  }

  test('`**굵게**` 가 bold 가 된다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '**굵게**')
    assert.equal(firstContent(state).textContent, '굵게')
    assert.deepEqual(marksOn(state, 0), ['bold'])
  })

  test('`*기울임*` 이 italic 이 된다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '*기울임*')
    assert.equal(firstContent(state).textContent, '기울임')
    assert.deepEqual(marksOn(state, 0), ['italic'])
  })

  test('`**` 가 `*` 보다 먼저 매칭된다 — 순서가 규칙이다', () => {
    // 순서가 뒤집히면 `**굵게**` 가 `*굵게*` 로 해석돼 italic 이 된다.
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '**굵게**')
    assert.deepEqual(marksOn(state, 0), ['bold'])
  })

  test('`~~취소선~~` 과 백틱 코드', () => {
    const strike = nextId()
    const s1 = type(caretAt(stateWith([blk(strike)]), strike, 0), '~~지움~~')
    assert.equal(firstContent(s1).textContent, '지움')
    assert.deepEqual(marksOn(s1, 0), ['strikethrough'])

    const code = nextId()
    const s2 = type(caretAt(stateWith([blk(code)]), code, 0), '`코드`')
    assert.equal(firstContent(s2).textContent, '코드')
    assert.deepEqual(marksOn(s2, 0), ['code'])
  })

  test('변환 뒤에 이어 쓴 글자에는 서식이 붙지 않는다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '**굵게**보통')
    assert.equal(firstContent(state).textContent, '굵게보통')
    assert.deepEqual(marksOn(state, 0), ['bold'])
    assert.deepEqual(marksOn(state, 1), [])
  })

  test('구분자 안쪽이 공백으로 끝나면 매칭하지 않는다', () => {
    // `2 * 3 * 4` 를 쓰다가 기울임이 되면 안 된다.
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '2 * 3 * 4')
    assert.equal(firstContent(state).textContent, '2 * 3 * 4')
    assert.deepEqual(marksOn(state, 0), [])
  })

  test('앞말 뒤에서도 인라인 규칙은 동작한다 — 줄 시작 제한은 블록 규칙만이다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '앞말 **굵게**')
    assert.equal(firstContent(state).textContent, '앞말 굵게')
    assert.deepEqual(marksOn(state, 1), ['bold'])
  })
})

// ── 서식 커맨드 ───────────────────────────────────────────────────────

describe('서식 커맨드 (F-12-01 Cmd+B/I/U/E)', () => {
  function selectAll(state: EditorState, blockId: string): EditorState {
    const info = findContainerById(state.doc, blockId)
    assert.ok(info)
    const from = info.contentPos + 1
    return state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, from, from + info.contentNode.content.size),
      ),
    )
  }

  function apply(state: EditorState, command: ReturnType<typeof toggleFormat>): EditorState {
    let next = state
    command(state, (tr) => {
      next = state.apply(tr)
    })
    return next
  }

  test('토글이 켜지고 꺼진다', () => {
    const a = nextId()
    let state = selectAll(stateWith([blk(a, 'paragraph', '내용')]), a)

    state = apply(state, toggleFormat('bold'))
    assert.deepEqual(activeFormats(state), ['bold'])

    state = selectAll(state, a)
    state = apply(state, toggleFormat('bold'))
    assert.deepEqual(activeFormats(state), [])
  })

  test('여러 서식을 겹칠 수 있다', () => {
    const a = nextId()
    let state = selectAll(stateWith([blk(a, 'paragraph', '내용')]), a)
    for (const mark of ['bold', 'italic', 'underline', 'code'] as const) {
      state = selectAll(state, a)
      state = apply(state, toggleFormat(mark))
    }
    assert.deepEqual(activeFormats(selectAll(state, a)).sort(), ['bold', 'code', 'italic', 'underline'])
  })
})

describe('색 (토글이 아니다)', () => {
  function selectAll(state: EditorState, blockId: string): EditorState {
    const info = findContainerById(state.doc, blockId)
    assert.ok(info)
    const from = info.contentPos + 1
    return state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, from, from + info.contentNode.content.size),
      ),
    )
  }
  const apply = (state: EditorState, command: ReturnType<typeof setTextColor>) => {
    let next = state
    command(state, (tr) => {
      next = state.apply(tr)
    })
    return next
  }

  test('색을 고르고 다른 색으로 갈아탄다', () => {
    const a = nextId()
    let state = selectAll(stateWith([blk(a, 'paragraph', '내용')]), a)

    state = apply(state, setTextColor('red'))
    assert.equal(activeColor(selectAll(state, a)), 'red')

    // 갈아타기. 겹쳐 쌓이면 직렬화에서 하나가 사라진다.
    state = apply(selectAll(state, a), setTextColor('blue_background'))
    assert.equal(activeColor(selectAll(state, a)), 'blue_background')
    assert.equal(firstContent(state).child(0).marks.length, 1, '색 마크가 겹쳐 쌓였다')
  })

  test("'default' 는 색을 제거한다 — 색이 아니라 색 없음이다", () => {
    const a = nextId()
    let state = apply(selectAll(stateWith([blk(a, 'paragraph', '내용')]), a), setTextColor('green'))
    state = apply(selectAll(state, a), setTextColor('default'))
    assert.equal(activeColor(selectAll(state, a)), 'default')
    assert.equal(firstContent(state).child(0).marks.length, 0)
  })
})

describe('링크', () => {
  test('범위에 링크를 걸고 다른 URL 로 갈아탄다', () => {
    const a = nextId()
    const base = stateWith([blk(a, 'paragraph', '링크텍스트')])
    const info = findContainerById(base.doc, a)
    assert.ok(info)
    const from = info.contentPos + 1
    const selected = base.apply(
      base.tr.setSelection(TextSelection.create(base.doc, from, from + info.contentNode.content.size)),
    )

    let state = selected
    setLink('https://a.example')(selected, (tr) => {
      state = selected.apply(tr)
    })
    assert.equal(firstContent(state).child(0).marks[0].attrs.href, 'https://a.example')

    const again = state
    setLink('https://b.example')(again, (tr) => {
      state = again.apply(tr)
    })
    assert.equal(firstContent(state).child(0).marks.length, 1, '링크가 겹쳐 쌓였다')
    assert.equal(firstContent(state).child(0).marks[0].attrs.href, 'https://b.example')
  })

  test('선택이 없으면 링크를 걸지 않는다', () => {
    const a = nextId()
    const state = caretAt(stateWith([blk(a, 'paragraph', '텍스트')]), a, 1)
    assert.equal(setLink('https://x.example')(state, () => {}), false)
  })
})

// ── 키맵 ──────────────────────────────────────────────────────────────

describe('키맵', () => {
  const deps = { isCollapsed: () => false }

  test('F-12-01 P0 최소 세트가 전부 바인딩돼 있다', () => {
    const keys = Object.keys(createEditorKeymap(deps))
    for (const key of [
      'Enter', 'Shift-Enter', 'Backspace', 'Delete', 'Tab', 'Shift-Tab',
      'Escape', 'Mod-b', 'Mod-i', 'Mod-u', 'Mod-e', 'Mod-Shift-s',
      'Mod-z', 'Mod-Shift-z',
    ]) {
      assert.ok(keys.includes(key), `${key} 바인딩이 없다`)
    }
  })

  test('숫자 단축키가 블록 타입을 바꾼다', () => {
    const keymap = createEditorKeymap(deps)
    const a = nextId()
    const state = caretAt(stateWith([blk(a, 'paragraph', '내용')]), a, 0)

    let next = state
    const handled = keymap['Mod-Alt-2'](state, (tr) => {
      next = state.apply(tr)
    })
    assert.ok(handled)
    assert.equal(firstContent(next).type.name, 'heading_2')
  })

  test('Mod-k 는 promptLink 가 있을 때만 바인딩된다', () => {
    assert.equal('Mod-k' in createEditorKeymap(deps), false)
    let called = 0
    const withPrompt = createEditorKeymap({ ...deps, promptLink: () => { called += 1 } })
    assert.ok('Mod-k' in withPrompt)
    withPrompt['Mod-k'](stateWith([blk(nextId())]), () => {})
    assert.equal(called, 1)
  })

  test('Escape 는 블록 선택 모드로 바꾼다', () => {
    const a = nextId()
    const state = caretAt(stateWith([blk(a, 'paragraph', '내용')]), a, 1)
    let next = state
    assert.ok(selectBlockCommand()(state, (tr) => { next = state.apply(tr) }))
    assert.ok(isBlockSelection(next.selection))
    const info = findContainerById(next.doc, a)
    assert.ok(info)
    assert.equal(next.selection.from, info.pos)
  })

  test('블록 선택 상태에서 Escape 를 다시 누르면 편집 모드로 돌아온다', () => {
    const a = nextId()
    const keymap = createEditorKeymap(deps)
    const state = caretAt(stateWith([blk(a, 'paragraph', '내용')]), a, 1)

    let selected = state
    assert.ok(keymap.Escape(state, (tr) => { selected = state.apply(tr) }))
    assert.ok(isBlockSelection(selected.selection))

    let back = selected
    assert.ok(keymap.Escape(selected, (tr) => { back = selected.apply(tr) }))
    assert.equal(isBlockSelection(back.selection), false)
    // 캐럿은 그 블록 안으로 돌아온다.
    assert.equal(back.selection.$from.parent.textContent, '내용')
  })
})

describe('chain — 순서가 동작을 정의한다', () => {
  test('첫 성공에서 멈춘다', () => {
    const calls: string[] = []
    const yes = () => { calls.push('yes'); return true }
    const no = () => { calls.push('no'); return false }

    const state = stateWith([blk(nextId())])
    assert.equal(chain(no, yes, no)(state, () => {}), true)
    assert.deepEqual(calls, ['no', 'yes'])
  })

  test('전부 실패하면 false 다 — 기본 동작으로 넘어간다', () => {
    const state = stateWith([blk(nextId())])
    assert.equal(chain(() => false, () => false)(state, () => {}), false)
  })
})
