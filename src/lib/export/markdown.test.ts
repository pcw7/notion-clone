/**
 * 페이지 본문 → Markdown — F-09-14 · F-09-22 (DB 없음)
 *
 * **기대 문자열을 손으로 적는 테스트만으로는 부족하다.** 이스케이프와 강조 구분자는
 * "우리 생각에는 맞는" 글자가 렌더러에서 다르게 읽히는 곳이다. 그래서 출력을
 * CommonMark 기준 구현(micromark + GFM)에 통과시켜 **읽힌 결과**를 본다.
 *
 * 이 파일이 지키는 것.
 *
 *   ① **사용자가 쓴 글자는 글자로 돌아온다.** `*별*` · `1. ` · `# ` 가 서식이 되지 않는다
 *   ② **서식은 이웃 글자와 무관하게 서식으로 읽힌다** — `**"인용"**입니다` 가 굵게다
 *   ③ **구조가 렌더러에서 유지된다** — 목록 · 토글 · 인용의 자식이 그 안에 남는다
 *   ④ **잃은 것은 센다** — 색 · 편 중첩 · 뺀 참조 · 모르는 블록
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

import { DEFAULT_ANNOTATIONS, textRun, type Annotations, type RichTextRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import type { EditorBlock } from '../editor/document.ts'
import {
  isSafeLinkUrl,
  pageToMarkdown,
  type MarkdownLinks,
  type MarkdownLosses,
} from './markdown.ts'

// ── 도우미 ────────────────────────────────────────────────────────────

const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }

function render(markdown: string): string {
  return micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  })
    // 렌더러가 태그 앞에 넣는 줄바꿈은 구조와 무관하다. `<br />` 뒤의 줄바꿈은 글자 쪽이라 남긴다.
    .replace(/\n+</g, '<')
    .trim()
}

/** 렌더된 HTML 에서 글자만. 줄바꿈 태그는 줄바꿈으로 되돌린다. */
function textOf(html: string): string {
  return html
    .replace(/<br \/>\n?/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function convert(
  blocks: readonly EditorBlock[],
  links: MarkdownLinks = NO_LINKS,
): { markdown: string; html: string; losses: MarkdownLosses } {
  const { markdown, losses } = pageToMarkdown({ title: [textRun('T')], doc: { blocks } }, links, {
    untitled: '제목 없음',
  })
  assert.ok(markdown.startsWith('# T\n'), markdown)
  return { markdown, html: render(markdown).replace(/^<h1>T<\/h1>/, ''), losses }
}

function block(
  type: string,
  title: string | readonly RichTextRun[] = '',
  extra: Partial<Omit<EditorBlock, 'id' | 'type' | 'title'>> = {},
): EditorBlock {
  return {
    id: randomUUID(),
    type: type as BlockType,
    title: typeof title === 'string' ? (title === '' ? [] : [textRun(title)]) : title,
    ...extra,
  }
}

const run = (content: string, annotations: Partial<Annotations> = {}): RichTextRun =>
  textRun(content, annotations)

function linkRun(content: string, url: string, annotations: Partial<Annotations> = {}): RichTextRun {
  return { ...textRun(content, annotations), href: url, text: { content, link: { url } } }
}

/** 태그 하나의 안쪽 글자. 같은 태그가 여럿이면 전부. */
function tagTexts(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs'))].map((m) => textOf(m[1]))
}

// ── ① 글자는 글자로 ───────────────────────────────────────────────────

/** 서식 문법처럼 생긴 사용자 글자. 전부 **글자로** 돌아와야 한다. */
const LOOKS_LIKE_SYNTAX = [
  '*별* _밑줄_ **굵게 아님**',
  '[괄호](주소 아님) ![이미지 아님](x)',
  '<b>태그 아님</b> <!-- 주석 아님 -->',
  '~물결~ ~~취소 아님~~',
  '역슬래시 \\ 와 끝\\',
  '`코드 아님`',
  'a | b | c',
  '&amp; &copy; &#35; AT&T',
  '# 제목 아님',
  '###### 여섯',
  '> 인용 아님',
  '- 목록 아님',
  '+ 목록 아님',
  '1. 번호 아님',
  '12) 번호 아님',
  '===',
  '---',
  '***',
  '    네 칸 들여쓰기',
  '\t탭으로 시작',
  '[^1] 각주 아님',
  '- [ ] 할 일 아님',
  '$달러$ 와 %퍼센트%',
  'www.example.com 은 글자로 남는다',
]

describe('① 사용자가 쓴 글자는 글자로 돌아온다', () => {
  for (const text of LOOKS_LIKE_SYNTAX) {
    test(`문단: ${JSON.stringify(text)}`, () => {
      const { html } = convert([block('paragraph', text)])
      assert.equal(textOf(html), text, html)
      assert.ok(!/<(h\d|ul|ol|li|blockquote|pre|hr|del|em|strong|img|table)\b/.test(html), html)
    })
  }

  test('목록 항목 · 제목 안에서도 같다', () => {
    for (const text of LOOKS_LIKE_SYNTAX) {
      const li = convert([block('bulleted_list_item', text)]).html
      assert.equal(textOf(li), text, li)
      assert.equal((li.match(/<li>/g) ?? []).length, 1, li)

      // 제목은 한 줄이고 앞뒤 공백을 렌더러가 벗긴다.
      const h = convert([block('heading_2', text)]).html
      assert.equal(textOf(h), text.trim(), h)
    }
  })

  test('줄바꿈(Shift+Enter)은 줄바꿈으로 읽히고, 이어지는 줄의 머리도 글자로 남는다', () => {
    const text = 'a\n# b\n- c\n    d\n1. e'
    const { html } = convert([block('paragraph', text)])
    assert.equal((html.match(/<br \/>/g) ?? []).length, 4, html)
    assert.equal(textOf(html), text, html)
  })

  test('블록 양끝의 줄바꿈은 역슬래시 글자를 남기지 않는다', () => {
    const { html } = convert([block('paragraph', '\n가운데\n')])
    assert.equal(textOf(html), '가운데', html)
  })

  test('빈 줄(연속 줄바꿈)도 문단을 끊지 않는다', () => {
    const { html } = convert([block('paragraph', 'a\n\nb')])
    assert.equal((html.match(/<p>/g) ?? []).length, 1, html)
    assert.equal(textOf(html), 'a\n\nb', html)
  })
})

// ── ② 서식은 서식으로 ─────────────────────────────────────────────────

const EMPHASIS_TAGS: Readonly<Record<'bold' | 'italic' | 'strikethrough', string>> = {
  bold: 'strong',
  italic: 'em',
  strikethrough: 'del',
}

describe('② 서식은 이웃 글자와 무관하게 서식으로 읽힌다', () => {
  test('★ 문장부호로 끝난 굵게 뒤에 조사가 붙어도 굵게다', () => {
    const { html, markdown } = convert([block('paragraph', [run('"인용"', { bold: true }), run('입니다')])])
    // `**"인용"**입니다` 는 렌더러에서 굵게가 풀린다(실측). 그 자리만 HTML 로 떨어진다.
    assert.deepEqual(tagTexts(html, 'strong'), ['"인용"'], `${markdown}\n${html}`)
    assert.equal(textOf(html), '"인용"입니다')
  })

  test('되는 자리는 마크다운 구분자 그대로 쓴다 — 파일을 사람이 읽을 수 있어야 한다', () => {
    const { markdown } = convert([block('paragraph', [run('중요', { bold: true }), run('합니다')])])
    assert.ok(markdown.includes('**중요**합니다'), markdown)
  })

  // 이웃 글자 × 내용 양끝 × 서식 조합을 전부 돈다. 하나라도 구분자가 새면
  // 글자에 `*` · `~` 가 끼어 `textOf` 가 원문과 달라진다.
  const BEFORE = ['', '가', 'a', ' ', '.', '"', '*']
  const CORE = ['중요', '"인용"', '.', 'a*b', '~x~', '(괄호)', '😀']
  const AFTER = ['', '입니다', 'b', ' ', '!', '"', '~']
  const COMBOS: ReadonlyArray<Partial<Annotations>> = [
    { bold: true },
    { italic: true },
    { strikethrough: true },
    { bold: true, italic: true },
    { bold: true, strikethrough: true },
    { italic: true, strikethrough: true },
    { bold: true, italic: true, strikethrough: true },
    { bold: true, code: true },
    { italic: true, underline: true },
  ]

  test('이웃 글자 × 내용 × 서식 조합 전부', () => {
    let checked = 0
    for (const annotations of COMBOS) {
      for (const before of BEFORE) {
        for (const core of CORE) {
          for (const after of AFTER) {
            const runs = [run(before), run(core, annotations), run(after)].filter(
              (r) => r.text?.content !== '',
            )
            const { html, markdown } = convert([block('paragraph', runs)])
            const where = `${JSON.stringify([before, core, after, annotations])}\n${markdown}\n${html}`

            // 문단 끝의 공백은 어느 렌더러에서도 사라진다(보이지 않는 글자다).
            assert.equal(textOf(html), (before + core + after).trimEnd(), where)
            for (const [flag, tag] of Object.entries(EMPHASIS_TAGS)) {
              if (annotations[flag as keyof typeof EMPHASIS_TAGS]) {
                assert.deepEqual(tagTexts(html, tag), [core], where)
              }
            }
            if (annotations.code) assert.deepEqual(tagTexts(html, 'code'), [core], where)
            if (annotations.underline) assert.deepEqual(tagTexts(html, 'u'), [core], where)
            checked += 1
          }
        }
      }
    }
    assert.equal(checked, COMBOS.length * BEFORE.length * CORE.length * AFTER.length)
  })

  test('서로 다른 서식의 런이 붙어 있어도 짝이 섞이지 않는다', () => {
    const cases: Array<[RichTextRun[], Record<string, string[]>]> = [
      [[run('a', { bold: true }), run('b', { italic: true })], { strong: ['a'], em: ['b'] }],
      [[run('a', { bold: true }), run('b', { bold: true, italic: true })], { strong: ['a', 'b'], em: ['b'] }],
      [[run('가', { italic: true }), run('"나"', { bold: true }), run('다')], { em: ['가'], strong: ['"나"'] }],
      [[run('x', { strikethrough: true }), run('y', { strikethrough: true, bold: true })], { del: ['x', 'y'], strong: ['y'] }],
      [[run('a', { italic: true }), run('b', { italic: true, code: true })], { em: ['a', 'b'], code: ['b'] }],
    ]
    for (const [runs, expected] of cases) {
      const { html, markdown } = convert([block('paragraph', runs)])
      const where = `${markdown}\n${html}`
      assert.equal(textOf(html), runs.map((r) => r.text?.content).join(''), where)
      for (const [tag, texts] of Object.entries(expected)) {
        assert.deepEqual(tagTexts(html, tag).sort(), [...texts].sort(), where)
      }
    }
  })

  test('서식 양끝의 공백은 구분자 밖으로 나간다 — `** 굵게**` 는 굵게가 아니다', () => {
    const { html } = convert([block('paragraph', [run('앞'), run(' 굵게 ', { bold: true }), run('뒤')])])
    assert.deepEqual(tagTexts(html, 'strong'), ['굵게'], html)
    assert.equal(textOf(html), '앞 굵게 뒤')
  })

  test('코드 스팬은 내용의 백틱보다 긴 울타리를 쓴다', () => {
    for (const code of ['a`b', '``', '` x `', ' 양끝 공백 ', '*별*']) {
      const { html } = convert([block('paragraph', [run(code, { code: true })])])
      assert.deepEqual(tagTexts(html, 'code'), [code], html)
    }
  })

  test('링크 — 주소의 공백 · 괄호는 인코딩되고 글자의 서식은 남는다', () => {
    const { html } = convert([
      block('paragraph', [run('보기: '), linkRun('링크', 'https://e.com/a b(c)', { bold: true })]),
    ])
    assert.ok(html.includes('<a href="https://e.com/a%20b%28c%29"><strong>링크</strong></a>'), html)
  })

  test('★ 위험한 스킴의 링크는 걸지 않고 글자만 남긴다 — 센다', () => {
    const { html, markdown, losses } = convert([
      block('paragraph', [
        linkRun('하나', 'javascript:alert(1)'),
        run(' '),
        linkRun('둘', ' java\tscript:alert(1)'),
        run(' '),
        linkRun('셋', 'https://ok.example'),
      ]),
    ])
    assert.equal((html.match(/<a /g) ?? []).length, 1, html)
    assert.ok(!markdown.toLowerCase().includes('script:'), markdown)
    assert.equal(textOf(html), '하나 둘 셋')
    assert.equal(losses.unsafeLink, 2)
  })

  test('isSafeLinkUrl — 스킴이 없는 상대 주소는 받는다', () => {
    assert.equal(isSafeLinkUrl('하위%20페이지.md'), true)
    assert.equal(isSafeLinkUrl('#anchor'), true)
    assert.equal(isSafeLinkUrl('mailto:a@b.c'), true)
    assert.equal(isSafeLinkUrl('JAVASCRIPT:x'), false)
    assert.equal(isSafeLinkUrl('data:text/html,x'), false)
  })

  test('수식은 코드 스팬의 `$…$`, 멘션은 글자다', () => {
    const equation: RichTextRun = {
      type: 'equation',
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: 'a*b*c',
      href: null,
      equation: { expression: 'a*b*c' },
    }
    const mention: RichTextRun = {
      type: 'mention',
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: '@박*씨',
      href: null,
      mention: { type: 'user' },
    }
    const { html } = convert([block('paragraph', [equation, run(' '), mention])])
    assert.deepEqual(tagTexts(html, 'code'), ['$a*b*c$'], html)
    assert.equal(textOf(html), '$a*b*c$ @박*씨')
  })
})

// ── ③ 구조 ────────────────────────────────────────────────────────────

describe('③ 구조가 렌더러에서 유지된다', () => {
  test('제목 세 단계 · 구분선 · 인용', () => {
    const { html } = convert([
      block('heading_1', 'A'),
      block('heading_2', 'B'),
      block('heading_3', 'C'),
      block('divider'),
      block('quote', '인용'),
    ])
    assert.equal(html, '<h1>A</h1><h2>B</h2><h3>C</h3><hr /><blockquote><p>인용</p></blockquote>')
  })

  test('번호 목록은 형제가 끊기면 1 부터 다시 센다', () => {
    const { markdown, html } = convert([
      block('numbered_list_item', 'a'),
      block('numbered_list_item', 'b'),
      block('paragraph', 'p'),
      block('numbered_list_item', 'c'),
    ])
    assert.ok(markdown.includes('1. a\n2. b\n\np\n\n1. c'), markdown)
    assert.equal(html, '<ol><li>a</li><li>b</li></ol><p>p</p><ol><li>c</li></ol>')
  })

  test('★ 빈 문단을 사이에 둔 두 목록은 하나로 합쳐지지 않는다', () => {
    const { html } = convert([
      block('numbered_list_item', 'a'),
      block('paragraph'),
      block('numbered_list_item', 'b'),
    ])
    assert.equal((html.match(/<ol>/g) ?? []).length, 2, html)
  })

  test('할 일 — 체크 상태가 체크박스로 읽힌다', () => {
    const { html } = convert([
      block('to_do', '안 함', { properties: { checked: false } }),
      block('to_do', '함', { properties: { checked: true } }),
    ])
    assert.equal(
      html,
      '<ul><li><input type="checkbox" disabled="" /> 안 함</li><li><input type="checkbox" disabled="" checked="" /> 함</li></ul>',
    )
  })

  test('중첩 목록 — 글머리표 > 글머리표 > 번호', () => {
    const { html } = convert([
      block('bulleted_list_item', 'a', {
        children: [block('bulleted_list_item', 'b', { children: [block('numbered_list_item', 'c')] })],
      }),
      block('bulleted_list_item', 'd'),
    ])
    assert.equal(html, '<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>')
  })

  test('목록 항목 밑의 문단 자식은 그 항목 안에 남는다', () => {
    const { html } = convert([
      block('numbered_list_item', 'a', { children: [block('paragraph', '자식')] }),
      block('numbered_list_item', 'b'),
    ])
    assert.equal((html.match(/<li>/g) ?? []).length, 2, html)
    assert.ok(html.includes('<p>자식</p></li>'), html)
  })

  test('토글은 details 이고 자식은 마크다운으로 해석된다 · 요약의 서식은 HTML 이다', () => {
    const { html } = convert([
      block('toggle', [run('요약', { bold: true }), run(' <끝>')], {
        children: [block('paragraph', [run('본문', { italic: true })])],
      }),
    ])
    assert.equal(
      html,
      '<details><summary><strong>요약</strong> &lt;끝&gt;</summary><p><em>본문</em></p></details>',
    )
  })

  // `</details>` 한 줄은 CommonMark 에서 HTML 블록을 시작하고 빈 줄까지 이어진다. 토글이
  // 최상위에 있었다면 바로 뒤의 `- b` 를 삼킨다. 자식을 항목 칸만큼 **들여 쓰는 것**이
  // 그 블록을 항목 안에 가둔다 — 들여쓰기가 모자란 `- b` 가 항목을 닫기 때문이다.
  test('목록 안의 토글 뒤 항목이 HTML 블록에 삼켜지지 않는다 — 자식 들여쓰기가 가둔다', () => {
    const { html } = convert([
      block('bulleted_list_item', 'a', {
        children: [block('toggle', 't', { children: [block('paragraph', 'x')] })],
      }),
      block('bulleted_list_item', 'b'),
      block('paragraph', '끝'),
    ])
    assert.equal((html.match(/<li>/g) ?? []).length, 2, html)
    assert.ok(html.indexOf('</details>') < html.lastIndexOf('<li>'), html)
    assert.ok(html.endsWith('<p>끝</p>'), html)
  })

  test('콜아웃은 aside 안의 문단이다', () => {
    const { html } = convert([block('callout', '콜아웃', { children: [block('bulleted_list_item', '자식')] })])
    assert.equal(html, '<aside><p>콜아웃</p><ul><li>자식</li></ul></aside>')
  })

  test('인용의 자식은 인용 안에 남는다', () => {
    const { html } = convert([block('quote', '인용', { children: [block('paragraph', '자식')] })])
    assert.equal(html, '<blockquote><p>인용</p><p>자식</p></blockquote>')
  })

  test('★ 문단 밑 자식은 같은 층으로 편다 — 코드 블록이 되지 않는다 · 센다', () => {
    const { html, losses } = convert([
      block('paragraph', '부모', { children: [block('paragraph', '자식'), block('bulleted_list_item', '목록')] }),
    ])
    assert.equal(html, '<p>부모</p><p>자식</p><ul><li>목록</li></ul>')
    assert.equal(losses.flattened, 2)
  })

  test('빈 블록들', () => {
    const { html } = convert([
      block('heading_1'),
      block('bulleted_list_item'),
      block('quote'),
      block('callout'),
      block('toggle'),
      block('paragraph'),
    ])
    assert.equal(html, '<h1></h1><ul><li></li></ul><blockquote></blockquote><aside></aside><details><summary></summary></details>')
  })
})

// ── ④ 참조 · 잃은 것 ─────────────────────────────────────────────────

describe('④ 참조와 잃은 것', () => {
  test('하위 페이지 참조는 호출자가 준 주소 · 제목으로 잇는다', () => {
    const child = block('page')
    const { html } = convert([child], {
      page: (id) => (id === child.id ? { href: '하위 [페이지] abc.md', title: '하위 [페이지]' } : null),
      image: () => null,
    })
    const href = /href="([^"]+)"/.exec(html)?.[1] ?? ''
    assert.equal(decodeURI(href), '하위 [페이지] abc.md', html)
    assert.equal(textOf(html), '하위 [페이지]')
  })

  test('★ 호출자가 뺀 참조는 흔적 없이 빠지고 센다', () => {
    const { html, losses } = convert([block('paragraph', '앞'), block('page'), block('paragraph', '뒤')])
    assert.equal(html, '<p>앞</p><p>뒤</p>')
    assert.equal(losses.omittedPages, 1)
  })

  test('이미지 — 우리 파일은 호출자의 경로로, 뺀 것은 센다, 빈 블록은 세지 않는다', () => {
    const fileId = randomUUID()
    const links: MarkdownLinks = {
      page: () => null,
      image: (source) => (source.kind === 'file' && source.fileId === fileId ? '페이지/사진 1.png' : null),
    }
    const { html, losses } = convert(
      [
        block('image', [], { properties: { source: { type: 'file', file_id: fileId }, caption: [textRun('캡션 *별*')] } }),
        block('image', [], { properties: { source: { type: 'file', file_id: randomUUID() } } }),
        block('image'),
      ],
      links,
    )
    assert.equal(html, '<p><img src="%ED%8E%98%EC%9D%B4%EC%A7%80/%EC%82%AC%EC%A7%84%201.png" alt="캡션 *별*" /></p>')
    assert.equal(losses.omittedImages, 1)
  })

  test('★ 모르는 블록은 주석으로 남고, 저장된 타입 이름이 주석을 깨지 못한다', () => {
    const { markdown, html, losses } = convert([
      block('unsupported', [], { properties: { original_type: 'synced_block' } }),
      block('unsupported', [], { properties: { original_type: 'x --><script>alert(1)</script><!--' } }),
      block('paragraph', '뒤'),
    ])
    assert.ok(markdown.includes('<!-- unsupported block type="synced_block" id="'), markdown)
    assert.ok(markdown.includes('type="unknown"'), markdown)
    assert.ok(!html.includes('<script'), html)
    assert.ok(html.endsWith('<p>뒤</p>'), html)
    assert.equal(losses.unsupported, 2)
  })

  test('색은 옮기지 못한다 — 글자색 런과 블록 색을 센다', () => {
    const { html, losses } = convert([
      block('paragraph', [run('빨강', { color: 'red' }), run('보통')], { format: { block_color: 'blue_background' } }),
    ])
    assert.equal(html, '<p>빨강보통</p>')
    assert.equal(losses.color, 2)
  })

  test('무손실 문서는 손실이 전부 0 이다', () => {
    const { losses } = convert([block('paragraph', '평범'), block('bulleted_list_item', '목록')])
    assert.deepEqual(losses, {
      color: 0,
      flattened: 0,
      unsafeLink: 0,
      unsupported: 0,
      omittedPages: 0,
      omittedImages: 0,
    })
  })
})

