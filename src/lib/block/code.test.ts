/**
 * 코드 블록의 값 — 잔여 묶음 8a-1 (F-01-14 · DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pageMentionRun, textRun } from '../contracts/rich-text.ts'
import {
  CODE_LANGUAGES,
  codeCaptionText,
  codeLanguageLabel,
  codeLanguageOf,
  codeLanguageOptions,
  fenceInfo,
  fencedCode,
  isCaptionFormatted,
  markdownFence,
  validateCodeProperties,
  withCodeCaption,
  withCodeLanguage,
} from './code.ts'

test('★ 언어 — 고르지 않았거나 plain text 면 null · 목록 밖의 값도 그대로 보존한다', () => {
  assert.equal(codeLanguageOf(undefined), null)
  assert.equal(codeLanguageOf({}), null)
  assert.equal(codeLanguageOf({ language: '' }), null)
  assert.equal(codeLanguageOf({ language: 'Plain Text' }), null)
  assert.equal(codeLanguageOf({ language: 42 }), null)
  assert.equal(codeLanguageOf({ language: 'typescript' }), 'typescript')
  assert.equal(codeLanguageOf({ language: 'my weird lang' }), 'my weird lang', '목록 밖의 값을 버렸다')
})

test('★ 울타리는 코드 안의 가장 긴 백틱 줄보다 길다 — 셋 이상', () => {
  assert.equal(markdownFence('print(1)'), '```')
  assert.equal(markdownFence('a `b` c'), '```')
  assert.equal(markdownFence('```\nx\n```'), '````', '코드 안의 ``` 에서 울타리가 닫힌다')
  assert.equal(markdownFence('`````'), '``````')
})

test('정보 문자열은 울타리를 깨지 않는다 — 백틱을 빼고 공백은 잇는다', () => {
  assert.equal(fenceInfo(null), '')
  assert.equal(fenceInfo('python'), 'python')
  assert.equal(fenceInfo('my weird lang'), 'my-weird-lang')
  assert.equal(fenceInfo('a`b'), 'ab')
})

test('울타리로 감싼 줄들 — 줄마다 들여 쓴다', () => {
  assert.deepEqual(fencedCode('a\nb', 'ts'), ['```ts', 'a', 'b', '```'])
  assert.deepEqual(fencedCode('x', null, '  '), ['  ```', '  x', '  ```'])
})

test('properties 검사 — 언어는 64자까지의 문자열 · 캡션은 계약을 지난 런의 배열', () => {
  assert.deepEqual(validateCodeProperties({ language: 'rust', caption: [] }, 'p'), [])
  assert.deepEqual(validateCodeProperties(undefined, 'p'), [])
  assert.deepEqual(validateCodeProperties({ language: 1 }, 'p').map((i) => i.path), ['p.language'])
  // 8a-2 — 읽기의 정화가 고칠 값(null · 빈 언어)은 받지 않는다. 받으면 저장한 뒤 읽을 때마다 고쳐 쓴다.
  assert.deepEqual(validateCodeProperties({ language: null }, 'p').map((i) => i.path), ['p.language'])
  assert.deepEqual(validateCodeProperties({ language: '  ' }, 'p').map((i) => i.path), ['p.language'])
  assert.deepEqual(validateCodeProperties({ language: 'x'.repeat(65) }, 'p').map((i) => i.path), ['p.language'])
  assert.deepEqual(validateCodeProperties({ caption: 'c' }, 'p').map((i) => i.path), ['p.caption'])
  // 8a-2 — 배열인지만 보던 때에는 `[null]` 이 저장돼 투영을 멈췄다(정본 ⑧).
  assert.deepEqual(validateCodeProperties({ caption: [null] }, 'p').map((i) => i.path), ['p.caption[0]'])
  assert.deepEqual(validateCodeProperties({ caption: [textRun('설명')] }, 'p'), [])
})

// ── 8a-2 — 언어 목록 · 캡션 ───────────────────────────────────────────

test('★ 언어 목록은 노션 API 의 90개 — 저장값 그대로(소문자 · 공백 · 기호) · 겹치지 않는다 · plain text 가 있다', () => {
  assert.equal(CODE_LANGUAGES.length, 90)
  const ids = CODE_LANGUAGES.map((l) => l.id)
  assert.equal(new Set(ids).size, 90, '저장값이 겹친다')
  for (const id of ids) assert.equal(id, id.toLowerCase(), id)
  for (const id of ['plain text', 'c++', 'c#', 'java/c/c++/c#', 'vb.net', 'llvm ir', 'notion formula', 'toml', 'abc']) {
    assert.ok(ids.includes(id), `${id} 가 없다`)
  }
  // 옛 Block object 표(72개)에는 없던 값 — 이것으로 거르면 노션이 받는 값을 버린다.
  assert.ok(ids.includes('solidity') && ids.includes('agda'))
})

test('★ 라벨 — 없으면 Plain Text · 목록이면 이름(대소문자 무시) · 목록 밖이면 저장된 원문', () => {
  assert.equal(codeLanguageLabel(null), 'Plain Text')
  assert.equal(codeLanguageLabel('python'), 'Python')
  assert.equal(codeLanguageLabel('Python'), 'Python')
  assert.equal(codeLanguageLabel('c++'), 'C++')
  assert.equal(codeLanguageLabel('my weird lang'), 'my weird lang', '목록 밖의 값을 숨겼다')
})

test('★ 검색 — 같은 이름 · 앞머리 · 포함 순 · 별칭(js · py · cpp)도 찾는다 · 지금 언어에 표시', () => {
  const labels = (q: string, current: string | null = null) => codeLanguageOptions(q, current).map((o) => o.label)
  assert.equal(labels('').length, 90)
  assert.equal(labels('py')[0], 'Python', '별칭이 같은 것(py)이 맨 위가 아니다')
  assert.equal(labels('js')[0], 'JavaScript')
  assert.equal(labels('cpp')[0], 'C++')
  assert.equal(labels('type')[0], 'TypeScript')
  assert.ok(labels('script').includes('JavaScript') && labels('script').includes('TypeScript'), '포함 검색이 안 된다')
  assert.deepEqual(labels('없는언어'), [])
  const options = codeLanguageOptions('', 'python')
  assert.deepEqual(options.filter((o) => o.current).map((o) => o.id), ['python'])
  assert.equal(codeLanguageOptions('', null).find((o) => o.current)?.id, null, 'plain text 가 지금 언어로 표시되지 않는다')
  assert.equal(codeLanguageOptions('plain', null)[0]?.id, null, 'plain text 를 고르면 null 이어야 한다(키를 지운다)')
})

test('목록 밖의 저장값은 맨 위에 원문으로 한 줄 — 보존된 값이 목록에서 사라지지 않는다', () => {
  const options = codeLanguageOptions('', 'my weird lang')
  assert.deepEqual(options[0], { id: 'my weird lang', label: 'my weird lang', current: true })
  assert.equal(options.length, 91)
})

test('★ 언어 바꾸기 — null · 빈 값 · plain text 는 키를 지운다 · 64자를 넘으면 그대로 · 다른 키는 남는다', () => {
  assert.deepEqual(withCodeLanguage({ caption: [] }, 'python'), { caption: [], language: 'python' })
  assert.deepEqual(withCodeLanguage({ language: 'python' }, null), {})
  assert.deepEqual(withCodeLanguage({ language: 'python' }, 'Plain Text'), {})
  assert.deepEqual(withCodeLanguage({ language: 'python' }, '  '), {})
  assert.deepEqual(withCodeLanguage({ language: 'python' }, 'x'.repeat(65)), { language: 'python' })
})

test('★ 캡션 — 평문 한 런 · 비우면 키 삭제 · 글자가 같으면 받은 서식 그대로 · 서식이 있으면 알린다', () => {
  assert.deepEqual(withCodeCaption({}, '  예제  ').caption, [textRun('예제')])
  assert.deepEqual(withCodeCaption({ caption: [textRun('x')] }, ''), {})
  const formatted = { caption: [textRun('굵게', { bold: true })] }
  assert.equal(isCaptionFormatted(formatted), true)
  assert.deepEqual(withCodeCaption(formatted, '굵게'), formatted, '글자가 같은데 서식을 버렸다')
  assert.deepEqual(withCodeCaption(formatted, '다른 글').caption, [textRun('다른 글')])
  assert.equal(isCaptionFormatted({ caption: [textRun('평문')] }), false)
  assert.equal(isCaptionFormatted({ caption: [pageMentionRun('00000000-0000-4000-8000-000000000001')] }), true)
})

test('★ 캡션 — 자르지 않는다(2000자 단위 런으로 쪼갠다) · 앞뒤 공백만 다르면 쓰지 않는다 · 줄바꿈은 글자다', () => {
  const long = '가'.repeat(4500)
  const runs = withCodeCaption({}, long).caption as ReturnType<typeof textRun>[]
  assert.deepEqual(runs.map((r) => r.plain_text.length), [2000, 2000, 500])
  assert.equal(runs.map((r) => r.plain_text).join(''), long, '받은 캡션을 고치면 뒤가 잘렸다')
  // 받은 캡션의 앞뒤 공백(가져오기 · API) — 글자가 같으면 받은 모양 그대로.
  const padded = { caption: [textRun(' 그림 1 ')] }
  assert.deepEqual(withCodeCaption(padded, '그림 1'), padded)
  const multiline = { caption: [textRun('첫 줄\n둘째 줄', { italic: true })] }
  assert.deepEqual(withCodeCaption(multiline, '첫 줄\n둘째 줄'), multiline, '줄바꿈이 든 캡션을 같은 글자로 다시 썼다')
})

test('★ 캡션 읽기는 모양이 틀린 런에 던지지 않는다 — [null] · plain_text 가 문자열이 아닌 런', () => {
  assert.equal(codeCaptionText({ caption: [null] }), '')
  const hostile = { ...textRun('살아남음'), plain_text: { toString: 0 } }
  assert.equal(codeCaptionText({ caption: [hostile, null, 7] }), '살아남음')
  assert.equal(codeCaptionText({ caption: 'str' }), '')
})
