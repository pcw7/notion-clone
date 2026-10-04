/**
 * 마크다운 → 본문 — 잔여 묶음 8m-1 (F-09-12 · 순수)
 *
 *   ① 첫 `# 제목` 은 페이지 제목 — 본문에서 빠진다 · 없으면 null
 *   ② 블록 — 헤딩(4~6 은 3) · 문단 · 목록 셋(중첩은 자식) · 코드(언어) · 인용 · 구분선 · 외부 이미지
 *   ③ 글자 — 굵게 · 기울임 · 취소선 · 코드 · 링크(안전한 것만) · 이스케이프
 *   ④ 우리 내보내기의 꼴 — `<details><summary>` 는 토글 · `<aside>` 는 콜아웃 — 왕복이 닫힌다
 *   ⑤ 옮기지 못한 것은 센다 — 표(문단으로 남긴다) · HTML · 로컬 이미지 · 위험한 링크 · 꾸밈이 너무 많은 줄 · 주석은 세지 않는다
 *   ⑥ 평문 — 빈 줄로 나뉜 덩이가 문단
 *   ⑦ 만든 문서는 서버의 문서 검증을 지난다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toPlainText, MAX_RICH_TEXT_RUNS } from '../contracts/rich-text.ts'
import { validateDoc, type EditorBlock } from '../editor/document.ts'
import { codeLanguageFromFence, markdownToDoc, textToDoc } from './markdown.ts'

/** 블록의 모양 — 타입 · 글자 · (있으면) 자식. */
const shape = (blocks: readonly EditorBlock[]): unknown[] =>
  blocks.map((b) => (b.children && b.children.length > 0 ? [b.type, toPlainText(b.title), shape(b.children)] : [b.type, toPlainText(b.title)]))

test('★ ① 첫 # 제목은 페이지 제목 · 없으면 null', () => {
  const withTitle = markdownToDoc('# 회의록\n\n본문')
  assert.equal(withTitle.title, '회의록')
  assert.deepEqual(shape(withTitle.doc.blocks), [['paragraph', '본문']])
  assert.equal(markdownToDoc('본문 먼저\n\n# 나중 제목').title, null)
  assert.equal(markdownToDoc('## 둘째 단계').title, null)
})

test('★ ② 블록 — 헤딩 · 문단 · 목록(중첩) · 할 일 · 코드 · 인용 · 구분선 · 외부 이미지', () => {
  const md = [
    '## 소제목', '#### 깊은 제목', '', '문단 하나', '', '- 하나', '  - 하위', '- 둘', '', '1. 첫째', '2. 둘째', '',
    '- [ ] 할 일', '- [x] 끝남', '', '```ts', 'const a = 1 < 2', '```', '', '> 인용', '', '---', '', '![그림](https://example.com/a.png)',
  ].join('\n')
  const { doc } = markdownToDoc(md)
  assert.deepEqual(shape(doc.blocks), [
    ['heading_2', '소제목'],
    ['heading_3', '깊은 제목'],
    ['paragraph', '문단 하나'],
    ['bulleted_list_item', '하나', [['bulleted_list_item', '하위']]],
    ['bulleted_list_item', '둘'],
    ['numbered_list_item', '첫째'],
    ['numbered_list_item', '둘째'],
    ['to_do', '할 일'],
    ['to_do', '끝남'],
    ['code', 'const a = 1 < 2'],
    ['quote', '인용'],
    ['divider', ''],
    ['image', ''],
  ])
  const todo = doc.blocks.filter((b) => b.type === 'to_do').map((b) => b.properties?.checked)
  assert.deepEqual(todo, [false, true])
  assert.equal(doc.blocks.find((b) => b.type === 'code')?.properties?.language, 'typescript', '별칭(ts)은 저장 이름으로')
  assert.deepEqual(doc.blocks.find((b) => b.type === 'image')?.properties?.source, { type: 'external', url: 'https://example.com/a.png' })
})

