// 임베드 주소 규칙 · 블록 계약 (EM-1 · 정본 §3.4 [보강 EM-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { textRun } from '../contracts/rich-text.ts'
import { clampEmbedHeight, readEmbedHeight, validateEmbedProperties, readEmbedUrl, withEmbedHeight, withEmbedUrl, withoutEmbedHeight } from './embed-block.ts'
import { embedPlanOf, embedSourceOf, embedStageHeight, embedStartSeconds, isHeightResizable, ownHostsOf, type EmbedSource } from './embed-source.ts'

function src(url: string): string {
  const out = embedSourceOf(url)
  assert.notEqual(out.kind, 'refused', url)
  return (out as Exclude<EmbedSource, { kind: 'refused' }>).src
}

function provider(url: string): string {
  const out = embedSourceOf(url)
  return out.kind === 'refused' ? 'refused' : out.provider
}

const ID = 'dQw4w9WgXcQ'

describe('임베드 — 시작 시각', () => {
  test('초 · 분초 · 시분초, 0 이나 틀린 글은 null', () => {
    assert.equal(embedStartSeconds('90'), 90)
    assert.equal(embedStartSeconds('90s'), 90)
    assert.equal(embedStartSeconds('1m30s'), 90)
    assert.equal(embedStartSeconds('1h2m3s'), 3723)
    assert.equal(embedStartSeconds('2m'), 120)
    assert.equal(embedStartSeconds('0'), null)
    assert.equal(embedStartSeconds('abc'), null)
    assert.equal(embedStartSeconds(''), null)
    assert.equal(embedStartSeconds(null), null)
  })
})

describe('임베드 — YouTube', () => {
  test('★ watch · t → nocookie embed + start', () => {
    assert.equal(src(`https://www.youtube.com/watch?v=${ID}&t=90s`), `https://www.youtube-nocookie.com/embed/${ID}?start=90`)
    assert.equal(src(`https://youtube.com/watch?v=${ID}&t=1m30s`), `https://www.youtube-nocookie.com/embed/${ID}?start=90`)
    assert.equal(src(`https://m.youtube.com/watch?v=${ID}&start=15`), `https://www.youtube-nocookie.com/embed/${ID}?start=15`)
    assert.equal(src(`https://www.youtube.com/watch?v=${ID}`), `https://www.youtube-nocookie.com/embed/${ID}`)
  })

  test('youtu.be · shorts · embed · live', () => {
    assert.equal(src(`https://youtu.be/${ID}?t=30`), `https://www.youtube-nocookie.com/embed/${ID}?start=30`)
    assert.equal(src(`https://www.youtube.com/shorts/${ID}`), `https://www.youtube-nocookie.com/embed/${ID}`)
    assert.equal(src(`https://www.youtube.com/embed/${ID}`), `https://www.youtube-nocookie.com/embed/${ID}`)
    assert.equal(src(`https://www.youtube.com/live/${ID}`), `https://www.youtube-nocookie.com/embed/${ID}`)
  })

  test('재생목록 — 목록만 · 영상과 함께', () => {
    assert.equal(src('https://www.youtube.com/playlist?list=PLabcdefghij123'), 'https://www.youtube-nocookie.com/embed/videoseries?list=PLabcdefghij123')
    assert.equal(src(`https://www.youtube.com/watch?v=${ID}&list=PLabcdefghij123`), `https://www.youtube-nocookie.com/embed/${ID}?list=PLabcdefghij123`)
  })

  test('동영상은 16:9', () => {
    const out = embedSourceOf(`https://youtu.be/${ID}`)
    assert.equal(out.kind, 'known')
    assert.equal(out.kind === 'known' ? out.aspect : 0, 16 / 9)
  })

  test('영상 아이디가 없는 주소(채널)는 일반', () => {
    assert.equal(provider('https://www.youtube.com/@someone'), 'generic')
    assert.equal(provider('https://www.youtube.com/watch?v=short'), 'generic')
  })
})

