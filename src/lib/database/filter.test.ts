/**
 * 필터 · 정렬 컴파일러 — W8-b (F-03-17)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **사용자 입력이 SQL 문법에 닿지 않는다.** 컴파일 결과에 값도, property_id 도,
 *      연산자 이름도 들어가지 않는다 — `$n` 과 이 파일의 리터럴뿐이다
 *   ② **부정 연산자는 `NOT EXISTS` 다.** 셀이 없는 행이 `does_not_equal` 에 걸려야 한다
 *   ③ **지워진 프로퍼티를 참조하는 규칙은 무시한다.** 0건으로 만들면 데이터 소실로 오인된다
 *   ④ 깊이·항목 수 상한은 **쓰기 경로에서만** 본다
 *   ⑤ 커서는 NULL 을 `IS NOT DISTINCT FROM` 으로 비교한다 — `=` 면 빈 칸 행이 사라진다
 *   ⑥ "나"(6g-2c) — 사람 값의 컨텍스트 노드는 컴파일할 때 보는 사람으로 묶인다 · 보는 사람이 없으면 아무도 아니다 · 저장 검증은 사람
 *      값으로 uuid 또는 이 노드만 받는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_FILTER_DEPTH,
  MAX_FILTER_GROUP_ITEMS,
  MAX_SORT_KEYS,
  ME_NODE,
  NO_VIEWER,
  ParamBag,
  compileCursor,
  compileFilter,
  isMeNode,
  compileSorts,
  isGroup,
  operatorArity,
  operatorsFor,
  validateFilter,
  validateSorts,
  type FilterNode,
} from './filter.ts'

/** 프로퍼티 타입 맵. 테스트마다 같은 id 를 쓴다. */
const TYPES = new Map<string, string>([
  ['pTitle', 'title'],
  ['pText', 'rich_text'],
  ['pNum', 'number'],
  ['pSel', 'select'],
  ['pChk', 'checkbox'],
  ['pDate', 'date'],
  ['pPeople', 'people'],
  // MVP 밖 타입. 필터할 수 없어야 한다.
  ['pFormula', 'formula'],
])

const compile = (node: FilterNode | null, me: string | null = null): { sql: string | null; values: unknown[] } => {
  const params = new ParamBag(1)
  const sql = compileFilter(node, TYPES, params, me === null ? NO_VIEWER : { me })
  return { sql, values: params.values }
}

describe('연산자 목록', () => {
  test('텍스트 계열은 8개 (F-03-17 전수표)', () => {
    assert.deepEqual(operatorsFor('title').sort(), operatorsFor('rich_text').sort())
    assert.equal(operatorsFor('title').length, 8)
  })

  test('★ checkbox 에 is_empty 가 없다 — null 상태가 없다', () => {
    assert.deepEqual(operatorsFor('checkbox').sort(), ['does_not_equal', 'equals'])
  })

  test('select 은 4개', () => {
    assert.deepEqual(operatorsFor('select').sort(), [
      'does_not_equal', 'equals', 'is_empty', 'is_not_empty',
    ])
  })

  test('number 는 8개', () => {
    assert.equal(operatorsFor('number').length, 8)
    assert.ok(operatorsFor('number').includes('greater_than_or_equal_to'))
  })

  test('date 는 상대 날짜를 뺀 7개', () => {
    assert.equal(operatorsFor('date').length, 7)
    // 상대 날짜는 평가 시점 의존이라 캐시 키가 쪼개진다(불변식 VW1) — 미룬다.
    assert.ok(!operatorsFor('date').includes('past_week'))
    assert.ok(!operatorsFor('date').includes('today'))
  })

  test('arity — is_empty 는 0, 나머지는 1', () => {
    assert.equal(operatorArity('number', 'is_empty'), 0)
    assert.equal(operatorArity('number', 'equals'), 1)
    assert.equal(operatorArity('checkbox', 'is_empty'), null)
  })
})

