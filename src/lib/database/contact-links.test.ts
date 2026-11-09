/**
 * URL · 이메일 · 전화 속성 — 링크 걸기 · 값 검증 · 글자 · 필터 (순수) — PT-2조각 (F-03-04)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 PT-1] ⑥
 *
 *   ① ★ URL 은 http(s) 일 때만 링크 — javascript: · data: · ftp: · 공백 낀 글은 글로
 *   ② ★ 이메일은 `로컬@도메인.최상위` 꼴일 때만 mailto: — 질의가 될 글자가 낀 글은 글로
 *   ③ ★ 전화는 숫자 · 맨 앞의 + 만 남겨 tel: — 숫자가 없으면 글로
 *   ④ ★ 값 검증 — 글이면 받는다(너그럽게) · 길이 상한 · 글이 아니면 거부
 *   ⑤ 글자 · 초안 · 필터 · 내보내기
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { contactHref, contactLinkProps } from './contact-links.ts'
import { cellText, draftOf, parseDraft, readCell } from './cell-format.ts'
import { operatorsFor, validateFilter } from './filter.ts'
import { CONTACT_MAX_LENGTH, deriveSidecars, emptyValue, isEmptyValue, validateCellValue } from './property-types.ts'
import { cellPlainText } from '../export/csv.ts'

describe('URL 링크', () => {
  test('★ http(s) 만 건다 — 나머지는 null', () => {
    assert.equal(contactHref('url', 'https://example.com/a?b=1'), 'https://example.com/a?b=1')
    assert.equal(contactHref('url', ' http://example.com '), 'http://example.com')
    assert.equal(contactHref('url', 'HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM')
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.com', 'example.com', 'mailto:a@b.co', '//example.com', '']) {
      assert.equal(contactHref('url', bad), null, bad)
    }
  })

  test('★ 공백 · 줄바꿈이 낀 글은 걸지 않는다', () => {
    assert.equal(contactHref('url', 'https://exa mple.com'), null)
    assert.equal(contactHref('url', 'https://example.com\njavascript:alert(1)'), null)
    assert.equal(contactHref('url', 'https://'), null)
  })

  test('링크 속성 — URL 은 새 탭 + noopener noreferrer(공개는 nofollow ugc 도) · 나머지는 href 만', () => {
    assert.deepEqual(contactLinkProps('url', 'https://a.co'), { href: 'https://a.co', target: '_blank', rel: 'noopener noreferrer' })
    assert.deepEqual(contactLinkProps('url', 'https://a.co', true), { href: 'https://a.co', target: '_blank', rel: 'noopener noreferrer nofollow ugc' })
    assert.deepEqual(contactLinkProps('email', 'mailto:a@b.co'), { href: 'mailto:a@b.co' })
  })
})

describe('이메일 링크', () => {
  test('★ 로컬@도메인.최상위 꼴이면 mailto:', () => {
    assert.equal(contactHref('email', 'kim@example.com'), 'mailto:kim@example.com')
    assert.equal(contactHref('email', ' a.b+c@sub.example.co.kr '), 'mailto:a.b+c@sub.example.co.kr')
  })

  test('★ 꼴이 아니거나 질의가 될 글자가 끼면 null', () => {
    for (const bad of ['kim', 'kim@', '@example.com', 'kim@example', 'kim @example.com', 'a@b.com?bcc=x@y.z', 'a@b.com#x', 'a@@b.com', 'a@b..com', '<a@b.com>', 'a,b@c.com']) {
      assert.equal(contactHref('email', bad), null, bad)
    }
  })
})

describe('전화 링크', () => {
  test('★ 숫자 · 맨 앞의 + 만 남겨 tel:', () => {
    assert.equal(contactHref('phone_number', '+82 10-1234-5678'), 'tel:+821012345678')
    assert.equal(contactHref('phone_number', '(02) 123-4567'), 'tel:021234567')
    assert.equal(contactHref('phone_number', '010 1234 5678 ext. 5'), 'tel:01012345678' + '5')
    assert.equal(contactHref('phone_number', '1+2'), 'tel:12', '맨 앞이 아닌 + 는 버린다')
  })

  test('★ 숫자가 하나도 없으면 null', () => {
    for (const bad of ['', '+', '전화 없음', '---', '+ -']) assert.equal(contactHref('phone_number', bad), null, bad)
  })
})

describe('값 검증', () => {
  const valid = (type: 'url' | 'email' | 'phone_number', v: unknown): boolean => validateCellValue(type, v).length === 0

  test('★ 글이면 받는다 — javascript: 도 저장은 된다(링크는 그릴 때 거른다)', () => {
    assert.ok(valid('url', { type: 'url', url: 'javascript:alert(1)' }))
    assert.ok(valid('email', { type: 'email', email: '아무 글' }))
    assert.ok(valid('phone_number', { type: 'phone_number', phone_number: '+82 10-1234-5678' }))
    assert.ok(valid('url', { type: 'url', url: '' }), '빈 글은 앱이 칸을 지운다')
  })

  test('★ 길이 상한 — 2048 · 254 · 64 는 통과, 하나 넘으면 거부', () => {
    assert.deepEqual(CONTACT_MAX_LENGTH, { url: 2048, email: 254, phone_number: 64 })
    for (const type of ['url', 'email', 'phone_number'] as const) {
      const max = CONTACT_MAX_LENGTH[type]
      assert.ok(valid(type, { type, [type]: 'x'.repeat(max) }), type)
      assert.equal(valid(type, { type, [type]: 'x'.repeat(max + 1) }), false, type)
    }
  })

  test('★ 글이 아니거나 봉투 타입이 다르면 거부', () => {
    assert.equal(valid('url', { type: 'url', url: 5 }), false)
    assert.equal(valid('url', { type: 'url', url: null }), false)
    assert.equal(valid('url', { type: 'url' }), false)
    assert.equal(valid('email', { type: 'url', url: 'https://a.co' }), false)
  })
})

describe('글자 · 초안 · 필터 · 내보내기', () => {
  test('빈 값 · 비었음 · 사이드카', () => {
    for (const type of ['url', 'email', 'phone_number'] as const) {
      assert.ok(isEmptyValue(emptyValue(type)))
      assert.equal(deriveSidecars(emptyValue(type)).text, null)
      assert.deepEqual(readCell(type, undefined), emptyValue(type))
    }
    assert.equal(deriveSidecars({ type: 'url', url: 'https://a.co' }).text, 'https://a.co')
    assert.equal(isEmptyValue({ type: 'email', email: 'a@b.co' }), false)
  })

  test('글자 · 초안은 적힌 그대로 · 앞뒤 공백은 걷는다', () => {
    const v = { type: 'phone_number', phone_number: '+82 10-1234-5678' } as const
    assert.equal(cellText(v), '+82 10-1234-5678')
    assert.equal(draftOf(v), '+82 10-1234-5678')
    assert.deepEqual(parseDraft('url', '  https://a.co \n', emptyValue('url')), { ok: true, value: { type: 'url', url: 'https://a.co' } })
    assert.deepEqual(parseDraft('email', '   ', emptyValue('email')), { ok: true, value: { type: 'email', email: '' } })
    assert.equal(parseDraft('phone_number', '1'.repeat(65), emptyValue('phone_number')).ok, false)
  })

  test('필터 — 글과 같은 연산자 여덟 개', () => {
    for (const type of ['url', 'email', 'phone_number'] as const) {
      assert.deepEqual(operatorsFor(type), operatorsFor('rich_text'))
    }
    const types = new Map([['p1', 'url']])
    assert.deepEqual(validateFilter({ property_id: 'p1', operator: 'contains', value: 'example' }, types as never), [])
  })

  test('내보내기 — 글 그대로(수식 막기는 건다)', () => {
    const column = (type: 'url' | 'email' | 'phone_number') => ({ propertyId: 'p', name: 'n', type }) as never
    assert.equal(cellPlainText(column('url'), { type: 'url', url: 'https://a.co' }), 'https://a.co')
    assert.equal(cellPlainText(column('email'), { type: 'email', email: 'a@b.co' }), 'a@b.co')
    assert.equal(cellPlainText(column('phone_number'), { type: 'phone_number', phone_number: '+82 10' }), '+82 10')
  })
})
