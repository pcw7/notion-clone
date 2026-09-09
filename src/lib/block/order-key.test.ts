import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ORDER_KEY_MAX_LEN,
  compareBlockOrder,
  firstOrderKey,
  needsRebalance,
  orderKeyBetween,
  orderKeysBetween,
  rebalancedKeys,
} from './order-key.ts'

/** 배열이 문자열 사전순으로 오름차순인가. */
function isSorted(keys: readonly string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    if (!(keys[i - 1] < keys[i])) return false
  }
  return true
}

describe('orderKeyBetween — 기본', () => {
  test('빈 부모의 첫 키', () => {
    const k = firstOrderKey()
    assert.ok(k.length > 0)
  })

  test('앞·뒤에 붙이기', () => {
    const mid = firstOrderKey()
    const before = orderKeyBetween(null, mid)
    const after = orderKeyBetween(mid, null)
    assert.ok(before < mid, `${before} < ${mid}`)
    assert.ok(mid < after, `${mid} < ${after}`)
  })

  test('두 키 사이', () => {
    const a = firstOrderKey()
    const b = orderKeyBetween(a, null)
    const m = orderKeyBetween(a, b)
    assert.ok(a < m && m < b, `${a} < ${m} < ${b}`)
  })

  test('순서가 뒤집힌 입력은 거부한다 — 라이브러리는 안 막는다', () => {
    // 라이브러리(fractional-indexing)는 before >= after 를 검사하지 않는다.
    // generateKeyBetween('a1','a0') 은 예외 없이 'a0V' 를 돌려주는데,
    // 이 값은 두 경계 어느 쪽 사이도 아니다. 그대로 저장되면 정렬이 조용히 깨진다.
    const a = firstOrderKey()
    const b = orderKeyBetween(a, null)
    assert.throws(() => orderKeyBetween(b, a), RangeError)
    assert.throws(() => orderKeysBetween(b, a, 3), RangeError)
  })

  test('같은 값을 경계로 주면 거부한다', () => {
    const a = firstOrderKey()
    assert.throws(() => orderKeyBetween(a, a))
  })
})

describe('orderKeysBetween — 일괄 생성', () => {
  test('n개가 정렬된 상태로 나온다', () => {
    const keys = orderKeysBetween(null, null, 10)
    assert.equal(keys.length, 10)
    assert.ok(isSorted(keys), keys.join(' '))
  })

  test('경계 사이에 전부 들어간다', () => {
    const a = firstOrderKey()
    const b = orderKeyBetween(a, null)
    const keys = orderKeysBetween(a, b, 5)
    assert.ok(isSorted([a, ...keys, b]), [a, ...keys, b].join(' '))
  })

  test('0개는 빈 배열', () => {
    assert.deepEqual(orderKeysBetween(null, null, 0), [])
  })

  test('음수는 거부', () => {
    assert.throws(() => orderKeysBetween(null, null, -1), RangeError)
  })
})

