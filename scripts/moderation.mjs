#!/usr/bin/env node
/**
 * 모더레이션 — 운영자 명령 (게시 · 공유 6b-2 · F-17-09)
 *
 *   npm run moderation -- list [open|all]
 *   npm run moderation -- show <caseId>
 *   npm run moderation -- takedown <pageId> --reason <phishing|malware|illegal|harassment|copyright|spam|other> --by <이름> [--note <메모>]
 *   npm run moderation -- dismiss <caseId> --by <이름> [--note <메모>]
 *   npm run moderation -- reinstate <pageId> --by <이름> [--note <메모>]
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 모더레이션 조치 — 운영자는 워크스페이스의 주체가 아니다. 이 명령은 서버 셸에서만
 * 돈다(HTTP 로 열지 않는다). 조치는 `moderation_action` 에 쌓이고, 누가 했는지는 `--by` 의 이름으로 남는다. 판정 · 쓰기는
 * `src/lib/moderation/operator.ts` 가 한다 — 이 스크립트는 인자를 읽어 부를 뿐이다.
 */

import { existsSync, readFileSync } from 'node:fs'

/** .env 를 아주 단순하게 읽는다(`set-plan.mjs` 와 같다). 이미 있는 환경 변수가 이긴다. */
function loadEnv(file = '.env') {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

for (const [key, value] of Object.entries(loadEnv())) process.env[key] ??= value

const { dismissCase, listCases, readCase, reinstatePage, takeDownPage, TAKEDOWN_REASONS } = await import('../src/lib/moderation/operator.ts')
const { closePool } = await import('../src/lib/db/pool.ts')

const USAGE = `쓰는 법:
  npm run moderation -- list [open|all]
  npm run moderation -- show <caseId>
  npm run moderation -- takedown <pageId> --reason <${TAKEDOWN_REASONS.join('|')}> --by <이름> [--note <메모>]
  npm run moderation -- dismiss <caseId> --by <이름> [--note <메모>]
  npm run moderation -- reinstate <pageId> --by <이름> [--note <메모>]`

/** `--key value` 를 읽는다. 위치 인자는 순서대로. */
function parse(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = argv[i + 1] ?? ''
      i += 1
    } else positional.push(arg)
  }
  return { positional, flags }
}

const FAILURE = {
  not_found: '그런 페이지 · 케이스가 없다.',
  invalid_input: `값이 틀렸다 — --by 는 1~100자 · --note 는 2000자까지 · --reason 은 ${TAKEDOWN_REASONS.join(' · ')}.`,
  already: '이미 내려져 있다.',
  not_open: '열린 케이스가 아니다.',
  not_moderated: '내려져 있지 않다.',
}

function report(result, done) {
  if (result.ok) console.log(`${done} (조치 ${result.value.actionId})`)
  else {
    console.error(FAILURE[result.reason] ?? result.reason)
    process.exitCode = 1
  }
}

const { positional, flags } = parse(process.argv.slice(2))
const [command, target] = positional

try {
  switch (command) {
    case 'list': {
      const cases = await listCases(target === 'all' ? 'all' : 'open')
      if (cases.length === 0) console.log('케이스가 없다.')
      for (const c of cases) {
        console.log(`${c.id}  ${c.state.padEnd(12)}  신고 ${String(c.reportCount).padStart(3)}  처음 ${c.firstReportedAt}  페이지 ${c.targetId}`)
      }
      break
    }
    case 'show': {
      const c = await readCase(target ?? '')
      if (c === null) {
        console.error(FAILURE.not_found)
        process.exitCode = 1
        break
      }
      console.log(`케이스 ${c.id} — ${c.state} · 신고 ${c.reportCount}건 · 페이지 ${c.targetId}(${c.pageState ?? '파기됨'}) · 워크스페이스 ${c.workspaceId}`)
      for (const r of c.reports) {
        console.log(`  신고 ${r.createdAt}  ${r.reason}  지문 ${r.reporter ?? '-'}  루트 ${r.viaRootId ?? '-'}  제목 "${r.snapshotTitle ?? ''}"`)
        if (r.detail !== '') console.log(`    ${r.detail.replace(/\s+/g, ' ').slice(0, 300)}`)
      }
      for (const a of c.actions) console.log(`  조치 ${a.createdAt}  ${a.action}${a.reasonCode ? `(${a.reasonCode})` : ''}  ${a.actor}  ${a.note}`)
      break
    }
    case 'takedown':
      report(await takeDownPage(target ?? '', flags.reason, { actor: flags.by ?? '', note: flags.note }), '내렸다 — 공개 경로가 그 페이지와 그 아래를 닫는다.')
      break
    case 'dismiss':
      report(await dismissCase(target ?? '', { actor: flags.by ?? '', note: flags.note }), '기각했다.')
      break
    case 'reinstate':
      report(await reinstatePage(target ?? '', { actor: flags.by ?? '', note: flags.note }), '되살렸다 — 게시되어 있으면 다시 열린다.')
      break
    default:
      console.error(USAGE)
      process.exitCode = 2
  }
} finally {
  await closePool()
}
