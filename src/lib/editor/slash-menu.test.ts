/**
 * 슬래시 메뉴 — F-01-04
 *
 * 트리거 조건과 종료 조건이 이 파일의 요점이다. 둘 다 정본이 엣지 케이스로
 * 명시했고, 틀리면 `https://` 를 칠 때마다 메뉴가 뜬다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import { MVP_BLOCK_TYPES } from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { docToPm } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import {
  SLASH_COMMANDS,
  closeSlashMenu,
  filterSlashCommands,
  runSlashCommand,
  slashMenuPlugin,
  slashMenuState,
} from './slash-menu.ts'
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

function stateWith(blocks: EditorBlock[]): EditorState {
  return EditorState.create({
    schema: blockSchema,
    doc: docToPm({ blocks }),
    plugins: [slashMenuPlugin()],
  })
}

function caretAt(state: EditorState, blockId: string, offset: number): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info, `블록을 찾지 못했다: ${blockId}`)
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)),
  )
}

/** 한 글자씩 타이핑. 플러그인 상태는 트랜잭션마다 갱신된다. */
function type(state: EditorState, text: string): EditorState {
  let current = state
  for (const char of text) {
    const { from, to } = current.selection
    current = current.apply(current.tr.insertText(char, from, to))
  }
  return current
}

const deps = { isCollapsed: () => false }

function firstContent(state: EditorState) {
  return state.doc.child(0).child(0).child(0)
}

// ── 카탈로그 ──────────────────────────────────────────────────────────

describe('커맨드 카탈로그', () => {
  test('레지스트리의 MVP 12종이 모두 있다', () => {
    // 카탈로그가 Record<MvpBlockType, …> 이라 타입 검사도 강제하지만,
    // 목록이 실제로 생성되는지 런타임에서도 본다.
    assert.deepEqual(
      SLASH_COMMANDS.map((c) => c.id),
      [...MVP_BLOCK_TYPES],
    )
  })

  test('모든 커맨드에 한글 별칭이 있다', () => {
    for (const command of SLASH_COMMANDS) {
      assert.ok(
        command.aliases.some((a) => /[가-힣]/.test(a)),
        `${command.id} 에 한글 별칭이 없다`,
      )
    }
  })
})

describe('필터 — prefix (정본 미해결 16번의 판단)', () => {
  test('빈 쿼리는 전부 보여준다', () => {
    assert.equal(filterSlashCommands('').length, SLASH_COMMANDS.length)
  })

  test('영문 별칭 앞부분으로 찾는다', () => {
    assert.deepEqual(filterSlashCommands('h1').map((c) => c.id), ['heading_1'])
    assert.deepEqual(filterSlashCommands('todo').map((c) => c.id), ['to_do'])
  })

  test('한글 라벨·별칭 앞부분으로 찾는다', () => {
    assert.deepEqual(filterSlashCommands('인용').map((c) => c.id), ['quote'])
    assert.deepEqual(filterSlashCommands('할일').map((c) => c.id), ['to_do'])
  })

  test('라벨의 공백을 지운 형태도 찾는다', () => {
    // "제목 1" 을 찾으려고 `/제목1` 을 치는 것이 자연스럽다.
    assert.deepEqual(filterSlashCommands('제목1').map((c) => c.id), ['heading_1'])
  })

  test('대소문자를 가리지 않는다', () => {
    assert.deepEqual(filterSlashCommands('H2').map((c) => c.id), ['heading_2'])
  })

  test('중간 일치는 잡지 않는다 — prefix 다', () => {
    // fuzzy 였다면 'ding' 이 heading 들을 잡는다. 예측 가능성을 택했다.
    assert.deepEqual(filterSlashCommands('ding'), [])
  })

  test('매칭이 없으면 빈 배열이다', () => {
    assert.deepEqual(filterSlashCommands('zzzz'), [])
  })
})

// ── 트리거 ────────────────────────────────────────────────────────────

describe('트리거 조건', () => {
  test('빈 블록에서 `/` 는 메뉴를 연다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/')
    const menu = slashMenuState(state)
    assert.equal(menu.active, true)
    assert.equal(menu.query, '')
  })

  test('공백 뒤의 `/` 도 연다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '앞말 /')
    assert.equal(slashMenuState(state).active, true)
  })

  test('`https://` 안의 슬래시로는 열리지 않는다 (정본 엣지 케이스)', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), 'https://')
    assert.equal(slashMenuState(state).active, false)
  })

  test('글자 바로 뒤의 `/` 로는 열리지 않는다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), 'a/')
    assert.equal(slashMenuState(state).active, false)
  })

  test('텍스트를 담지 않는 블록에서는 열리지 않는다', () => {
    const a = nextId()
    const state = stateWith([blk(a, 'divider')])
    assert.equal(slashMenuState(state).active, false)
  })
})