describe('파일 머리', () => {
  test('제목이 비면 대체 제목을 쓴다 · 끝의 ` #` 이 닫는 표지로 사라지지 않는다', () => {
    const empty = pageToMarkdown({ title: [], doc: { blocks: [] } }, NO_LINKS, { untitled: '제목 없음' })
    assert.equal(empty.markdown, '# 제목 없음\n')

    const sharp = pageToMarkdown({ title: [textRun('C# #')], doc: { blocks: [] } }, NO_LINKS, { untitled: 'x' })
    assert.equal(render(sharp.markdown), '<h1>C# #</h1>')
  })

  test('같은 문서는 같은 글자가 된다 · 끝은 줄바꿈 하나다', () => {
    const blocks = [block('paragraph', 'a'), block('toggle', 't', { children: [block('to_do', 'x')] })]
    const a = pageToMarkdown({ title: [textRun('T')], doc: { blocks } }, NO_LINKS, { untitled: 'x' })
    const b = pageToMarkdown({ title: [textRun('T')], doc: { blocks } }, NO_LINKS, { untitled: 'x' })
    assert.equal(a.markdown, b.markdown)
    assert.ok(a.markdown.endsWith('\n') && !a.markdown.endsWith('\n\n'), JSON.stringify(a.markdown))
  })
})
