/**
 * AI 공급자 설정 — 환경 변수 읽기 (AI-1 · DB 없음)
 *
 * 이 시험은 `.env` 를 읽지 않는다 — 환경을 객체로 넘긴다(진짜 키가 `.env` 에 있어도 닿지 않는다).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AI_DEFAULTS, aiProviderHost, maxOutputChars, readAiConfig } from './config.ts'

const base = { AI_BASE_URL: 'https://api.groq.com/openai/v1/', AI_API_KEY: 'k', AI_MODEL: 'm' }

test('★ ① 주소 · 키 · 모델 중 하나라도 없으면 null(ai_unavailable) — 빈 값 · 공백도', () => {
  assert.equal(readAiConfig({}), null)
  assert.equal(readAiConfig({ ...base, AI_API_KEY: '' }), null, '키가 빈 .env')
  assert.equal(readAiConfig({ ...base, AI_API_KEY: '   ' }), null)
  assert.equal(readAiConfig({ ...base, AI_BASE_URL: undefined }), null)
  assert.equal(readAiConfig({ ...base, AI_MODEL: '' }), null)
  assert.equal(readAiConfig({ ...base, AI_BASE_URL: 'ftp://x/v1' }), null, 'http(s) 만')
  assert.equal(readAiConfig({ ...base, AI_BASE_URL: '주소 아님' }), null)
})

test('★ ② 기본값 · 끝의 / 를 뗀다 · host 만 보인다', () => {
  const c = readAiConfig(base)
  assert.ok(c !== null)
  assert.equal(c.baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(c.maxOutputTokens, AI_DEFAULTS.maxOutputTokens)
  // 무료 등급의 분당 8,000 토큰(입력 + 출력) 안에 응답 하나가 든다 — 한국어는 글자 ≈ 토큰
  assert.deepEqual([c.maxInputChars, c.maxOutputTokens], [6000, 1500])
  assert.ok(c.maxInputChars + c.maxOutputTokens < 8000)
  assert.equal(c.dailyCap, 900)
  assert.equal(c.timeoutMs, 60_000)
  assert.equal(c.streamUsage, true)
  assert.equal(aiProviderHost(c), 'api.groq.com')
  assert.equal(aiProviderHost(readAiConfig({ ...base, AI_BASE_URL: 'http://127.0.0.1:3103/v1' })!), '127.0.0.1:3103')
  assert.equal(maxOutputChars(c), 6000)
})

test('③ 숫자 — 범위 안의 정수만 · 아니면 기본값(상한을 조용히 크게 잡지 않는다) · 하루 상한 0 은 닫는다', () => {
  const c = readAiConfig({ ...base, AI_MAX_OUTPUT_TOKENS: '256', AI_MAX_INPUT_CHARS: ' 500 ', AI_DAILY_CAP: '0', AI_TIMEOUT_MS: '5000', AI_STREAM_USAGE: '0' })!
  assert.deepEqual([c.maxOutputTokens, c.maxInputChars, c.dailyCap, c.timeoutMs, c.streamUsage], [256, 500, 0, 5000, false])
  for (const bad of ['-1', '1.5', 'abc', '0x10', '99999999999', '']) {
    const d = readAiConfig({ ...base, AI_MAX_OUTPUT_TOKENS: bad, AI_DAILY_CAP: bad })!
    assert.equal(d.maxOutputTokens, AI_DEFAULTS.maxOutputTokens, bad)
    assert.equal(d.dailyCap, AI_DEFAULTS.dailyCap, bad)
  }
  assert.equal(readAiConfig({ ...base, AI_MAX_OUTPUT_TOKENS: '0' })!.maxOutputTokens, AI_DEFAULTS.maxOutputTokens, '출력 0 은 없다')
  assert.equal(readAiConfig({ ...base, AI_TIMEOUT_MS: '10' })!.timeoutMs, AI_DEFAULTS.timeoutMs, '1초보다 짧은 상한')
})
