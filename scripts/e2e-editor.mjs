#!/usr/bin/env node
/**
 * 에디터 실제 브라우저 검증 — `npm run e2e`
 *
 * 헤드리스 테스트(`node --test`)는 ProseMirror 의 모델·커맨드·계획을 검증하지만
 * **브라우저가 하는 일은 못 본다** — DOM 이 없고 MutationObserver 도 없다.
 * 이 스크립트가 없던 동안 브라우저에서만 드러나는 버그 넷이 헤드리스 테스트를
 * 전부 통과한 채 들어가 있었다(#30, 이 스크립트의 첫 실행에서 잡았다):
 *
 *   - 토글을 접어도 자식이 숨겨지지 않았다(W4 부터)
 *   - 접힌 토글을 블록 선택하면 선택이 풀렸다(#27)
 *   - 블록을 다른 블록의 첫 자식으로 옮기면 저장이 UNIQUE 위반으로 실패했다
 *   - Tab 이 하위 페이지 참조 밑으로 들여써서 저장이 거부됐다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 의존성이 없다
 * ──────────────────────────────────────────────────────────────────────
 *
 * Playwright 같은 도구를 넣지 않는다. 이미 깔려 있는 Chromium 계열 브라우저
 * (Edge·Chrome)를 헤드리스로 띄우고, Node 에 내장된 `WebSocket` 으로 Chrome
 * DevTools Protocol 을 직접 부른다. 포인터·키 이벤트는 `Input.dispatch*` 로 보내므로
 * 브라우저 입장에서는 **진짜 입력**이다 — `setPointerCapture` 도 동작한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쓰는 법
 * ──────────────────────────────────────────────────────────────────────
 *
 *   npm run db:up        # DB 가 떠 있어야 한다
 *   npm run build        # 프로덕션 빌드를 검증한다(HANDOFF §6 — next dev 는 믿지 않는다)
 *   npm run e2e
 *
 * 서버는 이 스크립트가 직접 띄운다(기본 포트 3100 — 개발 서버 3000 과 겹치지 않게).
 * 로그인 코드는 콘솔 메일러(`MAIL_TRANSPORT=console`)가 찍은 것을 서버 출력에서
 * 읽는다. 매 실행마다 새 계정·워크스페이스를 만든다.
 *
 * 환경 변수: `E2E_BROWSER`(브라우저 실행 파일 경로), `E2E_PORT`(서버 포트),
 * `E2E_HEADFUL=1`(창을 띄워서 본다).
 *
 * CI 에서는 돌리지 않는다(아직). 러너에 브라우저가 있어도, 이 검증이 안정적으로
 * 초록인지 로컬에서 먼저 쌓아 본 뒤에 넣는다 — 깜빡이는 CI 는 없는 CI 보다 나쁘다.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { textRun } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE = `http://localhost:${PORT}`
const HEADFUL = process.env.E2E_HEADFUL === '1'

// ── 결과 ──────────────────────────────────────────────────────────────

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  o' : '  X'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}
function section(title) {
  console.log(`\n[${title}]`)
}

// ── 브라우저 찾기 ─────────────────────────────────────────────────────

function findBrowser() {
  if (process.env.E2E_BROWSER) return process.env.E2E_BROWSER
  const env = process.env
  const candidates =
    process.platform === 'win32'
      ? [
          join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap(
            (name) => (env.PATH ?? '').split(delimiter).map((dir) => join(dir, name)),
          )
  return candidates.find((path) => path && existsSync(path)) ?? null
}

// ── 서버 ──────────────────────────────────────────────────────────────

let serverOutput = ''

function startServer() {
  if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
    throw new Error('프로덕션 빌드가 없다. `npm run build` 를 먼저 돌려라.')
  }
  const server = spawn(
    process.execPath,
    [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)],
    { cwd: ROOT, env: { ...process.env, MAIL_TRANSPORT: 'console' }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const collect = (chunk) => {
    serverOutput += chunk.toString('utf8')
  }
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)
  return server
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      await fetch(BASE)
      return
    } catch {
      await sleep(200)
    }
  }
  throw new Error(`서버가 ${BASE} 에서 뜨지 않았다\n${serverOutput}`)
}

/** 콘솔 메일러가 찍은 로그인 코드. */
async function loginCodeFor(email) {
  for (let i = 0; i < 100; i += 1) {
    const at = serverOutput.lastIndexOf(email)
    const code = at >= 0 ? serverOutput.slice(at).match(/코드\s*:\s*(\d{6})/)?.[1] : undefined
    if (code) return code
    await sleep(100)
  }
  throw new Error('서버 출력에서 로그인 코드를 찾지 못했다')
}

