/**
 * rich text 오프셋 · 분할 · 병합 — F-01-19 텍스트 계층
 *
 * 여기서 검증하는 것은 하나다: **글자가 사라지지 않는가.**
 * 그래서 거의 모든 테스트가 "분할 후 head + tail 이 원본과 같다"를 확인한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_RICH_TEXT_RUNS,
  MAX_RUN_CONTENT,
  DEFAULT_ANNOTATIONS,
  textRun,
  toPlainText,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import { canonicalizeRuns, concatRuns, splitRunsAt, unitLength } from './rich-text-ops.ts'

const bold = (s: string) => textRun(s, { bold: true })

function mention(display: string): RichTextRun {
  return {
    type: 'mention',
    annotations: { ...DEFAULT_ANNOTATIONS },
    plain_text: display,
    href: null,
    mention: { type: 'user', id: 'u1' },
  }
}

function equation(expr: string): RichTextRun {
  return {
    type: 'equation',
    annotations: { ...DEFAULT_ANNOTATIONS },
    plain_text: expr,
    href: null,
    equation: { expression: expr },
  }
}

describe('unitLength — 오프셋 단위 규칙', () => {
  test('텍스트는 문자 수, 원자는 1이다', () => {
    assert.equal(unitLength([textRun('abc')]), 3)
    assert.equal(unitLength([mention('@홍길동')]), 1)
    assert.equal(unitLength([equation('x^2 + y^2')]), 1)
  })

  test('원자가 섞이면 plain_text 길이와 달라진다 — 이게 규칙의 요점이다', () => {
    const runs = [textRun('ab'), mention('@홍길동'), textRun('cd')]
    assert.equal(unitLength(runs), 5) // 2 + 1(원자) + 2
    assert.equal(toPlainText(runs).length, 8) // 2 + 4('@홍길동') + 2
    // 두 값이 다르다는 사실 자체가 "오프셋은 문자 인덱스가 아니다"를 말한다.
  })
})

describe('splitRunsAt — 기본', () => {
  test('런 한가운데를 자르면 양쪽이 원본을 합친 것과 같다', () => {
    const runs = [textRun('안녕하세요')]
    const { head, tail } = splitRunsAt(runs, 2)
    assert.equal(toPlainText(head), '안녕')
    assert.equal(toPlainText(tail), '하세요')
    assert.equal(toPlainText(head) + toPlainText(tail), toPlainText(runs))
  })

  test('맨 앞(0)에서 자르면 전부 tail 이다', () => {
    const { head, tail } = splitRunsAt([textRun('abc')], 0)
    assert.deepEqual(head, [])
    assert.equal(toPlainText(tail), 'abc')
  })

  test('맨 뒤에서 자르면 전부 head 다 — Enter 로 아래에 빈 블록을 만드는 경우', () => {
    const runs = [textRun('abc')]
    const { head, tail } = splitRunsAt(runs, 3)
    assert.equal(toPlainText(head), 'abc')
    assert.deepEqual(tail, [])
  })

  test('빈 배열은 오프셋 0 에서만 잘린다', () => {
    const { head, tail } = splitRunsAt([], 0)
    assert.deepEqual(head, [])
    assert.deepEqual(tail, [])
  })

  test('범위를 벗어난 오프셋은 던진다 — 조용히 clamp 하지 않는다', () => {
    assert.throws(() => splitRunsAt([textRun('abc')], 4), RangeError)
    assert.throws(() => splitRunsAt([textRun('abc')], -1), RangeError)
    assert.throws(() => splitRunsAt([textRun('abc')], 1.5), RangeError)
  })
})

describe('splitRunsAt — 서식 경계', () => {
  test('서식이 걸린 span 한가운데를 자르면 양쪽 모두 서식을 유지한다', () => {
    const runs = [textRun('일반'), bold('굵게')]
    const { head, tail } = splitRunsAt(runs, 3) // '일반' + '굵' | '게'

    assert.equal(toPlainText(head), '일반굵')
    assert.equal(toPlainText(tail), '게')
    assert.equal(head[1].annotations.bold, true)
    assert.equal(tail[0].annotations.bold, true)
  })

  test('정확히 서식 경계에서 자르면 span 을 쪼개지 않는다', () => {
    const runs = [textRun('일반'), bold('굵게')]
    const { head, tail } = splitRunsAt(runs, 2)

    assert.equal(head.length, 1)
    assert.equal(head[0].annotations.bold, false)
    assert.equal(tail.length, 1)
    assert.equal(tail[0].annotations.bold, true)
  })

  test('분할 결과는 정규화된다 — 빈 span 이 남지 않는다', () => {
    const runs = [textRun('ab'), bold('cd')]
    for (let offset = 0; offset <= unitLength(runs); offset += 1) {
      const { head, tail } = splitRunsAt(runs, offset)
      for (const r of [...head, ...tail]) {
        assert.notEqual(r.text?.content, '', `offset=${offset} 에서 빈 런이 남았다`)
      }
    }
  })

  test('링크는 양쪽 모두 유지된다', () => {
    const linked: RichTextRun = {
      ...textRun('example'),
      href: 'https://example.com',
      text: { content: 'example', link: { url: 'https://example.com' } },
    }
    const { head, tail } = splitRunsAt([linked], 3)
    assert.equal(head[0].text?.link?.url, 'https://example.com')
    assert.equal(tail[0].text?.link?.url, 'https://example.com')
  })

  test('모든 오프셋에서 head+tail 이 원본 평문과 같다 (전수)', () => {
    const runs = [textRun('가나'), bold('다라'), textRun('마')]
    const original = toPlainText(runs)
    for (let offset = 0; offset <= unitLength(runs); offset += 1) {
      const { head, tail } = splitRunsAt(runs, offset)
      assert.equal(
        toPlainText(head) + toPlainText(tail),
        original,
        `offset=${offset} 에서 텍스트가 유실됐다`,
      )
    }
  })
})

describe('splitRunsAt — 원자(mention · equation)', () => {
  test('원자는 통째로 한쪽에 간다 — 반으로 쪼개지지 않는다', () => {
    const runs = [textRun('ab'), mention('@홍길동'), textRun('cd')]

    // 오프셋 2 = 멘션 **앞**
    const before = splitRunsAt(runs, 2)
    assert.equal(before.head.length, 1)
    assert.equal(before.tail[0].type, 'mention')

    // 오프셋 3 = 멘션 **뒤**
    const after = splitRunsAt(runs, 3)
    assert.equal(after.head[1].type, 'mention')
    assert.equal(toPlainText(after.tail), 'cd')
  })

  test('원자 내부를 가리키는 오프셋은 존재할 수 없다 (전수)', () => {
    // 이 테스트가 "원자는 길이 1" 판결의 전부다. 어떤 오프셋을 넣어도
    // 원자를 관통하는 경우가 생기지 않으므로 스냅 처리가 아예 필요 없다.
    const runs = [mention('@아주긴이름입니다'), equation('\\frac{1}{2}'), textRun('끝')]
    assert.equal(unitLength(runs), 3)

    for (let offset = 0; offset <= 3; offset += 1) {
      const { head, tail } = splitRunsAt(runs, offset)
      const all = [...head, ...tail]
      assert.equal(all.length, 3, `offset=${offset} 에서 런 수가 변했다`)
      assert.equal(toPlainText(head) + toPlainText(tail), toPlainText(runs))
    }
  })

  test('원자만 있을 때 오프셋 상한은 원자 개수다', () => {
    const runs = [mention('@a'), mention('@b')]
    assert.equal(unitLength(runs), 2)
    assert.throws(() => splitRunsAt(runs, 3), RangeError)
  })
})

describe('canonicalizeRuns', () => {
  test('인접한 동일 서식을 합친다', () => {
    const runs = canonicalizeRuns([textRun('가'), textRun('나'), bold('다')])
    assert.equal(runs.length, 2)
    assert.equal(runs[0].text?.content, '가나')
  })

  test('합친 결과가 2000자를 넘으면 다시 쪼갠다 — 잘라내지 않는다', () => {
    const a = textRun('a'.repeat(1500))
    const b = textRun('b'.repeat(1500))
    const runs = canonicalizeRuns([a, b])

    assert.equal(runs.length, 2, '3000자를 한 런으로 두면 계약(2000자)을 어긴다')
    for (const r of runs) {
      assert.ok((r.text?.content.length ?? 0) <= MAX_RUN_CONTENT)
    }
    // 손실이 없어야 한다.
    assert.equal(toPlainText(runs).length, 3000)
    assert.equal(toPlainText(runs), 'a'.repeat(1500) + 'b'.repeat(1500))
  })

  test('원자는 합치지도 쪼개지도 않는다', () => {
    const runs = canonicalizeRuns([mention('@a'), mention('@b')])
    assert.equal(runs.length, 2)
  })
})

describe('concatRuns — 블록 병합의 텍스트 계층', () => {
  test('경계에서 서식이 같으면 하나로 합쳐진다', () => {
    const r = concatRuns([textRun('앞')], [textRun('뒤')])
    assert.ok(r.ok)
    assert.equal(r.runs.length, 1)
    assert.equal(r.runs[0].text?.content, '앞뒤')
  })

  test('경계에서 서식이 다르면 런이 유지된다', () => {
    const r = concatRuns([textRun('앞')], [bold('뒤')])
    assert.ok(r.ok)
    assert.equal(r.runs.length, 2)
  })

  test('한쪽이 비어 있으면 다른 쪽 그대로다', () => {
    const r = concatRuns([], [textRun('뒤')])
    assert.ok(r.ok)
    assert.equal(toPlainText(r.runs), '뒤')
  })

  test('100 요소를 넘으면 거부한다 — 잘라내지 않는다', () => {
    // 서로 다른 서식을 번갈아 넣어 정규화로 줄어들지 않게 만든다.
    const alternating = (n: number, prefix: string): RichTextRun[] =>
      Array.from({ length: n }, (_, i) =>
        i % 2 === 0 ? textRun(`${prefix}${i}`) : bold(`${prefix}${i}`),
      )

    const left = alternating(60, 'L')
    const right = alternating(60, 'R')
    const r = concatRuns(left, right)

    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.reason, 'too_many_runs')
      assert.equal(r.limit, MAX_RICH_TEXT_RUNS)
      assert.ok(r.count > MAX_RICH_TEXT_RUNS)
    }
  })

  test('정확히 100 요소면 통과한다 — 경계에서 한 칸 어긋나지 않는다', () => {
    const alternating = (n: number): RichTextRun[] =>
      Array.from({ length: n }, (_, i) => (i % 2 === 0 ? textRun(`x${i}`) : bold(`y${i}`)))

    const r = concatRuns(alternating(50), alternating(50))
    assert.ok(r.ok)
    // 경계에서 마지막(bold)과 첫(text)이 서식이 달라 합쳐지지 않는다.
    assert.equal(r.runs.length, MAX_RICH_TEXT_RUNS)
  })
})

describe('분할 → 병합 왕복', () => {
  test('어느 오프셋에서 잘라 다시 붙여도 원본과 같다 (전수)', () => {
    const runs = [textRun('가나'), bold('다라'), mention('@사람'), textRun('마바')]
    const original = canonicalizeRuns(runs)

    for (let offset = 0; offset <= unitLength(runs); offset += 1) {
      const { head, tail } = splitRunsAt(runs, offset)
      const rejoined = concatRuns(head, tail)
      assert.ok(rejoined.ok, `offset=${offset} 에서 재병합이 거부됐다`)
      assert.deepEqual(
        rejoined.runs,
        original,
        `offset=${offset} 에서 왕복이 원본과 달라졌다`,
      )
    }
  })
})