describe('★ 사용자 입력이 SQL 에 들어가지 않는다', () => {
  test('★ 값은 파라미터로만 간다', () => {
    const evil = "'; DROP TABLE block; --"
    const { sql, values } = compile({ property_id: 'pText', operator: 'contains', value: evil })
    assert.ok(sql !== null)
    assert.ok(!sql.includes('DROP'), `값이 SQL 에 박혔다: ${sql}`)
    assert.ok(!sql.includes(evil))
    assert.ok(values.includes(evil), '값이 바인딩되지 않았다')
  })

  test('★ property_id 도 파라미터다 — nanoid 라 안전해 보여도 예외를 두지 않는다', () => {
    const { sql, values } = compile({ property_id: 'pNum', operator: 'equals', value: 1 })
    assert.ok(sql !== null)
    assert.ok(!sql.includes('pNum'), `property_id 가 SQL 에 박혔다: ${sql}`)
    assert.ok(values.includes('pNum'))
  })

  test('★ 연산자 이름이 SQL 에 들어가지 않는다', () => {
    const { sql } = compile({ property_id: 'pNum', operator: 'greater_than', value: 1 })
    assert.ok(sql !== null)
    assert.ok(!sql.includes('greater_than'))
  })

  test('SQL 에 남는 것은 $n 과 알려진 리터럴뿐이다', () => {
    const { sql } = compile({ property_id: 'pText', operator: 'starts_with', value: 'x' })
    assert.ok(sql !== null)
    // `$` 플레이스홀더를 빼면 따옴표로 감싼 문자열 리터럴은 `'%'` 같은 것만 남는다.
    const literals = [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1])
    assert.deepEqual(literals, ['%'])
  })

  test('★ LIKE 에 들어가는 값은 % · _ · \\ 를 글자로 만들어 바인딩한다 — 같음 비교는 그대로', () => {
    const bs = String.fromCharCode(92)
    for (const operator of ['contains', 'does_not_contain', 'starts_with', 'ends_with']) {
      const { values } = compile({ property_id: 'pText', operator, value: `50%_${bs}` })
      assert.ok(values.includes(`50${bs}%${bs}_${bs}${bs}`), `${operator}: ${JSON.stringify(values)}`)
    }
    assert.ok(compile({ property_id: 'pText', operator: 'equals', value: '50%' }).values.includes('50%'), '= 는 와일드카드가 없다')
  })
})

describe('★ 부정 연산자는 NOT EXISTS 다', () => {
  for (const [type, op] of [
    ['pText', 'does_not_contain'],
    ['pText', 'does_not_equal'],
    ['pNum', 'does_not_equal'],
    ['pChk', 'does_not_equal'],
  ] as const) {
    test(`${TYPES.get(type)} ${op} → NOT EXISTS`, () => {
      const { sql } = compile({ property_id: type, operator: op, value: type === 'pChk' ? true : 1 })
      assert.ok(sql?.startsWith('NOT EXISTS'), `${sql}`)
    })
  }

  test('★ 내부 술어는 긍정이다 — 셀이 없는 행이 걸리게 하려면 그래야 한다', () => {
    const { sql } = compile({ property_id: 'pNum', operator: 'does_not_equal', value: 5 })
    assert.ok(sql !== null)
    // `<>` 가 아니라 `=` 가 들어 있어야 한다. `EXISTS(… <> 5)` 면 셀 없는 행이 빠진다.
    assert.ok(sql.includes('='), sql)
    assert.ok(!sql.includes('<>'), sql)
  })

  test('is_empty 도 NOT EXISTS 다', () => {
    const { sql } = compile({ property_id: 'pNum', operator: 'is_empty' })
    assert.ok(sql?.startsWith('NOT EXISTS'))
  })

  test('is_not_empty 는 EXISTS 다', () => {
    const { sql } = compile({ property_id: 'pNum', operator: 'is_not_empty' })
    assert.ok(sql?.startsWith('EXISTS'))
  })

  test('arity 0 은 값을 바인딩하지 않는다', () => {
    const { values } = compile({ property_id: 'pNum', operator: 'is_empty' })
    assert.deepEqual(values, ['pNum'])
  })
})

