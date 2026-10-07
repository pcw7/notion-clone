/**
 * 링크를 그릴 때의 소독 — 누를 수 없는 주소에는 `href` 가 없다 (보안 · F-01-03 · DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 판정(`isSafeLinkUrl`) — http · https · mailto · tel · 스킴 없는 주소는 받고, `javascript:` · `data:` · `vbscript:` 는 거부 —
 *        대소문자 · 앞 공백 · 탭 · 줄바꿈 · 널 문자를 끼워도
 *   ② ★ 편집기의 링크 마크 — 받는 주소는 `href`, 거부한 주소 · 문자열이 아닌 값은 `href` 없이(글자 · 마크는 남는다)
 *   ③ 문서에서 그 마크가 남는다 — 저장 모양은 바꾸지 않는다(주소를 고치면 다시 링크다)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { Mark } from '@tiptap/pm/model'

import { isSafeLinkUrl } from '../contracts/link-url.ts'
import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { blockSchema } from './schema.ts'

const rendered = (href: unknown) => {
  const mark = { attrs: { href } } as unknown as Mark
  const spec = blockSchema.marks.link.spec.toDOM!(mark, true) as unknown as [string, Record<string, string>, number]
  return spec[1]
}

describe('① 판정', () => {
  test('★ 받는 주소 — http · https · mailto · tel · 스킴 없는 주소', () => {
    for (const url of ['https://x.y', 'HTTP://x.y', 'mailto:a@b.c', 'tel:010', '#anchor', '/w/a/b', '하위 페이지', '']) {
      assert.equal(isSafeLinkUrl(url), true, url)
    }
  })

  test('★ 거부 — javascript · data · vbscript, 대소문자 · 앞 공백 · 탭 · 줄바꿈 · 널을 끼워도', () => {
    for (const url of ['javascript:alert(1)', 'JAVASCRIPT:x', '  javascript:x', 'java\tscript:x', 'java\nscript:x', '\u0000javascript:x', 'data:text/html,x', 'vbscript:x']) {
      assert.equal(isSafeLinkUrl(url), false, JSON.stringify(url))
    }
  })
})

describe('② 편집기의 링크 마크', () => {
  test('★ 받는 주소는 href · 거부한 주소와 문자열이 아닌 값은 href 없이', () => {
    assert.deepEqual(rendered('https://example.com'), { href: 'https://example.com' })
    for (const bad of ['javascript:alert(1)', 'java\tscript:alert(1)', 42, null, { toString: () => 'javascript:x' }]) {
      const attrs = rendered(bad)
      assert.equal('href' in attrs, false, String(bad))
      assert.equal(attrs['data-unsafe-href'], 'true')
    }
  })
})

describe('③ 저장 모양', () => {
  test('거부한 주소의 링크도 문서에는 남는다 — 그리기만 막는다', () => {
    const run: RichTextRun = { ...textRun('눌러'), href: 'javascript:alert(1)', text: { content: '눌러', link: { url: 'javascript:alert(1)' } } }
    const blocks = [{ id: '00000000-0000-4000-8000-000000000001', type: 'paragraph' as const, title: [run], properties: {}, format: {}, children: [] }]
    const back = pmToDoc(docToPm({ blocks })).blocks[0]!.title[0]!
    assert.equal(back.text?.link?.url, 'javascript:alert(1)')
  })
})