describe('임베드 — 서비스별 규칙', () => {
  test('Vimeo — 공개 · 플레이어 · 비공개 해시', () => {
    assert.equal(src('https://vimeo.com/123456789'), 'https://player.vimeo.com/video/123456789')
    assert.equal(src('https://player.vimeo.com/video/123456789'), 'https://player.vimeo.com/video/123456789')
    assert.equal(src('https://vimeo.com/123456789/abcdef1234'), 'https://player.vimeo.com/video/123456789?h=abcdef1234')
    assert.equal(src('https://vimeo.com/channels/staffpicks/123456789'), 'https://player.vimeo.com/video/123456789')
  })

  test('Loom', () => {
    const id = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
    assert.equal(src(`https://www.loom.com/share/${id}`), `https://www.loom.com/embed/${id}`)
    assert.equal(src(`https://loom.com/share/${id}?sid=x`), `https://www.loom.com/embed/${id}`)
  })

  test('Figma — 원래 주소를 그대로 인코딩해 싣는다', () => {
    const original = 'https://www.figma.com/design/AbC123/Name?node-id=1-2'
    assert.equal(src(original), `https://www.figma.com/embed?embed_host=notion-clone&url=${encodeURIComponent(original)}`)
    assert.equal(provider('https://www.figma.com/proto/AbC123/Name'), 'figma')
    assert.equal(provider('https://www.figma.com/board/AbC123/Name'), 'figma')
    assert.equal(provider('https://www.figma.com/pricing'), 'generic')
  })

  test('Google 지도 — embed 는 그대로 · 찾기 · 장소는 output=embed', () => {
    assert.equal(src('https://www.google.com/maps/embed?pb=!1m18'), 'https://www.google.com/maps/embed?pb=!1m18')
    assert.equal(src('https://www.google.com/maps?q=Seoul+Station'), 'https://maps.google.com/maps?q=Seoul+Station&output=embed')
    assert.equal(src('https://www.google.com/maps/search/Seoul+Station'), 'https://maps.google.com/maps?q=Seoul+Station&output=embed')
    assert.equal(src('https://www.google.com/maps/place/Seoul%20Station/@37.5,127.0,17z'), 'https://maps.google.com/maps?q=Seoul+Station&output=embed')
    assert.equal(src('https://maps.google.com/?q=Busan'), 'https://maps.google.com/maps?q=Busan&output=embed')
    assert.equal(provider('https://www.google.com/search?q=maps'), 'generic')
  })

  test('Google 문서 · 시트 · 슬라이드 · 드라이브', () => {
    const id = 'abcdefghijklmnopqrstuvwxyz0123'
    assert.equal(src(`https://docs.google.com/document/d/${id}/edit`), `https://docs.google.com/document/d/${id}/preview`)
    assert.equal(src(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), `https://docs.google.com/spreadsheets/d/${id}/preview`)
    assert.equal(src(`https://docs.google.com/presentation/d/${id}/edit`), `https://docs.google.com/presentation/d/${id}/embed`)
    assert.equal(src(`https://drive.google.com/file/d/${id}/view?usp=sharing`), `https://drive.google.com/file/d/${id}/preview`)
    assert.equal(src(`https://drive.google.com/open?id=${id}`), `https://drive.google.com/file/d/${id}/preview`)
    assert.equal(provider(`https://docs.google.com/document/d/${id}/edit`), 'google-docs')
    assert.equal(provider(`https://docs.google.com/spreadsheets/d/${id}`), 'google-sheets')
    assert.equal(provider(`https://docs.google.com/presentation/d/${id}`), 'google-slides')
  })

  test('CodePen · CodeSandbox', () => {
    assert.equal(src('https://codepen.io/someone/pen/AbCdEf'), 'https://codepen.io/someone/embed/AbCdEf?default-tab=result')
    assert.equal(src('https://codesandbox.io/s/my-sandbox-abc12'), 'https://codesandbox.io/embed/my-sandbox-abc12')
    assert.equal(src('https://codesandbox.io/p/sandbox/my-sandbox-abc12'), 'https://codesandbox.io/embed/my-sandbox-abc12')
  })

  test('Spotify — intl 접두를 건너뛰고 종류마다 높이', () => {
    assert.equal(src('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x'), 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC')
    assert.equal(src('https://open.spotify.com/intl-ko/album/4uLU6hMCjMI75M1A2tKUQC'), 'https://open.spotify.com/embed/album/4uLU6hMCjMI75M1A2tKUQC')
    const track = embedSourceOf('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')
    const album = embedSourceOf('https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC')
    assert.equal(track.kind === 'known' ? track.height : 0, 152)
    assert.equal(album.kind === 'known' ? album.height : 0, 352)
  })

  test('SoundCloud · Miro · X', () => {
    const track = 'https://soundcloud.com/artist/track-name'
    assert.equal(src(track), `https://w.soundcloud.com/player/?url=${encodeURIComponent(track)}`)
    assert.equal(src('https://miro.com/app/board/uXjVK123abc=/'), 'https://miro.com/app/live-embed/uXjVK123abc=/')
    assert.equal(src('https://x.com/someone/status/1234567890123456789'), 'https://platform.twitter.com/embed/Tweet.html?id=1234567890123456789')
    assert.equal(src('https://twitter.com/someone/status/1234567890?s=20'), 'https://platform.twitter.com/embed/Tweet.html?id=1234567890')
    assert.equal(provider('https://x.com/someone'), 'generic')
  })
})

describe('임베드 — http · 일반 · 거절', () => {
  test('★ http 인 알려진 서비스는 https 로 올린다', () => {
    assert.equal(src(`http://www.youtube.com/watch?v=${ID}`), `https://www.youtube-nocookie.com/embed/${ID}`)
    assert.equal(src('http://vimeo.com/123456789'), 'https://player.vimeo.com/video/123456789')
  })

  test('★ 일반 https 는 그 주소 그대로 · http 일반은 거절', () => {
    const generic = embedSourceOf('https://www.example.com/a?b=1')
    assert.equal(generic.kind, 'generic')
    assert.equal(generic.kind === 'generic' ? generic.src : '', 'https://www.example.com/a?b=1')
    assert.equal(generic.kind === 'generic' ? generic.label : '', 'example.com')
    assert.equal(embedSourceOf('http://example.com/a').kind, 'refused')
  })

  test('http · https 가 아니면 거절', () => {
    assert.equal(embedSourceOf('javascript:alert(1)').kind, 'refused')
    assert.equal(embedSourceOf('ftp://a.test/x').kind, 'refused')
    assert.equal(embedSourceOf('not a url').kind, 'refused')
  })

  test('★ 호스트는 정확히 맞춘다 — 닮은 호스트 · 사용자 정보 · 쿼리 속 이름은 서비스가 아니다', () => {
    assert.equal(provider(`https://youtube.com.evil.com/watch?v=${ID}`), 'generic')
    assert.equal(provider(`https://evilyoutube.com/watch?v=${ID}`), 'generic')
    assert.equal(provider(`https://youtube.com@evil.com/watch?v=${ID}`), 'generic')
    assert.equal(provider(`https://evil.com/watch?v=${ID}&u=youtube.com`), 'generic')
    assert.equal(provider('https://vimeo.com.evil.com/123456789'), 'generic')
    assert.equal(provider('https://notfigma.com/design/x/y'), 'generic')
    assert.equal(provider('https://open.spotify.com.evil.com/track/4uLU6hMCjMI75M1A2tKUQC'), 'generic')
    assert.equal(provider('https://evil.com/x.soundcloud.com/a/b'), 'generic')
  })

  test('★ 자기 출처의 주소는 그리지 않는다 — 스킴과 상관없이 호스트(포트 포함)로', () => {
    const own = ownHostsOf(['http://localhost:3000', 'https://app.example.com', null, '', 'not an origin %%'])
    assert.deepEqual(own, ['localhost:3000', 'app.example.com'])
    assert.equal(embedPlanOf('http://localhost:3000/w/x', own).kind, 'refused')
    assert.equal(embedPlanOf('https://localhost:3000/w/x', own).kind, 'refused')
    assert.equal(embedPlanOf('https://APP.example.com/p/t', own).kind, 'refused')
    assert.equal(embedPlanOf('https://localhost:3001/x', own).kind, 'generic')
    assert.equal(embedPlanOf(`https://youtu.be/${ID}`, own).kind, 'known')
  })
})

describe('임베드 — 블록 계약', () => {
  test('읽기 · 쓰기 — 틀린 주소는 null · null 을 쓰면 지우고 캡션은 남는다', () => {
    assert.equal(readEmbedUrl({ url: 'https://a.test' }), 'https://a.test')
    assert.equal(readEmbedUrl({ url: 'javascript:x' }), null)
    assert.equal(readEmbedUrl(null), null)
    const written = withEmbedUrl({ caption: [textRun('c')], other: 1 }, 'https://a.test')
    assert.equal(written.url, 'https://a.test')
    const cleared = withEmbedUrl(written, null)
    assert.equal('url' in cleared, false)
    assert.equal(cleared.other, 1)
    assert.ok(cleared.caption)
  })

  test('Y.Doc 계약 — 틀린 주소를 거부한다', () => {
    assert.deepEqual(validateEmbedProperties({ url: 'https://a.test', caption: [textRun('c')] }, 'p'), [])
    assert.deepEqual(validateEmbedProperties({}, 'p'), [])
    assert.equal(validateEmbedProperties({ url: 'javascript:alert(1)' }, 'p')[0]?.path, 'p.url')
    assert.equal(validateEmbedProperties({ url: 'ftp://a.test' }, 'p').length, 1)
  })

  test('높이 — 120..1600 정수만 받는다(EM-3)', () => {
    for (const ok of [120, 450, 1600]) assert.deepEqual(validateEmbedProperties({ height: ok }, 'p'), [], String(ok))
    for (const bad of [119, 1601, 450.5, '450', null, Number.NaN, -1]) {
      assert.equal(validateEmbedProperties({ height: bad }, 'p')[0]?.path, 'p.height', String(bad))
    }
    assert.deepEqual(validateEmbedProperties({}, 'p'), [], '없으면 서비스 기본')
  })

  test('높이 — 읽기 · 쓰기 · 맞추기 · 버리기', () => {
    assert.equal(readEmbedHeight({ height: 300 }), 300)
    assert.equal(readEmbedHeight({ height: 99999 }), null)
    assert.equal(readEmbedHeight({}), null)
    assert.equal(clampEmbedHeight(5), 120)
    assert.equal(clampEmbedHeight(5000), 1600)
    assert.equal(clampEmbedHeight(300.6), 301)
    const set = withEmbedHeight({ url: 'https://a.test', other: 1 }, 700)
    assert.deepEqual(set, { url: 'https://a.test', other: 1, height: 700 })
    assert.deepEqual(withoutEmbedHeight(set), { url: 'https://a.test', other: 1 })
  })

  test('높이 — 정한 높이 모양만 쓴다(동영상은 무시)', () => {
    const own = ownHostsOf(['http://localhost:3000'])
    const video = embedPlanOf('https://youtu.be/dQw4w9WgXcQ', own)
    const maps = embedPlanOf('https://www.google.com/maps/embed?pb=x', own)
    const generic = embedPlanOf('https://example.com/a', own)
    const refused = embedPlanOf('http://localhost:3000/x', own)
    assert.equal(isHeightResizable(video), false)
    assert.equal(embedStageHeight(video, 700), null)
    assert.equal(isHeightResizable(maps), true)
    assert.equal(embedStageHeight(maps, null), 450)
    assert.equal(embedStageHeight(maps, 700), 700)
    assert.equal(embedStageHeight(generic, null), 450)
    assert.equal(embedStageHeight(generic, 300), 300)
    assert.equal(isHeightResizable(refused), false)
    assert.equal(embedStageHeight(refused, 300), null)
  })
})
