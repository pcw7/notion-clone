#!/usr/bin/env node
/**
 * 전체 e2e 판을 복사본에서 — 머지된 main 을 따로 빌드해 따로 DB · 다른 포트로 돈다 (e2e 도구 2조각 · 순수 부분은 `src/lib/testing/e2e-report.ts`)
 *
 *   npm run e2e:full                      # origin/main 을 받아 복사본에서 빌드하고 전체 판 · 새 실패의 게이트는 한 번 더(홀로)
 *   npm run e2e:full -- --ref=<커밋>       # 다른 커밋(예: 머지 전 브랜치의 HEAD — 커밋된 것만 돈다)
 *
 * 왜 — 전체 판(약 1900개 · 30~40분)이 작업 트리에서 돌면 그동안 빌드도 다른 판도 못 한다(서버가 `.next` 를 읽고 있다). 2026-10-18
 * 사용자와 정한 대로 전체 판은 4조각마다 **머지한 뒤** 이것으로 뒤에서 돌리고 그동안 다음 조각을 한다(HANDOFF §4). 실패는 다음 조각이 고친다.
 *
 * 무엇을 따로 두는가 — 함께 돌아도 서로의 판을 흔들지 않게.
 *   - 복사본: 이 저장소의 git worktree(`E2E_FULL_DIR` · 기본은 옆 폴더 `<저장소>-full`) — 그 커밋에 detached 로 선다.
 *     node_modules 는 복사본 자기 것(잠금 파일이 바뀌었을 때만 `npm ci`) · `.next` 도 자기 것
 *   - DB: 같은 Postgres 의 다른 DB(`E2E_FULL_DB` · 기본 `<DB>_e2e`) — **판마다 지우고 새로 만든다**(확장은 원래 DB 와 같게 ·
 *     정렬 로캘이 원래 DB 와 같은지 확인 · 마이그레이션은 그 커밋의 것). 원래 DB 를 같이 쓰면 DB 전체를 훑는 검사(perf_event 등)가
 *     다른 판의 행을 본다
 *   - Valkey: 같은 서버의 다른 번호(`E2E_FULL_REDIS_DB` · 기본 1)
 *   - 포트: 3200 · 3201 · 3202(`E2E_FULL_PORT` 가 첫 번호) — 작업 트리의 판은 3100 대
 *
 * 로그는 복사본의 `.e2e-full/` 에 남는다. 끝에 e2e 의 끝 줄(느린 절 · 알려진 실패 · 새 실패 · 다시 돌리기 · `N / M 통과`)을 옮기고,
 * 새 실패가 있으면 그 게이트만 같은 빌드 · 같은 DB 로 한 번 더 돌려 홀로도 떨어지는지 적는다. 종료 코드는 첫 판의 새 실패만 본다.
 *
 * ⚠ DB 를 지우고 만드는 일이라 이름을 확인한다 — 원래 DB 와 같은 이름이면 멈춘다. `npm run db:up` 이 먼저다.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import pg from 'pg'

const { databaseOf, formatSeconds, parseDotEnv, parseRunSummary, withDatabase, withRedisDb } = await import('../src/lib/testing/e2e-report.ts')

const ROOT = resolve(import.meta.dirname, '..')
const DIR = resolve(process.env.E2E_FULL_DIR ?? join(ROOT, '..', `${basename(ROOT)}-full`))
const LOGS = join(DIR, '.e2e-full')
const args = process.argv.slice(2)
const ref = args.find((a) => a.startsWith('--ref='))?.slice('--ref='.length) ?? 'origin/main'
const PORT = Number(process.env.E2E_FULL_PORT ?? 3200)
const BROWSER = process.env.E2E_BROWSER ?? (existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined)

const startedAt = Date.now()
const clock = () => new Date().toTimeString().slice(0, 5)
const say = (line) => console.log(`[e2e:full ${clock()}] ${line}`)
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
function fail(line, code = 2) {
  console.error(`\n[e2e:full] 멈춤 — ${line}`)
  process.exit(code)
}

/** 자식 프로세스의 출력을 로그 파일로 — 끝나면 종료 코드. 셸로 돌릴 것(Windows 의 npm)은 명령 한 줄로 받는다(인자 배열 + 셸은 Node 24 가 막는다). */
function runLogged(cmd, cmdArgs, { cwd, env, log }) {
  return new Promise((done) => {
    const out = createWriteStream(log, { flags: 'a' })
    const child = cmdArgs === null ? spawn(cmd, { cwd, env, shell: true, windowsHide: true }) : spawn(cmd, cmdArgs, { cwd, env, windowsHide: true })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('close', (code) => out.end(() => done(code ?? 1)))
  })
}
const tail = (file, n) => readFileSync(file, 'utf8').split('\n').slice(-n).join('\n')