// ── CDP ───────────────────────────────────────────────────────────────

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  const pageErrors = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      pageErrors.push(d?.exception?.description ?? d?.text)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  return { ws, send, opened, pageErrors }
}

async function launchBrowser(executable) {
  const profile = mkdtempSync(join(tmpdir(), 'nc-e2e-'))
  const browser = spawn(
    executable,
    [
      ...(HEADFUL ? [] : ['--headless=new']),
      // 포트 0: 브라우저가 빈 포트를 골라 프로필 폴더의 DevToolsActivePort 에 적는다.
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1280,900',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let port = null
  for (let i = 0; i < 150 && port === null; i += 1) {
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0])
    if (port === null) await sleep(100)
  }
  if (port === null) throw new Error('브라우저의 DevTools 포트를 알아내지 못했다')

  let target = null
  for (let i = 0; i < 100 && target === null; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page') ?? null
    } catch {
      /* 아직 안 떴다 */
    }
    if (target === null) await sleep(100)
  }
  if (target === null) throw new Error('브라우저 페이지에 붙지 못했다')

  return { browser, profile, url: target.webSocketDebuggerUrl }
}

// ── 본문 ──────────────────────────────────────────────────────────────

async function main() {
  const executable = findBrowser()
  if (!executable) {
    throw new Error('Chromium 계열 브라우저(Edge·Chrome)를 찾지 못했다. E2E_BROWSER 로 경로를 지정하라.')
  }
  console.log(`브라우저: ${executable}`)
  console.log(`서버: ${BASE}`)

  const server = startServer()
  let browser = null
  let profile = null
  let cdp = null

  try {
    await waitForServer()

    // ── API 로 준비: 로그인 → 워크스페이스 → 페이지 → 본문 ──
    const json = { 'content-type': 'application/json', origin: BASE }
    const email = `e2e+${Date.now()}@example.com`
    let res = await fetch(`${BASE}/api/auth/request-code`, { method: 'POST', headers: json, body: JSON.stringify({ email }) })
    if (!res.ok) throw new Error(`request-code ${res.status} — DB 가 떠 있나? (npm run db:up)\n${serverOutput.slice(-2000)}`)
    const code = await loginCodeFor(email)
    res = await fetch(`${BASE}/api/auth/verify-code`, { method: 'POST', headers: json, body: JSON.stringify({ email, code }) })
    if (!res.ok) throw new Error(`verify-code ${res.status}`)
    const session = res.headers
      .getSetCookie()
      .find((c) => c.startsWith('nc_session='))
      ?.split(';')[0]
      .slice('nc_session='.length)
    if (!session) throw new Error('세션 쿠키가 없다')
    const authed = { ...json, cookie: `nc_session=${session}` }

    res = await fetch(`${BASE}/api/workspaces`, { method: 'POST', headers: authed, body: JSON.stringify({ name: 'E2E' }) })
    const { workspaceId } = await res.json()
    res = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })
    const pageId = (await res.json()).page.id

    const ids = { A: randomUUID(), B: randomUUID(), C: randomUUID(), T: randomUUID(), t1: randomUUID(), D: randomUUID() }
    const nameOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]))
    const block = (id, type, text, children = []) => ({ id, type, title: [textRun(text)], properties: {}, format: {}, children })
    const doc = {
      blocks: [
        block(ids.A, 'paragraph', 'A'),
        block(ids.B, 'paragraph', 'B'),
        block(ids.C, 'paragraph', 'C'),
        block(ids.T, 'toggle', 'T', [block(ids.t1, 'paragraph', 't1')]),
        block(ids.D, 'paragraph', 'D'),
      ],
    }
    const bodyUrl = `${BASE}/api/workspaces/${workspaceId}/pages/${pageId}/body`
    res = await fetch(bodyUrl, { method: 'PUT', headers: authed, body: JSON.stringify({ doc }) })
    if (!res.ok) throw new Error(`본문 저장 ${res.status} ${await res.text()}`)

    /** 서버에 저장된 구조를 `A | A > a1` 꼴로. */
    const savedShape = async () => {
      const body = await (await fetch(bodyUrl, { headers: authed })).json()
      const out = []
      const walk = (blocks, prefix) => {
        for (const b of blocks) {
          const n = b.title?.[0]?.text?.content ?? '·'
          out.push(prefix + n)
          if (b.children?.length) walk(b.children, `${prefix}${n} > `)
        }
      }
      walk(body.doc.blocks, '')
      return out.join(' | ')
    }
    /** 자동 저장(디바운스 1초)이 끝나기를 기다린다. */
    const settledShape = async (expected) => {
      let shape = ''
      for (let i = 0; i < 40; i += 1) {
        shape = await savedShape()
        if (shape === expected) return shape
        await sleep(150)
      }
      return shape
    }

    // ── 브라우저 ──
    const launched = await launchBrowser(executable)
    browser = launched.browser
    profile = launched.profile
    cdp = connect(launched.url)
    await cdp.opened
    const { send, pageErrors } = cdp

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
      return r.result.value
    }
    const waitFor = async (expression, ms = 5000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await evaluate(expression)) return true
        await sleep(40)
      }
      return false
    }
    const move = (x, y, pressed = false) =>
      send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: pressed ? 'left' : 'none', buttons: pressed ? 1 : 0 })
    const press = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    const release = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    const click = async (x, y) => {
      await move(x, y)
      await press(x, y)
      await release(x, y)
    }
    const KEYS = { Escape: [27, 'Escape'], ArrowDown: [40, 'ArrowDown'] }
    const SHIFT = 8
    // `Mod` 는 Mac 에서 Cmd(4), 그 외 Ctrl(2). 헤드리스 브라우저의 플랫폼을 따른다.
    const MOD = process.platform === 'darwin' ? 4 : 2
    const key = async (name, modifiers = 0) => {
      const [vk, code] = KEYS[name]
      const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    }

    const rect = (selector) =>
      evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)})
        if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    /** 블록 자신의 줄(자식 제외). */
    const line = (id) => rect(`[data-block-id="${id}"] > *:first-child`)
    const order = () =>
      evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')]
        .map((c) => c.firstElementChild.textContent.replace(/[▾▸]/g, '').trim())`)
    const selected = async () =>
      (await evaluate(`[...document.querySelectorAll('.blk-selected')].map((e) => e.getAttribute('data-block-id'))`)).map(
        (id) => nameOf[id] ?? id,
      )
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

    /** 이 블록의 핸들을 잡아 (tx, ty) 로 끈다. 놓지 않으면 드래그 중 상태로 돌아온다. */
    const drag = async (id, tx, ty, { drop = true } = {}) => {
      const l = await line(id)
      await move(l.x + 30, l.y + l.h / 2)
      await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
      const g = await rect('.blk-gutter-grip')
      const gx = g.x + g.w / 2
      const gy = g.y + g.h / 2
      await move(gx, gy)
      await press(gx, gy)
      for (let i = 1; i <= 10; i += 1) {
        await move(gx + ((tx - gx) * i) / 10, gy + ((ty - gy) * i) / 10, true)
        await sleep(16)
      }
      if (drop) {
        await release(tx, ty)
        await sleep(80)
      }
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Network.setCookie', { name: 'nc_session', value: session, domain: 'localhost', path: '/', httpOnly: true })
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })

    section('로드')
    check('에디터가 뜬다', await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length === 6`, 15000))
    check('처음 순서', same(await order(), ['A', 'B', 'C', 'T', 't1', 'D']), JSON.stringify(await order()))

    section('핸들 (F-01-08)')
    const a = await line(ids.A)
    await move(a.x + 30, a.y + a.h / 2)
    check('hover 하면 핸들이 나타난다', await waitFor(`!!document.querySelector('.blk-gutter')`))
    const grip = await rect('.blk-gutter-grip')
    check('핸들은 그 줄 왼쪽 여백에 있다', !!grip && Math.abs(grip.y - a.y) < 8 && grip.x + grip.w <= a.x, JSON.stringify({ grip, a }))
    check('핸들은 편집기 DOM 바깥에 그려진다', await evaluate(`!document.querySelector('.blk-gutter').closest('.blk-editor')`))
    const t1 = await line(ids.t1)
    await move(t1.x + 10, t1.y + t1.h / 2)
    await sleep(60)
    const grip2 = await rect('.blk-gutter-grip')
    check('들여쓴 줄에서는 그 줄의 블록을 잡는다(부모가 아니라)', !!grip2 && Math.abs(grip2.y - t1.y) < 8 && grip2.x > grip.x, JSON.stringify({ grip2, t1 }))

    section('드래그')
    const c = await line(ids.C)
    await drag(ids.A, c.x + 5, c.y + c.h * 0.75, { drop: false })
    check('끄는 동안 파란 가이드가 보인다', await evaluate(`!!document.querySelector('.blk-drop-guide')`))
    check('끄는 동안 흐림 표시는 편집기 DOM 이 아니라 프레임에', await evaluate(`(() => { const f = document.querySelector('[data-dragging="true"]'); return !!f && !f.closest('.blk-editor') })()`))
    check('끄는 블록이 블록 선택으로 하이라이트된다', same(await selected(), ['A']), JSON.stringify(await selected()))
    const guide = await rect('.blk-drop-guide')
    check('가이드는 C 줄 아래 경계에', !!guide && Math.abs(guide.y + 1 - (c.y + c.h)) < 4, JSON.stringify({ guide, c }))
    await release(c.x + 5, c.y + c.h * 0.75)
    await sleep(80)
    check('놓으면 옮겨진다 — B C A T t1 D', same(await order(), ['B', 'C', 'A', 'T', 't1', 'D']), JSON.stringify(await order()))
    check('옮긴 블록이 선택돼 있다', same(await selected(), ['A']), JSON.stringify(await selected()))
    check('흐림 표시가 치워진다', !(await evaluate(`!!document.querySelector('[data-dragging]')`)))
    check('자동 저장 — 서버에도 반영된다', (await settledShape('B | C | A | T | T > t1 | D')) === 'B | C | A | T | T > t1 | D', await savedShape())

    const d = await line(ids.D)
    await drag(ids.B, d.x + 40, d.y + d.h * 0.75)
    check(
      '들여 놓으면 자식이 된다 — 부모만 바뀌는 이동도 저장된다(프로젝터 UNIQUE)',
      (await settledShape('C | A | T | T > t1 | D | D > B')) === 'C | A | T | T > t1 | D | D > B',
      await savedShape(),
    )

    const cNow = await line(ids.C)
    await drag(ids.C, cNow.x + 5, cNow.y + cNow.h * 0.3, { drop: false })
    const selfGuide = await rect('.blk-drop-guide')
    check('자기 줄 한가운데에는 드롭 존이 없다', !selfGuide || selfGuide.y + 1 <= cNow.y + 1 || selfGuide.y + 1 >= cNow.y + cNow.h - 1, JSON.stringify({ selfGuide, cNow }))
    await key('Escape')
    await sleep(60)
    check('Esc 로 드래그를 취소한다', !(await evaluate(`!!document.querySelector('.blk-drop-guide')`)))
    await release(cNow.x + 5, cNow.y + cNow.h * 0.3)
    await sleep(60)
    check('취소하면 그대로다', same(await order(), ['C', 'A', 'T', 't1', 'D', 'B']), JSON.stringify(await order()))

    section('핸들 클릭 · 키보드 이동 (F-01-09 · F-01-08)')
    const aNow = await line(ids.A)
    await move(aNow.x + 30, aNow.y + aNow.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const g = await rect('.blk-gutter-grip')
    await click(g.x + g.w / 2, g.y + g.h / 2)
    await sleep(60)
    check('핸들을 누르면 그 블록이 선택된다', same(await selected(), ['A']), JSON.stringify(await selected()))
    await key('ArrowDown', MOD | SHIFT)
    await sleep(60)
    check('Mod+Shift+↓ — 토글을 통째로 건너뛴다(안으로 들어가지 않는다)', same(await order(), ['C', 'T', 't1', 'A', 'D', 'B']), JSON.stringify(await order()))
    check('옮긴 뒤에도 블록 선택이 유지된다', same(await selected(), ['A']), JSON.stringify(await selected()))

    section('접힘 (F-01-13)')
    const arrowState = () =>
      evaluate(`(() => { const c = document.querySelector('[data-block-id="${ids.T}"]'); const a = c.querySelector('.blk-toggle-arrow')
        const child = document.querySelector('[data-block-id="${ids.t1}"]')
        return { collapsed: c.getAttribute('data-collapsed'), glyph: a.textContent, expanded: a.getAttribute('aria-expanded'),
                 childVisible: child.getBoundingClientRect().height > 0 } })()`)
    const arrow = await rect(`[data-block-id="${ids.T}"] .blk-toggle-arrow`)
    await click(arrow.x + arrow.w / 2, arrow.y + arrow.h / 2)
    await sleep(80)
    let s = await arrowState()
    check('화살표를 누르면 자식이 **실제로 숨는다**', s.collapsed === 'true' && !s.childVisible, JSON.stringify(s))
    check('화살표는 ▸, aria-expanded=false', s.glyph === '▸' && s.expanded === 'false', JSON.stringify(s))

    const tText = await rect(`[data-block-id="${ids.T}"] .blk-text`)
    await click(tText.x + 4, tText.y + tText.h / 2)
    await sleep(60)
    await key('Escape')
    await sleep(250)
    check('접힌 토글에서 Esc → 그 토글이 블록 선택된다', same(await selected(), ['T']), JSON.stringify(await selected()))
    await key('ArrowDown', SHIFT)
    await sleep(250)
    check('Shift+↓ 로 늘려도 선택이 풀리지 않는다', same(await selected(), ['T', 'A']), JSON.stringify(await selected()))

    // 접힌 토글 안으로 끌어 놓으면 펼친다. **프로그램이** 펼칠 때 화살표가 따라오는가 —
    // 화살표를 직접 누를 때만 방향이 맞던 것을 이 검사가 잡는다.
    const tLine = await line(ids.T)
    await drag(ids.C, tLine.x + 60, tLine.y + tLine.h * 0.75)
    s = await arrowState()
    check('접힌 토글 안에 놓으면 펼쳐진다', s.collapsed === null && s.childVisible, JSON.stringify(s))
    check('프로그램이 펼쳐도 화살표가 따라온다 — ▾, aria-expanded=true', s.glyph === '▾' && s.expanded === 'true', JSON.stringify(s))
    check(
      '서버에도 T 의 첫 자식으로 저장된다',
      (await settledShape('T | T > C | T > t1 | A | D | D > B')) === 'T | T > C | T > t1 | A | D | D > B',
      await savedShape(),
    )

    section('+ 버튼 (F-01-08 · F-01-04)')
    const dNow = await line(ids.D)
    await move(dNow.x + 30, dNow.y + dNow.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter')`)
    const plus = await rect('.blk-gutter-button')
    await click(plus.x + plus.w / 2, plus.y + plus.h / 2)
    await sleep(120)
    const afterPlus = await order()
    check('D 바로 아랫줄에 "/" 블록이 생긴다', afterPlus[afterPlus.indexOf('D') + 1] === '/', JSON.stringify(afterPlus))
    check('슬래시 메뉴가 열린다', await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 2000))

    section('전체')
    check('페이지에서 오류가 나지 않았다', pageErrors.length === 0, pageErrors.join('\n      '))
    const serverErrors = serverOutput.split('\n').filter((l) => l.includes('⨯'))
    check('서버에서 오류가 나지 않았다', serverErrors.length === 0, serverErrors.join('\n      '))
  } finally {
    cdp?.ws.close()
    browser?.kill()
    server.kill()
    if (profile) {
      // 브라우저가 파일을 막 놓는 중일 수 있다. 못 지워도 임시 폴더다.
      await sleep(300)
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        /* 임시 폴더 */
      }
    }
  }
}

try {
  await main()
} catch (e) {
  console.error(`\n실행 실패: ${e instanceof Error ? e.message : e}`)
  process.exit(2)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed} / ${results.length} 통과`)
process.exit(failed === 0 ? 0 : 1)
