/**
 * 새 버전 알림 — 배포의 표지 (플랫폼 잔여 10h-1 · F-12-17 · 정본 §3.10 끝 [보강] 새 버전 알림)
 *
 *   ① 표지의 모양 — 영숫자 · . _ - 64자 · 앞뒤 공백을 걷는다 · 아니면 모른다
 *   ② 어디서 오는가 — 배포가 준 값 · 없거나 틀리면 빌드의 표지 · 그것도 없으면 모른다
 *   ③ ★ 다른가 — 둘 다 알고 다를 때만(모르면 다르다고 하지 않는다)
 *   ④ 띠 — 새 버전이고 그 표지를 덮지 않았을 때(더 새 표지는 다시 선다)
 *   ⑤ 이 앱의 정적 자산인가(10h-2) — 같은 출처 · /_next/static/
 *   ⑥ 청크를 못 받으면 곧바로 묻는가(10h-2) — 이 앱의 자산 · 30초에 한 번
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ASSET_ERROR_CHECK_GAP_MS,
  isAppAssetUrl,
  isNewRelease,
  normalizeRelease,
  resolveRelease,
  shouldCheckOnAssetError,
  shouldShowBanner,
} from './release.ts'

test('① 표지의 모양 — 영숫자 · . _ - 64자 · 앞뒤 공백을 걷는다', () => {
  assert.equal(normalizeRelease('o0SmUFvfl-dG3RRzf5Tlu'), 'o0SmUFvfl-dG3RRzf5Tlu', 'Next 의 BUILD_ID')
  assert.equal(normalizeRelease('v1.2.3_rc-1'), 'v1.2.3_rc-1')
  assert.equal(normalizeRelease('  abc123\n'), 'abc123', '파일의 줄바꿈')
  assert.equal(normalizeRelease('a'.repeat(64)), 'a'.repeat(64))
  for (const raw of ['', '   ', 'a'.repeat(65), 'has space', '<script>', '버전', 'a/b', null, undefined, 42, {}]) {
    assert.equal(normalizeRelease(raw), null, JSON.stringify(raw))
  }
})

test('② 어디서 오는가 — 배포가 준 값 · 없거나 틀리면 빌드의 표지 · 그것도 없으면 모른다', () => {
  let reads = 0
  const build = () => {
    reads += 1
    return 'build-id\n'
  }
  assert.equal(resolveRelease('deploy-42', build), 'deploy-42')
  assert.equal(reads, 0, '배포가 준 값이 있으면 빌드의 표지를 읽지 않는다')
  assert.equal(resolveRelease(undefined, build), 'build-id')
  assert.equal(resolveRelease('bad value', build), 'build-id', '모양이 틀린 값은 없는 것과 같다')
  assert.equal(resolveRelease(undefined, () => null), null, '개발 — 빌드가 없다')
})

test('③ ★ 다른가 — 둘 다 알고 다를 때만', () => {
  assert.equal(isNewRelease('a', 'b'), true)
  assert.equal(isNewRelease('a', 'a'), false)
  assert.equal(isNewRelease(null, 'b'), false, '문서의 표지를 모른다(개발)')
  assert.equal(isNewRelease('a', null), false, '서버의 답을 모른다')
  assert.equal(isNewRelease(null, null), false)
})

test('④ 띠 — 새 버전이고 그 표지를 덮지 않았을 때', () => {
  assert.equal(shouldShowBanner('a', 'b', null), true)
  assert.equal(shouldShowBanner('a', 'b', 'b'), false, '"나중에" 로 덮은 표지')
  assert.equal(shouldShowBanner('a', 'c', 'b'), true, '더 새 표지가 오면 다시 선다')
  assert.equal(shouldShowBanner('a', 'a', null), false)
  assert.equal(shouldShowBanner('a', null, null), false)
})

const ORIGIN = 'https://notion.example'

test('⑤ 이 앱의 정적 자산인가 — 같은 출처 · /_next/static/', () => {
  assert.equal(isAppAssetUrl(`${ORIGIN}/_next/static/chunks/0abc.js`, ORIGIN), true)
  assert.equal(isAppAssetUrl(`${ORIGIN}/_next/static/chunks/0abc.css?dpl=x`, ORIGIN), true)
  assert.equal(isAppAssetUrl('/_next/static/chunks/0abc.js', ORIGIN), true, '상대 주소')
  assert.equal(isAppAssetUrl('https://cdn.other.example/_next/static/chunks/0abc.js', ORIGIN), false, '다른 출처')
  assert.equal(isAppAssetUrl(`${ORIGIN}/api/workspaces/x/files/y`, ORIGIN), false, '올린 파일')
  assert.equal(isAppAssetUrl(`${ORIGIN}/e2e.js`, ORIGIN), false)
  assert.equal(isAppAssetUrl('', ORIGIN), false, '빈 주소는 이 문서 자신이다')
  assert.equal(isAppAssetUrl('http://[bad', ORIGIN), false, '읽을 수 없는 주소')
})

test('⑥ 청크를 못 받으면 곧바로 묻는가 — 이 앱의 자산 · 30초에 한 번', () => {
  const chunk = `${ORIGIN}/_next/static/chunks/0abc.js`
  assert.equal(shouldCheckOnAssetError(chunk, ORIGIN, null, 1000), true, '처음')
  assert.equal(shouldCheckOnAssetError(chunk, ORIGIN, 1000, 1000 + ASSET_ERROR_CHECK_GAP_MS - 1), false, '간격 안')
  assert.equal(shouldCheckOnAssetError(chunk, ORIGIN, 1000, 1000 + ASSET_ERROR_CHECK_GAP_MS), true, '간격이 지났다')
  assert.equal(shouldCheckOnAssetError(`${ORIGIN}/e2e.js`, ORIGIN, null, 1000), false, '이 앱의 자산이 아니다')
})