describe('쿼리 추적', () => {
  test('이어 친 글자가 쿼리가 된다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/제목')
    const menu = slashMenuState(state)
    assert.equal(menu.active, true)
    assert.equal(menu.query, '제목')
  })

  test('한 글자 지우면 쿼리가 줄어든다', () => {
    const a = nextId()
    let state = type(caretAt(stateWith([blk(a)]), a, 0), '/인용')
    const head = state.selection.head
    state = state.apply(state.tr.delete(head - 1, head))
    assert.equal(slashMenuState(state).query, '인')
    assert.equal(slashMenuState(state).active, true)
  })
})

describe('종료 조건 (정본 미해결 16번의 판단)', () => {
  test('공백이 들어오면 닫힌다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/제목 ')
    assert.equal(slashMenuState(state).active, false)
  })

  test('매칭 0건이 되면 닫히고 텍스트는 평문으로 남는다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/zzz')
    assert.equal(slashMenuState(state).active, false)
    assert.equal(firstContent(state).textContent, '/zzz')
  })

  test('`/` 를 지우면 닫힌다', () => {
    const a = nextId()
    let state = type(caretAt(stateWith([blk(a)]), a, 0), '/')
    assert.equal(slashMenuState(state).active, true)
    const head = state.selection.head
    state = state.apply(state.tr.delete(head - 1, head))
    assert.equal(slashMenuState(state).active, false)
  })

  test('캐럿이 트리거 앞으로 가면 닫힌다', () => {
    const a = nextId()
    let state = type(caretAt(stateWith([blk(a)]), a, 0), '앞말 /제')
    assert.equal(slashMenuState(state).active, true)
    state = caretAt(state, a, 0)
    assert.equal(slashMenuState(state).active, false)
  })

  test('명시적으로 닫을 수 있다 (Esc)', () => {
    const a = nextId()
    let state = type(caretAt(stateWith([blk(a)]), a, 0), '/제')
    assert.equal(slashMenuState(state).active, true)
    state = state.apply(closeSlashMenu(state.tr))
    assert.equal(slashMenuState(state).active, false)
  })
})

// ── 실행 ──────────────────────────────────────────────────────────────

describe('실행', () => {
  function execute(state: EditorState, id: string): EditorState | null {
    const command = SLASH_COMMANDS.find((c) => c.id === id)
    assert.ok(command, id)
    let next: EditorState | null = null
    const handled = runSlashCommand(
      state,
      (tr: Transaction) => {
        next = state.apply(tr)
      },
      command,
      deps,
    )
    return handled ? next : null
  }

  test('`/쿼리` 가 지워지고 타입이 바뀐다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/제목')
    const next = execute(state, 'heading_1')
    assert.ok(next)
    assert.equal(firstContent(next).type.name, 'heading_1')
    assert.equal(firstContent(next).textContent, '', '`/쿼리` 가 남았다')
  })

  test('앞에 있던 텍스트는 보존된다 (F-01-06 변환형은 텍스트 보존)', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '앞말 /인용')
    const next = execute(state, 'quote')
    assert.ok(next)
    assert.equal(firstContent(next).type.name, 'quote')
    assert.equal(firstContent(next).textContent, '앞말 ')
  })

  test('한 트랜잭션이다 — undo 한 번으로 되돌아간다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/제목')
    let count = 0
    runSlashCommand(state, () => { count += 1 }, SLASH_COMMANDS[1], deps)
    assert.equal(count, 1, '트랜잭션이 두 개면 Cmd+Z 를 두 번 눌러야 한다')
  })

  test('메뉴가 닫혀 있으면 실행하지 않는다', () => {
    const a = nextId()
    const state = caretAt(stateWith([blk(a, 'paragraph', '평문')]), a, 2)
    assert.equal(execute(state, 'heading_1'), null)
  })

  test('빈 블록에서 divider 로 바꿀 수 있다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/구분선')
    const next = execute(state, 'divider')
    assert.ok(next)
    assert.equal(firstContent(next).type.name, 'divider')
  })

  test('텍스트가 남아 있으면 divider 로 바꾸지 않는다 — 텍스트를 버리지 않는다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '지울 수 없는 글 /구분선')
    assert.equal(execute(state, 'divider'), null)
  })

  test('실행 후 메뉴가 닫힌다', () => {
    const a = nextId()
    const state = type(caretAt(stateWith([blk(a)]), a, 0), '/토글')
    const next = execute(state, 'toggle')
    assert.ok(next)
    assert.equal(slashMenuState(next).active, false)
  })
})
