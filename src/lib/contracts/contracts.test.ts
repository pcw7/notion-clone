/**
 * W2 계약 테스트 — F-09-03(RichText) / F-09-04(페이지네이션) / F-01-02(블록 타입)
 *
 * 로드맵: "이 주에 고친 계약은 이후 못 고친다."
 * 그래서 계약이 **의도대로 굳었는지**를 테스트로 못박는다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  COLORS,
  DEFAULT_ANNOTATIONS,
  MAX_EQUATION,
  MAX_LINK_URL,
  MAX_RUN_CONTENT,
  TEXT_COLORS,
  isColor,
  normalizeRichText,
  sameAnnotations,
  textRun,
  toPlainText,
  validateRichText,
  type RichTextRun,
} from './rich-text.ts'

import {
  COMPLETE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_QUERY_ROWS,
  decodeCursor,
  encodeCursor,
  incomplete,
  isFullyRead,
  listEnvelope,
  normalizePageSize,
} from './pagination.ts'

import {
  BLOCK_TYPES,
  MVP_BLOCK_TYPES,
  UNSUPPORTED_TYPE,
  isKnownBlockType,
  isMvpBlockType,
  normalizeFormat,
  specOf,
  unwrapUnsupported,
  wrapUnsupported,
} from '../block/types.ts'

describe('색 enum — 정확히 19개 (나중에 못 바꾼다)', () => {
  test('19개다', () => {
    // 마스터 문서: "색 enum을 나중에 넣으면 전 블록 마이그레이션."
    // 1차 출처로 두 번 재검증된 숫자다.
    assert.equal(COLORS.length, 19, `${COLORS.length}개다 — default + 텍스트 9 + 배경 9`)
    assert.equal(TEXT_COLORS.length, 9)
  })

  test('default_background 는 존재하지 않는다', () => {
    // 공개 API 열거에도, 헬프센터 목록에도 없다.
    // UI 의 "기본 배경"은 배경이 없는 상태라서 값이 불필요할 뿐이다.
    assert.equal(isColor('default_background'), false)
    assert.equal(COLORS.includes('default_background' as never), false)
  })

  test('default 는 있고 9색 배경도 전부 있다', () => {
    assert.equal(isColor('default'), true)
    for (const c of TEXT_COLORS) {
      assert.equal(isColor(c), true, `${c} 누락`)
      assert.equal(isColor(`${c}_background`), true, `${c}_background 누락`)
    }
  })

  test('모르는 색은 거부', () => {
    assert.equal(isColor('rainbow'), false)
    assert.equal(isColor(''), false)
    assert.equal(isColor(null), false)
  })
})

describe('validateRichText', () => {
  test('정상 런은 통과', () => {
    assert.deepEqual(validateRichText([textRun('안녕')]), [])
  })

  test('빈 배열은 허용', () => {
    assert.deepEqual(validateRichText([]), [])
  })

  test('배열이 아니면 거부', () => {
    assert.equal(validateRichText({}).length, 1)
  })

  test(`content ${MAX_RUN_CONTENT}자 초과는 거부하고 쪼개라고 알려준다`, () => {
    // 순진한 마크다운 임포터가 여기서 400 을 맞는다.
    const issues = validateRichText([textRun('가'.repeat(MAX_RUN_CONTENT + 1))])
    assert.equal(issues.length, 1)
    assert.match(issues[0].message, /쪼개/)
  })

  test(`정확히 ${MAX_RUN_CONTENT}자는 통과`, () => {
    assert.deepEqual(validateRichText([textRun('가'.repeat(MAX_RUN_CONTENT))]), [])
  })

  test('링크 URL 길이 상한', () => {
    const run = textRun('x')
    run.text!.link = { url: 'h'.repeat(MAX_LINK_URL + 1) }
    assert.equal(validateRichText([run]).length, 1)
  })

  test('수식 길이 상한', () => {
    const run: RichTextRun = {
      type: 'equation',
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: '',
      href: null,
      equation: { expression: 'x'.repeat(MAX_EQUATION + 1) },
    }
    assert.equal(validateRichText([run]).length, 1)
  })

  test('존재하지 않는 색은 거부하고 이유를 알려준다', () => {
    const run = textRun('x')
    ;(run.annotations as { color: string }).color = 'default_background'
    const issues = validateRichText([run])
    assert.equal(issues.length, 1)
    assert.match(issues[0].message, /default_background 는 존재하지 않습니다/)
  })

  test('응답 전용 파생값(plain_text·href)은 있어도 거부하지 않는다', () => {
    // "보내도 무시한다"가 계약이다. 거부하면 클라이언트가 받은 값을 그대로
    // 돌려보낼 때 400 을 맞는다.
    const run = { ...textRun('x'), plain_text: '엉뚱한값', href: 'https://x' }
    assert.deepEqual(validateRichText([run]), [])
  })
})

describe('normalizeRichText — ProseMirror 어댑터', () => {
  test('인접한 동일 서식 런을 합친다', () => {
    const runs = [textRun('안'), textRun('녕'), textRun('하세요')]
    const out = normalizeRichText(runs)
    assert.equal(out.length, 1)
    assert.equal(out[0].text!.content, '안녕하세요')
    assert.equal(out[0].plain_text, '안녕하세요')
  })

  test('서식이 다르면 합치지 않는다', () => {
    const out = normalizeRichText([textRun('보통'), textRun('굵게', { bold: true })])
    assert.equal(out.length, 2)
  })

  test('링크가 다르면 합치지 않는다', () => {
    const a = textRun('a')
    a.text!.link = { url: 'https://one' }
    const b = textRun('b')
    b.text!.link = { url: 'https://two' }
    assert.equal(normalizeRichText([a, b]).length, 2)
  })

  test('빈 런은 제거한다', () => {
    assert.deepEqual(normalizeRichText([textRun('')]), [])
  })

  test('mention 과 equation 은 합치지 않는다 — 각각이 원자다', () => {
    const m: RichTextRun = {
      type: 'mention', annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: '@홍길동', href: null, mention: { type: 'user' },
    }
    const out = normalizeRichText([m, { ...m }])
    assert.equal(out.length, 2)
  })

  test('평문 추출은 병합 전후가 같다', () => {
    const runs = [textRun('안'), textRun('녕'), textRun('!', { bold: true })]
    assert.equal(toPlainText(runs), toPlainText(normalizeRichText(runs)))
  })

  test('sameAnnotations 는 색까지 본다', () => {
    const a = { ...DEFAULT_ANNOTATIONS }
    const b = { ...DEFAULT_ANNOTATIONS, color: 'red' as const }
    assert.equal(sameAnnotations(a, a), true)
    assert.equal(sameAnnotations(a, b), false)
  })
})

describe('페이지네이션 봉투 — "다 읽었다"의 판정', () => {
  test('마지막 페이지는 has_more=false, next_cursor=null', () => {
    const env = listEnvelope([1, 2, 3])
    assert.equal(env.has_more, false)
    assert.equal(env.next_cursor, null)
    assert.equal(env.object, 'list')
  })

  test('커서가 있으면 has_more=true', () => {
    const env = listEnvelope([1], { nextCursor: 'abc' })
    assert.equal(env.has_more, true)
  })

  test('has_more=false 만으로 "다 읽었다"고 판단하면 안 된다', () => {
    // 10,000행 상한에 걸려도 has_more 는 false 다.
    // 이 구분이 없으면 호출자가 데이터를 조용히 잃는다.
    const truncated = listEnvelope([1], { status: incomplete('query_result_limit_reached') })
    assert.equal(truncated.has_more, false)
    assert.equal(isFullyRead(truncated), false, 'incomplete 인데 완주로 판정했다')

    const done = listEnvelope([1], { status: COMPLETE })
    assert.equal(isFullyRead(done), true)
  })

  test('상한 상수', () => {
    assert.equal(MAX_PAGE_SIZE, 100)
    assert.equal(DEFAULT_PAGE_SIZE, 100)
    assert.equal(MAX_QUERY_ROWS, 10_000)
  })

  test('page_size 는 잘라내고 400 을 내지 않는다', () => {
    assert.equal(normalizePageSize(50), 50)
    assert.equal(normalizePageSize(1000), MAX_PAGE_SIZE)
    assert.equal(normalizePageSize(0), DEFAULT_PAGE_SIZE)
    assert.equal(normalizePageSize(-5), DEFAULT_PAGE_SIZE)
    assert.equal(normalizePageSize('abc'), DEFAULT_PAGE_SIZE)
    assert.equal(normalizePageSize(undefined), DEFAULT_PAGE_SIZE)
    assert.equal(normalizePageSize(10.9), 10)
  })
})

describe('커서 — 불투명하고 왕복 가능해야 한다', () => {
  test('인코딩·디코딩 왕복', () => {
    const c = { sortKey: 'a0', id: 'abc-123' }
    assert.deepEqual(decodeCursor(encodeCursor(c)), c)
  })

  test('내부 구조가 드러나지 않는다', () => {
    const encoded = encodeCursor({ sortKey: 'a0', id: 'abc' })
    assert.equal(encoded.includes('sortKey'), false)
    assert.equal(encoded.includes('a0'), false)
  })

  test('손상된 커서는 던지지 않고 null', () => {
    // 던지면 500 이 된다. null 이면 호출자가 처음부터 다시 읽으면 된다.
    assert.equal(decodeCursor('!!!not-base64!!!'), null)
    assert.equal(decodeCursor(''), null)
    assert.equal(decodeCursor(null), null)
    assert.equal(decodeCursor(Buffer.from('{}').toString('base64url')), null)
    assert.equal(decodeCursor('x'.repeat(600)), null)
  })
})

describe('블록 타입 레지스트리 — F-01-02', () => {
  test('MVP 는 12종이다', () => {
    assert.equal(MVP_BLOCK_TYPES.length, 12)
  })

  test('page 와 unsupported 는 MVP 12종에 포함되지 않는다', () => {
    assert.equal(isMvpBlockType('page'), false)
    assert.equal(isMvpBlockType(UNSUPPORTED_TYPE), false)
    assert.equal(isKnownBlockType('page'), true)
    assert.equal(isKnownBlockType(UNSUPPORTED_TYPE), true)
  })

  test('divider 와 image 는 rich text 도 색도 없다', () => {
    // API 가 이 타입들에 color 필드를 두지 않는다(GAP 2회차 확인).
    for (const t of ['divider', 'image'] as const) {
      assert.equal(specOf(t).hasRichText, false, `${t}`)
      assert.equal(specOf(t).supportsColor, false, `${t}`)
    }
  })

  test('heading 은 자식을 가질 수 없다', () => {
    for (const t of ['heading_1', 'heading_2', 'heading_3'] as const) {
      assert.equal(specOf(t).canHaveChildren, false, `${t}`)
    }
  })

  test('모든 등록 타입이 스펙을 갖는다', () => {
    for (const t of Object.keys(BLOCK_TYPES)) {
      const s = specOf(t as never)
      assert.equal(typeof s.hasRichText, 'boolean', t)
      assert.equal(typeof s.canHaveChildren, 'boolean', t)
      assert.equal(typeof s.supportsColor, 'boolean', t)
    }
  })
})

describe('unsupported 폴백 — 라운드트립 무손실', () => {
  test('모르는 타입을 감싼다', () => {
    const wrapped = wrapUnsupported('meeting_notes', { foo: 1 }, { bar: 2 })
    assert.ok(wrapped)
    assert.equal(wrapped.type, UNSUPPORTED_TYPE)
    assert.equal(wrapped.properties.original_type, 'meeting_notes')
  })

  test('아는 타입은 감싸지 않는다', () => {
    assert.equal(wrapUnsupported('paragraph', {}, {}), null)
  })

  test('감쌌다 풀면 원본이 그대로 돌아온다', () => {
    // 이게 깨지면 구버전 클라이언트가 페이지를 열었다 저장하는 것만으로
    // 신규 타입 블록이 소멸한다.
    const props = { rich_text: [textRun('회의록')], nested: { deep: [1, 2, 3] } }
    const format = { block_color: 'red', custom: true }

    const wrapped = wrapUnsupported('meeting_notes', props, format)!
    const unwrapped = unwrapUnsupported(wrapped.type, wrapped.properties)!

    assert.equal(unwrapped.type, 'meeting_notes')
    assert.deepEqual(unwrapped.properties, props)
    assert.deepEqual(unwrapped.format, format)
  })

  test('unsupported 가 아니면 풀 것이 없다', () => {
    assert.equal(unwrapUnsupported('paragraph', {}), null)
  })

  test('망가진 페이로드는 null', () => {
    assert.equal(unwrapUnsupported(UNSUPPORTED_TYPE, { nope: 1 }), null)
    assert.equal(unwrapUnsupported(UNSUPPORTED_TYPE, null), null)
  })
})

describe('normalizeFormat', () => {
  test('색을 지원하는 타입은 유지한다', () => {
    assert.equal(normalizeFormat('paragraph', { block_color: 'red' }).block_color, 'red')
  })

  test('색을 지원하지 않는 타입에서는 버린다', () => {
    // 저장해두면 나중에 그 타입이 색을 지원하게 됐을 때
    // 사용자가 지정한 적 없는 색이 갑자기 나타난다.
    assert.equal(normalizeFormat('divider', { block_color: 'red' }).block_color, undefined)
    assert.equal(normalizeFormat('image', { block_color: 'blue' }).block_color, undefined)
  })

  test('존재하지 않는 색은 버린다', () => {
    assert.equal(normalizeFormat('paragraph', { block_color: 'rainbow' }).block_color, undefined)
    assert.equal(
      normalizeFormat('paragraph', { block_color: 'default_background' }).block_color,
      undefined,
    )
  })

  test('다른 format 키는 보존한다', () => {
    const out = normalizeFormat('paragraph', { block_color: 'red', code_wrap: true })
    assert.equal(out.code_wrap, true)
  })

  test('format 이 없어도 안전하다', () => {
    assert.deepEqual(normalizeFormat('paragraph', null), {})
    assert.deepEqual(normalizeFormat('paragraph', undefined), {})
  })
})