describe('사이드카 축', () => {
  const axisOf = (propertyId: string, operator: string, value?: unknown): string => {
    const { sql } = compile({ property_id: propertyId, operator, value })
    assert.ok(sql !== null)
    for (const col of ['num_value', 'text_value', 'date_start', 'bool_value']) {
      if (sql.includes(col)) return col
    }
    throw new Error(`사이드카 컬럼이 없다: ${sql}`)
  }

  test('타입마다 올바른 사이드카를 본다', () => {
    assert.equal(axisOf('pTitle', 'equals', 'a'), 'text_value')
    assert.equal(axisOf('pText', 'equals', 'a'), 'text_value')
    assert.equal(axisOf('pNum', 'equals', 1), 'num_value')
    assert.equal(axisOf('pChk', 'equals', true), 'bool_value')
    assert.equal(axisOf('pDate', 'equals', '2026-01-01'), 'date_start')
  })

  test('★ select 도 text_value 다 — 옵션 id 를 담기 때문이다', () => {
    assert.equal(axisOf('pSel', 'equals', 'opt_a'), 'text_value')
  })

  test('텍스트 비교는 양쪽에 lower() 를 건다 — 부분 인덱스와 같은 모양', () => {
    const { sql } = compile({ property_id: 'pText', operator: 'equals', value: 'A' })
    assert.ok(sql?.includes('lower(v.text_value)'), sql ?? '')
  })

  test('날짜 비교는 하루 단위다 — 사용자가 고른 것은 날짜이고 시각이 아니다', () => {
    const { sql } = compile({ property_id: 'pDate', operator: 'equals', value: '2026-03-01' })
    assert.ok(sql?.includes("date_trunc('day'"), sql ?? '')
  })
})

describe('그룹', () => {
  test('AND 로 묶는다', () => {
    const { sql } = compile({
      op: 'and',
      children: [
        { property_id: 'pNum', operator: 'greater_than', value: 1 },
        { property_id: 'pChk', operator: 'equals', value: true },
      ],
    })
    assert.ok(sql?.includes(' AND '), sql ?? '')
    assert.ok(sql?.startsWith('('))
  })

  test('OR 로 묶는다', () => {
    const { sql } = compile({
      op: 'or',
      children: [
        { property_id: 'pNum', operator: 'equals', value: 1 },
        { property_id: 'pNum', operator: 'equals', value: 2 },
      ],
    })
    assert.ok(sql?.includes(' OR '), sql ?? '')
  })

  test('중첩 그룹', () => {
    const { sql, values } = compile({
      op: 'and',
      children: [
        { property_id: 'pChk', operator: 'equals', value: true },
        {
          op: 'or',
          children: [
            { property_id: 'pNum', operator: 'equals', value: 1 },
            { property_id: 'pNum', operator: 'equals', value: 2 },
          ],
        },
      ],
    })
    assert.ok(sql?.includes(' AND '))
    assert.ok(sql?.includes(' OR '))
    assert.equal(values.length, 6) // (prop+value) × 3
  })

  test('항목이 하나면 괄호를 씌우지 않는다', () => {
    const { sql } = compile({
      op: 'and',
      children: [{ property_id: 'pNum', operator: 'equals', value: 1 }],
    })
    assert.ok(sql?.startsWith('EXISTS'), sql ?? '')
  })

  test('빈 그룹은 null — 호출자가 WHERE 에서 뺀다', () => {
    assert.equal(compile({ op: 'and', children: [] }).sql, null)
  })

  test('null 필터는 null', () => {
    assert.equal(compile(null).sql, null)
  })

  test('isGroup 이 리프와 그룹을 가른다', () => {
    assert.equal(isGroup({ op: 'and', children: [] }), true)
    assert.equal(isGroup({ property_id: 'p', operator: 'equals' }), false)
  })
})

