/**
 * User-Agent 가르기 · 가린 IP (AC-3 · F-14-08) — 정본 §3.2 [보강 AC-0] ⑭ [AC-3]
 *
 * 차례가 뜻이다 — Chromium 계열은 `Chrome/` 와 `Safari/` 를 함께 싣는다. 화면에 온전한 IP 를 주지 않는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { coarseIp, deviceLabel, parseUserAgent, placeLabel } from './user-agent.ts'

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  headless: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  samsungPhone: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  whale: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Whale/4.29.282.14 Safari/537.36',
  operaMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

test('브라우저 · OS · 꼴 — Chromium 계열은 제 이름으로(Chrome · Safari 를 함께 실어도)', () => {
  const cases: [string, string | null, string | null, string][] = [
    [UA.chromeWindows, 'Chrome', 'Windows', 'computer'],
    [UA.headless, 'Chrome', 'Windows', 'computer'],
    [UA.edgeWindows, 'Edge', 'Windows', 'computer'],
    [UA.safariMac, 'Safari', 'macOS', 'computer'],
    [UA.firefoxLinux, 'Firefox', 'Linux', 'computer'],
    [UA.safariIphone, 'Safari', 'iOS', 'phone'],
    [UA.chromeIphone, 'Chrome', 'iOS', 'phone'],
    [UA.ipad, 'Safari', 'iPadOS', 'tablet'],
    [UA.samsungPhone, '삼성 인터넷', 'Android', 'phone'],
    [UA.androidTablet, 'Chrome', 'Android', 'tablet'],
    [UA.whale, '웨일', 'Windows', 'computer'],
    [UA.operaMac, 'Opera', 'macOS', 'computer'],
    [UA.chromebook, 'Chrome', 'ChromeOS', 'computer'],
  ]
  for (const [ua, browser, os, form] of cases) assert.deepEqual(parseUserAgent(ua), { browser, os, form }, ua)
})

test('모르는 것 — 비었거나 사람 브라우저가 아니면 이름이 없다', () => {
  for (const ua of [null, undefined, '', '   ', 'node:test', 'curl/8.4.0']) {
    assert.deepEqual(parseUserAgent(ua), { browser: null, os: null, form: 'unknown' }, String(ua))
  }
})

test('이름 — 둘 다 알면 "브라우저 · OS", 하나면 그 하나, 없으면 "알 수 없는 기기"', () => {
  assert.equal(deviceLabel(parseUserAgent(UA.chromeWindows)), 'Chrome · Windows')
  assert.equal(deviceLabel({ browser: null, os: 'Linux', form: 'computer' }), 'Linux')
  assert.equal(deviceLabel({ browser: 'Firefox', os: null, form: 'unknown' }), 'Firefox')
  assert.equal(deviceLabel(parseUserAgent('node:test')), '알 수 없는 기기')
})

test('가린 IP — IPv4 는 앞 셋 · IPv6 는 앞 세 묶음 · 온전한 주소는 남지 않는다', () => {
  assert.equal(coarseIp('203.0.113.9'), '203.0.113.*')
  assert.equal(coarseIp('203.0.113.9/32'), '203.0.113.*')
  assert.equal(coarseIp('::ffff:198.51.100.7'), '198.51.100.*')
  assert.equal(coarseIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3:…')
  assert.equal(coarseIp('2001:db8::1'), '2001:db8:0:…')
  assert.equal(coarseIp('2001:0DB8:0000::abcd'), '2001:db8:0:…')
  for (const bad of [null, undefined, '', 'localhost', '999', '1.2.3', 'gg::1', '1:2:3:4:5:6:7:8:9']) assert.equal(coarseIp(bad), null, String(bad))
  for (const ip of ['203.0.113.9', '2001:db8:85a3:8d3:1319:8a2e:370:7348']) {
    assert.ok(!String(coarseIp(ip)).includes(ip.split(/[.:]/).at(-1) ?? '#'), `끝 조각이 남지 않는다 — ${ip}`)
  }
})

test('대략 위치 — 이름이 있으면 그것 · 없으면 가린 IP 의 네트워크 · 둘 다 없으면 null', () => {
  assert.equal(placeLabel('서울', '203.0.113.9'), '서울')
  assert.equal(placeLabel('  ', '203.0.113.9'), '203.0.113.* 네트워크')
  assert.equal(placeLabel(null, '203.0.113.9'), '203.0.113.* 네트워크')
  assert.equal(placeLabel(null, null), null)
  assert.equal(placeLabel(undefined, 'not-an-ip'), null)
})