test('★ ③ 글자 — 굵게 · 기울임 · 취소선 · 코드 · 링크 · 이스케이프', () => {
  const { doc } = markdownToDoc('**굵게** *기울임* ~~취소~~ `코드` [링크](https://x.y) \\*별\\*')
  const runs = doc.blocks[0]!.title
  const by = (text: string) => runs.find((r) => r.text?.content === text)
  assert.equal(by('굵게')?.annotations.bold, true)
  assert.equal(by('기울임')?.annotations.italic, true)
  assert.equal(by('취소')?.annotations.strikethrough, true)
  assert.equal(by('코드')?.annotations.code, true)
  assert.equal(by('링크')?.text?.link?.url, 'https://x.y')
  assert.ok(toPlainText(runs).endsWith('*별*'), '이스케이프한 별이 꾸밈이 되었다')
})

test('★ ④ 우리 내보내기의 꼴 — 토글 · 콜아웃(자식과 함께)', () => {
  const md = ['<details>', '<summary>접기 &amp; 펴기</summary>', '', '안쪽 문단', '', '- 안쪽 목록', '', '</details>', '',
    '<aside>', '', '알림', '', '자식', '', '</aside>', '', '<details>', '<summary>빈 토글</summary>', '</details>'].join('\n')
  const { doc, losses } = markdownToDoc(md)
  assert.deepEqual(shape(doc.blocks), [
    ['toggle', '접기 & 펴기', [['paragraph', '안쪽 문단'], ['bulleted_list_item', '안쪽 목록']]],
    ['callout', '알림', [['paragraph', '자식']]],
    ['toggle', '빈 토글'],
  ])
  assert.equal(losses.html, 0)
})

test('★ ⑤ 옮기지 못한 것은 센다 — 표는 문단으로 · HTML · 로컬 이미지 · 위험한 링크 · 주석은 세지 않는다', () => {
  const md = ['| a | b |', '|---|---|', '| 1 | 2 |', '', '<div>블록 HTML</div>', '', '![로컬](./img.png)', '',
    '[나쁜](javascript:alert(1))', '', '<!-- unsupported block type="x" -->'].join('\n')
  const { doc, losses } = markdownToDoc(md)
  assert.deepEqual(losses, { tables: 1, html: 1, images: 1, links: 1, formatting: 0 })
  assert.deepEqual(shape(doc.blocks), [['paragraph', 'a | b'], ['paragraph', '1 | 2'], ['paragraph', '나쁜']])
  assert.equal(doc.blocks[2]!.title[0]?.text?.link, null, '위험한 링크가 남았다')

  const many = Array.from({ length: 150 }, (_, i) => (i % 2 === 0 ? `**${i}**` : `${i}`)).join(' ')
  const crowded = markdownToDoc(many)
  assert.equal(crowded.losses.formatting, 1)
  assert.ok(crowded.doc.blocks[0]!.title.length <= MAX_RICH_TEXT_RUNS)
})

test('⑥ 평문 — 빈 줄로 나뉜 덩이가 문단 · 덩이 안의 줄바꿈은 그대로', () => {
  const { title, doc } = textToDoc('첫 줄\n둘째 줄\n\n\n다음 문단\r\n')
  assert.equal(title, null)
  assert.deepEqual(shape(doc.blocks), [['paragraph', '첫 줄\n둘째 줄'], ['paragraph', '다음 문단']])
  assert.deepEqual(textToDoc('   \n\n').doc.blocks, [])
})

test('★ ⑦ 만든 문서는 서버의 문서 검증을 지난다', () => {
  const md = ['# 제목', '', '## 소제목', '', '- [x] **굵은** 할 일', '  1. 번호', '', '> 인용', '> 둘째 줄', '', '<details>', '<summary>t</summary>', '', 'x', '', '</details>',
    '', '```', 'code', '```', '', '긴 글 '.repeat(1000)].join('\n')
  const { doc } = markdownToDoc(md)
  assert.deepEqual(validateDoc(doc), [])
  assert.deepEqual(validateDoc(textToDoc('가'.repeat(5000)).doc), [])
})

test('⑧ 울타리의 언어 — id · 별칭 · 공백 든 이름 · 모르는 것과 평문은 null', () => {
  assert.equal(codeLanguageFromFence('typescript'), 'typescript')
  assert.equal(codeLanguageFromFence('PY'), 'python')
  assert.equal(codeLanguageFromFence('ascii art'), 'ascii art')
  assert.equal(codeLanguageFromFence('js title="a.js"'), 'javascript')
  assert.equal(codeLanguageFromFence('klingon'), null)
  assert.equal(codeLanguageFromFence('plain text'), null)
  assert.equal(codeLanguageFromFence(''), null)
})