describe('★ 지워진 프로퍼티 · 모르는 연산자는 무시한다', () => {
  test('★ 없는 프로퍼티를 참조하는 규칙은 건너뛴다 — 0건이면 데이터 소실로 오인된다', () => {
    assert.equal(compile({ property_id: '없는id', operator: 'equals', value: 1 }).sql, null)
  })

  test('MVP 밖 타입(formula)도 건너뛴다', () => {
    assert.equal(compile({ property_id: 'pFormula', operator: 'equals', value: 1 }).sql, null)
  })

  test('모르는 연산자도 건너뛴다 — 카탈로그를 줄이는 날 기존 뷰가 열려야 한다', () => {
    assert.equal(compile({ property_id: 'pNum', operator: 'past_week' }).sql, null)
  })

  test('★ 무시된 규칙이 AND 그룹을 0건으로 만들지 않는다', () => {
    const { sql } = compile({
      op: 'and',
      children: [
        { property_id: '없는id', operator: 'equals', value: 1 },
        { property_id: 'pNum', operator: 'equals', value: 7 },
      ],
    })
    // 남은 하나만 컴파일된다.
    assert.ok(sql?.startsWith('EXISTS'), sql ?? '')
  })

  test('무시된 규칙은 파라미터도 쓰지 않는다 — $n 번호가 어긋나면 안 된다', () => {
    const { values } = compile({
      op: 'and',
      children: [
        { property_id: '없는id', operator: 'equals', value: 'X' },
        { property_id: 'pNum', operator: 'equals', value: 7 },
      ],
    })
    assert.deepEqual(values, ['pNum', 7])
  })
})

describe('validateFilter — 쓰기 경로', () => {
  const ok = (node: unknown) => validateFilter(node, TYPES).length === 0

  test('정상 리프·그룹은 통과', () => {
    assert.ok(ok({ property_id: 'pNum', operator: 'equals', value: 1 }))
    assert.ok(ok({ op: 'and', children: [{ property_id: 'pNum', operator: 'is_empty' }] }))
  })

  test('★ 쓰기에서는 없는 프로퍼티를 거부한다 — 새로 만들 이유가 없다', () => {
    assert.equal(ok({ property_id: '없는id', operator: 'equals', value: 1 }), false)
  })

  test('타입에 없는 연산자는 거부', () => {
    assert.equal(ok({ property_id: 'pChk', operator: 'is_empty' }), false)
    assert.equal(ok({ property_id: 'pNum', operator: 'starts_with', value: 'a' }), false)
  })

  test('arity 1 인데 값이 없으면 거부', () => {
    assert.equal(ok({ property_id: 'pNum', operator: 'equals' }), false)
    assert.equal(ok({ property_id: 'pNum', operator: 'equals', value: null }), false)
  })

  test('★ 깊이 상한', () => {
    const nest = (depth: number): FilterNode =>
      depth === 0
        ? { property_id: 'pNum', operator: 'is_empty' }
        : { op: 'and', children: [nest(depth - 1)] }
    // 루트를 layer 1 로 센다 <C-15>.
    assert.ok(ok(nest(MAX_FILTER_DEPTH - 1)))
    assert.equal(ok(nest(MAX_FILTER_DEPTH)), false)
  })

  test('항목 수 상한', () => {
    const many = Array.from({ length: MAX_FILTER_GROUP_ITEMS + 1 }, () => ({
      property_id: 'pNum',
      operator: 'is_empty',
    }))
    assert.equal(ok({ op: 'and', children: many }), false)
  })

  test('모양이 아닌 것은 거부', () => {
    for (const bad of [null, 42, 'x', [], { op: 'xor', children: [] }]) {
      assert.equal(ok(bad), false, JSON.stringify(bad))
    }
  })

  test('오류 경로가 어느 규칙인지 알려준다', () => {
    const issues = validateFilter(
      { op: 'and', children: [{ property_id: 'pNum', operator: 'nope' }] },
      TYPES,
    )
    assert.equal(issues.length, 1)
    assert.equal(issues[0].path, 'filter.children[0].operator')
  })
})