describe('실제 편집 시나리오 — 순서가 절대 깨지지 않는다', () => {
  test('맨 앞에 1000번 삽입해도 정렬이 유지된다', () => {
    // 같은 위치 반복 삽입이 fractional index 의 최악 경로다.
    let keys: string[] = [firstOrderKey()]
    for (let i = 0; i < 1000; i++) {
      keys = [orderKeyBetween(null, keys[0]), ...keys]
    }
    assert.ok(isSorted(keys), '맨 앞 반복 삽입에서 정렬이 깨졌다')
  })

  test('같은 두 키 사이에 1000번 삽입해도 정렬이 유지된다', () => {
    const lo = firstOrderKey()
    const hi = orderKeyBetween(lo, null)
    const keys: string[] = [lo, hi]
    for (let i = 0; i < 1000; i++) {
      // 항상 첫 번째와 두 번째 사이에 끼워 넣는다 — 키가 가장 빨리 길어지는 패턴
      const k = orderKeyBetween(keys[0], keys[1])
      keys.splice(1, 0, k)
    }
    assert.ok(isSorted(keys), '중간 반복 삽입에서 정렬이 깨졌다')
  })

  test('무작위 삽입·이동 2000회 후에도 정렬이 유지된다', () => {
    // 시드 고정 LCG — 실패를 재현할 수 있어야 한다
    let seed = 42
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }

    const keys: string[] = orderKeysBetween(null, null, 5)
    for (let i = 0; i < 2000; i++) {
      const at = Math.floor(rnd() * (keys.length + 1))
      const before = at === 0 ? null : keys[at - 1]
      const after = at === keys.length ? null : keys[at]
      const k = orderKeyBetween(before, after)
      keys.splice(at, 0, k)

      // 가끔 하나를 다른 곳으로 옮긴다
      if (i % 7 === 0 && keys.length > 3) {
        const from = Math.floor(rnd() * keys.length)
        keys.splice(from, 1)
        const to = Math.floor(rnd() * (keys.length + 1))
        const b2 = to === 0 ? null : keys[to - 1]
        const a2 = to === keys.length ? null : keys[to]
        keys.splice(to, 0, orderKeyBetween(b2, a2))
      }
    }
    assert.ok(isSorted(keys), '무작위 편집에서 정렬이 깨졌다')
    assert.equal(new Set(keys).size, keys.length, '키가 중복됐다 — UNIQUE 제약이 터진다')
  })
})

describe('재균형 (B7)', () => {
  test('짧은 키는 재균형이 필요 없다', () => {
    assert.equal(needsRebalance(firstOrderKey()), false)
  })

  test(`${ORDER_KEY_MAX_LEN}자를 넘으면 재균형 대상`, () => {
    assert.equal(needsRebalance('a'.repeat(ORDER_KEY_MAX_LEN)), false)
    assert.equal(needsRebalance('a'.repeat(ORDER_KEY_MAX_LEN + 1)), true)
  })

  test('반복 삽입이 실제로 상한을 넘긴다 — 재균형이 필요한 이유', () => {
    let lo = firstOrderKey()
    const hi = orderKeyBetween(lo, null)
    let longest = 0
    for (let i = 0; i < 200; i++) {
      lo = orderKeyBetween(lo, hi)
      longest = Math.max(longest, lo.length)
    }
    assert.ok(longest > ORDER_KEY_MAX_LEN, `최장 ${longest}자 — 상한을 넘지 않으면 이 규칙이 무의미하다`)
  })

  test('재균형 결과는 짧고 정렬돼 있다', () => {
    const keys = rebalancedKeys(500)
    assert.equal(keys.length, 500)
    assert.ok(isSorted(keys))
    const longest = Math.max(...keys.map((k) => k.length))
    assert.ok(longest <= ORDER_KEY_MAX_LEN, `재균형 후에도 ${longest}자다`)
  })
})

describe('compareBlockOrder — 결정적 정렬 (B7)', () => {
  test('order_key 로 먼저 비교한다', () => {
    const a = { orderKey: 'a0', id: 'zzz' }
    const b = { orderKey: 'a1', id: 'aaa' }
    assert.ok(compareBlockOrder(a, b) < 0)
  })

  test('order_key 가 같으면 id 로 가른다', () => {
    // 다른 부모의 자식들을 한 배열에 모으면 같은 키가 나올 수 있다.
    // 여기서 순서가 흔들리면 페이지네이션이 항목을 건너뛴다.
    const a = { orderKey: 'a0', id: '111' }
    const b = { orderKey: 'a0', id: '222' }
    assert.ok(compareBlockOrder(a, b) < 0)
    assert.ok(compareBlockOrder(b, a) > 0)
    assert.equal(compareBlockOrder(a, a), 0)
  })

  test('정렬 결과가 안정적이다', () => {
    const items = [
      { orderKey: 'a0', id: 'c' },
      { orderKey: 'a0', id: 'a' },
      { orderKey: 'a0', id: 'b' },
    ]
    const once = [...items].sort(compareBlockOrder).map((x) => x.id)
    const twice = [...items].reverse().sort(compareBlockOrder).map((x) => x.id)
    assert.deepEqual(once, twice, '입력 순서에 따라 결과가 달라지면 결정적이지 않다')
  })
})
