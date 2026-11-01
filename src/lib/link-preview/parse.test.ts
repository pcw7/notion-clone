// 북마크 메타의 HTML 파서(F-4a · 정본 §3.4 [보강 F-4] ③) — 순수 모듈.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { MAX_PREVIEW_TITLE, decodeEntities, parsePreview } from './parse.ts'

const BASE = 'https://example.com/docs/page'

describe('parsePreview', () => {
  test('★ OpenGraph 를 먼저 — 제목 · 설명 · 그림(최종 주소 기준으로 푼다) · 사이트 이름', () => {
    const html = `<!doctype html><html><head>
      <title>문서 제목 | 예시</title>
      <meta property="og:title" content="OG 제목">
      <meta property='og:description' content='설명 &amp; 요약'>
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="예시 사이트">
      <meta name="description" content="일반 설명">
    </head><body><meta property="og:title" content="본문의 것은 안 본다"></body></html>`
    assert.deepEqual(parsePreview(html, BASE), {
      title: 'OG 제목',
      description: '설명 & 요약',
      imageUrl: 'https://example.com/img/cover.png',
      siteName: '예시 사이트',
    })
  })

  test('OpenGraph 가 없으면 twitter → <title> · description', () => {
    assert.deepEqual(parsePreview('<head><meta name="twitter:title" content="트윗 제목"><meta name=description content=짧은설명></head>', BASE), {
      title: '트윗 제목',
      description: '짧은설명',
      imageUrl: null,
      siteName: null,
    })
    assert.equal(parsePreview('<html><head><title>\n  여러   줄\n 제목 </title></head></html>', BASE).title, '여러 줄 제목')
  })

  test('★ 그림 주소는 http(s) 만 — javascript: · data: 는 버린다', () => {
    assert.equal(parsePreview('<meta property="og:image" content="javascript:alert(1)">', BASE).imageUrl, null)
    assert.equal(parsePreview('<meta property="og:image" content="data:image/png;base64,AAAA">', BASE).imageUrl, null)
    assert.equal(parsePreview('<meta property="og:image" content="//cdn.example.com/a.jpg">', BASE).imageUrl, 'https://cdn.example.com/a.jpg')
  })

  test('길이를 자르고 빈 값은 null · 메타가 없으면 모두 null', () => {
    const long = 'ㄱ'.repeat(MAX_PREVIEW_TITLE + 50)
    const title = parsePreview(`<title>${long}</title>`, BASE).title
    assert.equal(title?.length, MAX_PREVIEW_TITLE)
    assert.ok(title?.endsWith('…'))
    assert.deepEqual(parsePreview('<meta property="og:title" content="   ">', BASE), { title: null, description: null, imageUrl: null, siteName: null })
    assert.deepEqual(parsePreview('그냥 글', BASE), { title: null, description: null, imageUrl: null, siteName: null })
  })

  test('엔티티 — 이름 · 십진 · 십육진 · 모르는 이름은 그대로', () => {
    assert.equal(decodeEntities('a &lt;b&gt; &#44032; &#xAC00; &unknown; &#39;'), "a <b> 가 가 &unknown; '")
  })
})