describe('validateSorts', () => {
  const ok = (sorts: unknown) => validateSorts(sorts, TYPES).length === 0

  test('정상 정렬은 통과', () => {
    assert.ok(ok([{ property_id: 'pNum', direction: 'asc' }]))
  })

  test('상한을 넘으면 거부', () => {
    const many = Array.from({ length: MAX_SORT_KEYS + 1 }, (_, i) => ({
      property_id: ['pNum', 'pText', 'pChk', 'pDate'][i],
      direction: 'asc',
    }))
    assert.equal(ok(many), false)
  })

  test('★ 같은 프로퍼티로 두 번 정렬하면 거부 — 조용히 무시하면 먹은 줄 안다', () => {
    assert.equal(
      ok([
        { property_id: 'pNum', direction: 'asc' },
        { property_id: 'pNum', direction: 'desc' },
      ]),
      false,
    )
  })

  test('없는 프로퍼티 · 모르는 방향은 거부', () => {
    assert.equal(ok([{ property_id: '없는id', direction: 'asc' }]), false)
    assert.equal(ok([{ property_id: 'pNum', direction: 'sideways' }]), false)
  })

  test('배열이 아니면 거부', () => {
    assert.equal(ok({}), false)
  })
})

describe('compileSorts', () => {
  const sortOf = (sorts: { property_id: string; direction: 'asc' | 'desc' }[]) => {
    const params = new ParamBag(1)
    return { ...compileSorts(sorts, TYPES, params), values: params.values }
  }

  test('★ 타이브레이커가 항상 붙는다 — 없으면 커서가 행을 건너뛴다', () => {
    const { orderBy } = sortOf([])
    assert.equal(orderBy, 'b.order_key COLLATE "C" ASC')
  })

  test('★ NULLS LAST 로 고정한다 — 빈 칸이 위에 쌓이면 안 된다', () => {
    const { orderBy } = sortOf([{ property_id: 'pNum', direction: 'desc' }])
    assert.ok(orderBy.includes('DESC NULLS LAST'), orderBy)
  })

  test('정렬 키 뒤에 타이브레이커가 온다', () => {
    const { orderBy } = sortOf([{ property_id: 'pNum', direction: 'asc' }])
    assert.ok(orderBy.endsWith('b.order_key COLLATE "C" ASC'), orderBy)
  })

  test('정렬 값은 상관 서브쿼리로 꺼낸다 (EAV)', () => {
    const { orderBy, values } = sortOf([{ property_id: 'pNum', direction: 'asc' }])
    assert.ok(orderBy.includes('FROM page_property_value sv'), orderBy)
    assert.deepEqual(values, ['pNum'])
  })

  test('지워진 프로퍼티로 정렬하면 그 키만 빠진다', () => {
    const { keys } = sortOf([
      { property_id: '없는id', direction: 'asc' },
      { property_id: 'pNum', direction: 'asc' },
    ])
    assert.equal(keys.length, 1)
  })
})