// ── 0. 같은 복사본에서 두 판이 겹치지 않게 — 복사본을 건드리기 전에 본다(도는 판의 빌드를 checkout 이 덮는다) ──
const LOCK = join(LOGS, 'running.pid')
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8'))
  let alive = false
  try {
    process.kill(pid, 0)
    alive = true
  } catch {
    /* 끝난 판의 흔적 */
  }
  if (alive) fail(`복사본에서 전체 판이 이미 돈다(pid ${pid}) — ${DIR}`)
}

// ── 1. 복사본 — 이 저장소의 worktree 를 그 커밋에 ──
if (ref.startsWith('origin/')) git(ROOT, 'fetch', '-q', 'origin')
const sha = git(ROOT, 'rev-parse', '--verify', `${ref}^{commit}`)
const subject = git(ROOT, 'log', '-1', '--format=%s', sha)
if (!existsSync(DIR)) {
  git(ROOT, 'worktree', 'prune') // 지운 복사본의 등록이 남아 있으면 add 가 거부한다
  git(ROOT, 'worktree', 'add', '-q', '--detach', DIR, sha)
  say(`복사본을 만들었다 — ${DIR}`)
} else {
  if (!existsSync(join(DIR, '.git'))) fail(`${DIR} 가 이 저장소의 worktree 가 아니다 — 지우거나 E2E_FULL_DIR 로 다른 곳을 고른다`)
  const common = (cwd) => realpathSync(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
  if (common(DIR) !== common(ROOT)) fail(`${DIR} 는 다른 저장소의 것이다 — E2E_FULL_DIR 로 다른 곳을 고른다`)
  git(DIR, 'checkout', '-q', '--detach', '--force', sha)
}
mkdirSync(LOGS, { recursive: true })
writeFileSync(LOCK, String(process.pid))
process.on('exit', () => rmSync(LOCK, { force: true }))
say(`커밋 ${sha.slice(0, 7)} — ${subject}`)
const now = new Date()
const p2 = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}-${sha.slice(0, 7)}`

// ── 2. 의존성 — 잠금 파일이 바뀌었을 때만 ──
const lockHash = createHash('sha256').update(readFileSync(join(DIR, 'package-lock.json'))).digest('hex')
const lockStamp = join(DIR, 'node_modules', '.e2e-full-lock')
if (!existsSync(lockStamp) || readFileSync(lockStamp, 'utf8') !== lockHash) {
  say('npm ci — 잠금 파일이 바뀌었거나 처음이다')
  const log = join(LOGS, `${stamp}-install.log`)
  if ((await runLogged('npm ci --no-audit --no-fund', null, { cwd: DIR, env: process.env, log })) !== 0) fail(`npm ci 실패\n${tail(log, 30)}`)
  writeFileSync(lockStamp, lockHash)
}

// ── 3. 환경 — .env 는 작업 트리의 것 · DB · Valkey · 포트만 바꾼다(이미 있는 환경 변수가 .env 를 이긴다) ──
copyFileSync(join(ROOT, '.env'), join(DIR, '.env'))
const dotenv = parseDotEnv(readFileSync(join(ROOT, '.env'), 'utf8'))
const mainDbUrl = process.env.DATABASE_URL ?? dotenv.DATABASE_URL
if (!mainDbUrl) fail('.env 에 DATABASE_URL 이 없다')
const mainDb = databaseOf(mainDbUrl)
const e2eDb = process.env.E2E_FULL_DB ?? `${mainDb}_e2e`
if (e2eDb === mainDb) fail(`복사본 판의 DB 가 원래 DB 와 같다(${e2eDb}) — 지우는 판이라 멈춘다`)
const e2eDbUrl = withDatabase(mainDbUrl, e2eDb)
const env = {
  ...process.env,
  DATABASE_URL: e2eDbUrl,
  REDIS_URL: withRedisDb(process.env.REDIS_URL ?? dotenv.REDIS_URL ?? 'redis://localhost:6379', Number(process.env.E2E_FULL_REDIS_DB ?? 1)),
  E2E_PORT: String(PORT),
  E2E_COLLAB_PORT: String(PORT + 1),
  E2E_HOOK_PORT: String(PORT + 2),
  ...(BROWSER ? { E2E_BROWSER: BROWSER } : {}),
}

// ── 4. DB — 지우고 새로 · 확장과 로캘은 원래 DB 와 같게 · 마이그레이션 ──
{
  const admin = new pg.Client({ connectionString: mainDbUrl })
  try {
    await admin.connect()
  } catch (e) {
    fail(`DB 에 닿지 못했다(${e.code ?? e.message}) — npm run db:up 이 먼저다`)
  }
  const locale = async (client, name) =>
    (await client.query(`SELECT to_jsonb(d) AS row FROM pg_database d WHERE datname = $1`, [name])).rows[0]?.row
  const extensions = (await admin.query(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`)).rows.map((r) => r.extname)
  await admin.query(`DROP DATABASE IF EXISTS ${e2eDb} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${e2eDb}`)
  const [want, got] = [await locale(admin, mainDb), await locale(admin, e2eDb)]
  const loc = (row) => `${row?.datlocprovider}:${row?.daticulocale ?? row?.datlocale ?? row?.datcollate}`
  if (loc(want) !== loc(got)) fail(`새 DB 의 정렬 로캘(${loc(got)})이 원래 DB(${loc(want)})와 다르다 — 한국어 정렬 검사가 흔들린다`)
  await admin.end()
  const fresh = new pg.Client({ connectionString: e2eDbUrl })
  await fresh.connect()
  for (const ext of extensions) await fresh.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`)
  await fresh.end()
  const log = join(LOGS, `${stamp}-migrate.log`)
  if ((await runLogged(process.execPath, ['scripts/migrate.mjs'], { cwd: DIR, env, log })) !== 0) fail(`마이그레이션 실패\n${tail(log, 30)}`)
  say(`DB ${e2eDb} 를 새로 만들었다 — 확장 ${extensions.length}개 · 로캘 ${loc(got)} · 마이그레이션`)
}

// ── 5. 빌드 ──
{
  const t = Date.now()
  const log = join(LOGS, `${stamp}-build.log`)
  if ((await runLogged(process.execPath, [join('node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { cwd: DIR, env, log })) !== 0) fail(`빌드 실패\n${tail(log, 40)}`)
  say(`빌드 ${formatSeconds(Date.now() - t)}`)
}

// ── 6. 전체 판 · 새 실패의 게이트는 한 번 더 ──
const E2E = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/e2e-editor.mjs']
/** e2e 의 끝 줄 — "느린 절 열둘" 부터 끝까지 */
const ending = (file) => {
  const text = readFileSync(file, 'utf8')
  const at = text.lastIndexOf('\n느린 절 열둘')
  return (at >= 0 ? text.slice(at + 1) : tail(file, 20)).trimEnd()
}
const runLog = join(LOGS, `${stamp}-e2e.log`)
say(`전체 판 시작 — 포트 ${PORT} · DB ${e2eDb} · 로그 ${runLog}`)
let t = Date.now()
await runLogged(process.execPath, E2E, { cwd: DIR, env, log: runLog })
const first = parseRunSummary(readFileSync(runLog, 'utf8'))
if (first === null) fail(`판이 끝 줄 없이 끝났다(실행 실패) — 로그 꼬리:\n${tail(runLog, 30)}`, 1)
say(`전체 판 끝 — ${formatSeconds(Date.now() - t)}`)
console.log(`\n${ending(runLog)}\n`)

let again = null
if (first.rerun !== null) {
  const rerunLog = join(LOGS, `${stamp}-rerun.log`)
  say(`새 실패의 게이트만 한 번 더(홀로 · 같은 빌드 · 같은 DB) — E2E_ONLY="${first.rerun}"`)
  t = Date.now()
  await runLogged(process.execPath, E2E, { cwd: DIR, env: { ...env, E2E_ONLY: first.rerun }, log: rerunLog })
  again = parseRunSummary(readFileSync(rerunLog, 'utf8'))
  say(`다시 돈 판 끝 — ${formatSeconds(Date.now() - t)} · 로그 ${rerunLog}`)
  console.log(`\n${ending(rerunLog)}\n`)
}

const fresh = first.fresh ?? first.total - first.passed
console.log(
  `전체 판 ${sha.slice(0, 7)}: ${first.passed} / ${first.total} 통과 · 새 실패 ${fresh} · 알려진 실패 ${first.known ?? '?'}` +
    (again === null ? '' : ` · 새 실패의 게이트를 홀로 다시: ${again.passed} / ${again.total} 통과(새 실패 ${again.fresh ?? again.total - again.passed})`) +
    ` · 걸린 시간 ${formatSeconds(Date.now() - startedAt)}`,
)
process.exit(fresh === 0 ? 0 : 1)