describe('★ compileCursor', () => {
  const cursorOf = (
    sorts: { property_id: string; direction: 'asc' | 'desc' }[],
    values: unknown[],
  ) => {
    const params = new ParamBag(1)
    const compiled = compileSorts(sorts, TYPES, params)
    const sql = compileCursor(compiled, values, params)
    return { sql, values: params.values }
  }

  test('정렬 없이 order_key 만으로 나아간다', () => {
    const { sql } = cursorOf([], ['a5'])
    assert.ok(sql !== null)
    assert.ok(sql.includes('b.order_key'), sql)
  })

  test('★ NULL 비교에 IS NOT DISTINCT FROM 을 쓴다 — `=` 면 빈 칸 행이 사라진다', () => {
    const { sql } = cursorOf([{ property_id: 'pNum', direction: 'asc' }], [null, 'a5'])
    assert.ok(sql !== null)
    assert.ok(sql.includes('IS NOT DISTINCT FROM'), sql)
  })

  test('★ 커서 값이 NULL 이면 그 키로는 더 뒤가 없다 (NULLS LAST)', () => {
    const { sql } = cursorOf([{ property_id: 'pNum', direction: 'asc' }], [null, 'a5'])
    assert.ok(sql !== null)
    // `$n IS NOT NULL AND …` 가드가 있어야 한다.
    // 캐스트가 붙는다(`$n::numeric`) — 없으면 Postgres 가 파라미터 타입을 못 정한다.
    assert.ok(/\$\d+::\w+ IS NOT NULL AND/.test(sql), sql)
  })

  test('방향에 따라 비교 연산자가 바뀐다', () => {
    const asc = cursorOf([{ property_id: 'pNum', direction: 'asc' }], [1, 'a5']).sql ?? ''
    const desc = cursorOf([{ property_id: 'pNum', direction: 'desc' }], [1, 'a5']).sql ?? ''
    assert.ok(asc.includes(' > '), asc)
    assert.ok(desc.includes(' < '), desc)
  })

  test('정렬 키마다 가드가 하나, 타이브레이커가 하나 붙는다', () => {
    // ⚠ `' OR '` 을 세는 것으로는 확인할 수 없다 — 각 키의 "뒤" 판정 자체가
    //   `(k IS NULL OR k > $n)` 라서 내부에 OR 을 갖는다. 처음에 그렇게 셌다가
    //   5 를 받았고, 코드가 아니라 세는 방법이 틀렸다.
    const { sql } = cursorOf(
      [
        { property_id: 'pNum', direction: 'asc' },
        { property_id: 'pText', direction: 'desc' },
      ],
      [1, 'x', 'a5'],
    )
    assert.ok(sql !== null)
    // 키마다 `$n IS NOT NULL AND` 가드가 하나씩.
    assert.equal([...sql.matchAll(/\$\d+::\w+ IS NOT NULL AND/g)].length, 2, sql)
    // 타이브레이커는 한 번만.
    assert.equal([...sql.matchAll(/b\.order_key/g)].length, 1, sql)
    // 둘째 절에는 첫째 키의 동등 비교가 선행한다.
    assert.ok(sql.includes('IS NOT DISTINCT FROM'), sql)
  })

  test('★ 길이가 안 맞는 커서는 null — 정렬 구성이 바뀐 것이다', () => {
    assert.equal(cursorOf([{ property_id: 'pNum', direction: 'asc' }], ['a5']).sql, null)
    assert.equal(cursorOf([], ['a5', 'extra']).sql, null)
  })
})

describe('⑥ "나"(6g-2c)', () => {
  const ME = '11111111-2222-4333-8444-555555555555'
  const OTHER = '99999999-8888-4777-8666-555555555555'

  test('★ 컨텍스트 노드는 보는 사람으로 묶인다 — 값에 노드가 아니라 그 사람 id 가 간다', () => {
    const { sql, values } = compile({ property_id: 'pPeople', operator: 'contains', value: ME_NODE }, ME)
    assert.match(sql ?? '', /@>/)
    assert.deepEqual(values, ['pPeople', ME])
  })

  test('보는 사람이 없으면(공개 화면) 아무도 아니다 — 어떤 칸에도 없는 id · 사람 id 값은 그대로', () => {
    assert.deepEqual(compile({ property_id: 'pPeople', operator: 'contains', value: ME_NODE }).values, ['pPeople', '00000000-0000-0000-0000-000000000000'])
    assert.deepEqual(compile({ property_id: 'pPeople', operator: 'contains', value: OTHER }, ME).values, ['pPeople', OTHER])
  })

  test('사람이 아닌 타입의 값에 노드가 있어도 묶지 않는다(사람만의 것)', () => {
    assert.deepEqual(compile({ property_id: 'pText', operator: 'contains', value: ME_NODE }, ME).values.at(-1), '[object Object]')
  })

  test('★ 저장 검증 — 사람 값은 uuid 또는 노드만', () => {
    const leaf = (value: unknown) => ({ property_id: 'pPeople', operator: 'contains', value })
    assert.deepEqual(validateFilter(leaf(ME_NODE), TYPES), [])
    assert.deepEqual(validateFilter(leaf(ME), TYPES), [])
    for (const bad of ['me', 'not-a-uuid', { $context: 'current_page' }, { $context: 'me', extra: 1 }, 7]) {
      assert.equal(validateFilter(leaf(bad), TYPES).length, 1, JSON.stringify(bad))
    }
    assert.equal(isMeNode({ $context: 'me' }), true)
    assert.equal(isMeNode(['me']), false)
  })
})

describe('status 의 그룹 단위 (10n-23)', () => {
  const STATUS = new Map<string, string>([...TYPES, ['pStatus', 'status']])
  const compileStatus = (node: FilterNode) => {
    const params = new ParamBag(1)
    return { sql: compileFilter(node, STATUS, params, NO_VIEWER), values: params.values }
  }

  test('status 는 select 의 넷 + 그룹 둘 · select 에는 그룹이 없다', () => {
    assert.deepEqual(operatorsFor('status').sort(), ['does_not_equal', 'equals', 'group_is', 'group_is_not', 'is_empty', 'is_not_empty'])
    assert.ok(!operatorsFor('select').includes('group_is'))
    assert.equal(operatorArity('status', 'group_is'), 1)
  })

  test('★ 쓰기 경로 — 값은 그룹이어야 한다(옵션 id · 모르는 말은 거부)', () => {
    assert.deepEqual(validateFilter({ property_id: 'pStatus', operator: 'group_is', value: 'complete' }, STATUS), [])
    assert.deepEqual(validateFilter({ property_id: 'pStatus', operator: 'group_is_not', value: 'todo' }, STATUS), [])
    for (const value of ['done', '00000000-0000-4000-8000-000000000000', 1, ''] as const) {
      assert.equal(validateFilter({ property_id: 'pStatus', operator: 'group_is', value }, STATUS).length, 1, `값 ${String(value)}`)
    }
    assert.equal(validateFilter({ property_id: 'pSel', operator: 'group_is', value: 'todo' }, STATUS).length, 1, 'select 에는 없는 연산자')
    // 옵션 연산자는 그대로 옵션 id 를 받는다
    assert.deepEqual(validateFilter({ property_id: 'pStatus', operator: 'equals', value: 'opt-1' }, STATUS), [])
  })

  test('★ group_is 는 EXISTS · group_is_not 은 NOT EXISTS(빈 셀도 "그 그룹이 아니다")', () => {
    assert.ok(compileStatus({ property_id: 'pStatus', operator: 'group_is', value: 'complete' }).sql?.startsWith('EXISTS'))
    assert.ok(compileStatus({ property_id: 'pStatus', operator: 'group_is_not', value: 'complete' }).sql?.startsWith('NOT EXISTS'))
  })

  test('★ 값은 바인딩한다 · 그룹은 글자로 견준다(ENUM 캐스트 없음 — 모르는 값이 와도 예외가 아니다)', () => {
    const { sql, values } = compileStatus({ property_id: 'pStatus', operator: 'group_is', value: "x' OR 1=1 --" })
    assert.ok(sql !== null && !sql.includes('OR 1=1'), `${sql}`)
    assert.deepEqual(values, ['pStatus', "x' OR 1=1 --"])
    assert.ok(sql.includes('g.kind::text = $2') && !sql.includes('::status_group_kind'), sql)
  })
})
