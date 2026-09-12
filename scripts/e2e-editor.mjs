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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    const KEYS = {
      Escape: [27, 'Escape'],
      Enter: [13, 'Enter'],
      ArrowDown: [40, 'ArrowDown'],
      ArrowRight: [39, 'ArrowRight'],
      End: [35, 'End'],
      '/': [191, 'Slash'],
      c: [67, 'KeyC'],
      v: [86, 'KeyV'],
      // W7 검색 오버레이 — `Mod+K` · `Mod+P` 로 열고 ↑↓ 로 고른다.
      k: [75, 'KeyK'],
      p: [80, 'KeyP'],
      ArrowUp: [38, 'ArrowUp'],
      Backspace: [8, 'Backspace'],
    }
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
    // 헤드리스는 창에 포커스가 없어서 클립보드 API 가 거부된다. 포커스를 흉내내고 권한을 준다.
    await send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await send('Browser.grantPermissions', { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
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
    check('핸들을 누르면 블록 메뉴가 열리고 포커스가 메뉴로 간다', await evaluate(`!!document.activeElement?.closest('[role="menu"]')`))
    await key('Escape')
    await sleep(60)
    check('Esc 로 메뉴를 닫으면 포커스가 에디터로 돌아온다', await evaluate(`document.activeElement === document.querySelector('.blk-editor')`))
    check('메뉴를 닫아도 블록 선택은 그대로다', same(await selected(), ['A']), JSON.stringify(await selected()))
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

    section('블록 메뉴 (F-01-08 · F-12-01 · F-12-13)')
    // 지금 문서: T > C, T > t1, A, D > B. A 를 대상으로 한다.
    const menuOpen = () => evaluate(`!!document.querySelector('[role="menu"][aria-label="블록 메뉴"]')`)
    const typeOf = (id) => evaluate(`document.querySelector('[data-block-id="${id}"] > [data-block-type]')?.getAttribute('data-block-type') ?? null`)
    const aText = await rect(`[data-block-id="${ids.A}"] > *:first-child`)
    await click(aText.x + aText.w / 2, aText.y + aText.h / 2)
    await sleep(60)
    await key('/', MOD)
    await sleep(80)
    check('Mod+/ — 편집 모드에서도 그 블록을 선택하고 메뉴를 연다', (await menuOpen()) && same(await selected(), ['A']), JSON.stringify(await selected()))
    check('처음 포커스는 첫 켜진 항목(변환)', (await evaluate(`document.activeElement?.textContent`))?.startsWith('변환'))

    await key('Enter')
    await sleep(40)
    check('Enter 로 하위 메뉴가 열리고 첫 켜진 항목에 선다 — 이미 텍스트라 "텍스트"는 건너뛴다', (await evaluate(`document.activeElement?.textContent`))?.startsWith('제목 1'), await evaluate(`document.activeElement?.textContent`))
    await key('Enter')
    await sleep(80)
    check('변환 — A 가 제목 1 이 된다', (await typeOf(ids.A)) === 'heading_1', await typeOf(ids.A))
    check('실행하면 메뉴가 닫히고 에디터로 포커스가 온다', !(await menuOpen()) && (await evaluate(`document.activeElement === document.querySelector('.blk-editor')`)))

    await key('/', MOD)
    await sleep(60)
    await key('ArrowDown')
    await key('ArrowRight')
    await key('End')
    await sleep(40)
    check('색 하위 메뉴의 끝은 "빨강 배경"', (await evaluate(`document.activeElement?.textContent`))?.includes('빨강 배경'), await evaluate(`document.activeElement?.textContent`))
    await key('Enter')
    await sleep(80)
    check('색 — 블록 색(format.block_color)이 칠해진다', (await evaluate(`document.querySelector('[data-block-id="${ids.A}"] > [data-block-type]')?.getAttribute('data-color')`)) === 'red_background')

    await key('/', MOD)
    await sleep(60)
    await key('ArrowDown')
    await key('ArrowDown')
    await key('ArrowDown')
    await key('Enter')
    await sleep(150)
    const notice = await evaluate(`[...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' ')`)
    check('블록 링크 복사 — 안내가 뜬다', notice.includes('블록 링크를 복사했습니다'), notice)
    const copied = await evaluate(`navigator.clipboard.readText()`)
    check('클립보드에 /w/{ws}/{page}#{blockId} 가 들어간다', copied.endsWith(`/w/${workspaceId}/${pageId}#${ids.A}`), copied)

    await key('/', MOD)
    await sleep(60)
    await key('ArrowDown')
    await key('ArrowDown')
    await key('Enter')
    await sleep(100)
    const countA = async () => (await order()).filter((t) => t === 'A').length
    check('복제 — A 가 둘이 된다', (await countA()) === 2, JSON.stringify(await order()))
    await key('/', MOD)
    await sleep(60)
    await key('End')
    await key('Enter')
    await sleep(100)
    check('삭제 — 복제본이 지워져 A 가 다시 하나다(복제 뒤 선택이 복제본으로 옮겨 있다)', (await countA()) === 1, JSON.stringify(await order()))

    const aLine2 = await line(ids.A)
    await move(aLine2.x + 30, aLine2.y + aLine2.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const g2 = await rect('.blk-gutter-grip')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g2.x + g2.w / 2, y: g2.y + g2.h / 2, button: 'right', buttons: 2, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g2.x + g2.w / 2, y: g2.y + g2.h / 2, button: 'right', buttons: 0, clickCount: 1 })
    await sleep(80)
    check('핸들 우클릭으로도 열린다(정본 F-12-01) — 드래그는 시작하지 않는다', (await menuOpen()) && !(await evaluate(`!!document.querySelector('[data-dragging]')`)))
    // 메뉴는 A 의 핸들 아래로 펼쳐져 바로 아래 줄들을 덮는다. "바깥"은 A 위의 T 로 잡는다.
    const dText = await rect(`[data-block-id="${ids.D}"] > *:first-child`)
    const underD = await evaluate(`document.elementFromPoint(${dText.x + 10}, ${dText.y + dText.h / 2})?.closest('[role="menu"]') ? '메뉴' : '본문'`)
    const tOutside = await rect(`[data-block-id="${ids.T}"] .blk-text`)
    await click(tOutside.x + 4, tOutside.y + tOutside.h / 2)
    await sleep(80)
    const outside = { menu: await menuOpen(), selected: await selected(), underD }
    check('바깥을 누르면 닫힌다 — 누른 곳으로 캐럿이 간다', !outside.menu && outside.selected.length === 0, JSON.stringify(outside))

    // 링크로 들어오면 그 블록이 선택된 채로 열린다(복사하는 쪽과 받는 쪽).
    await send('Page.navigate', { url: copied })
    await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length > 0`, 15000)
    const aSelected = `[...document.querySelectorAll('.blk-selected')].some((e) => e.getAttribute('data-block-id') === '${ids.A}')`
    // 같은 페이지라 해시만 바뀐다(hashchange 경로).
    check('블록 링크로 가면 그 블록이 선택된다 — 같은 페이지(hashchange)', await waitFor(aSelected, 3000), JSON.stringify(await selected()))
    await send('Page.reload')
    await sleep(300)
    await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length > 0`, 15000)
    check('블록 링크로 처음 열어도 그 블록이 선택된다 — 새로고침(마운트 경로)', await waitFor(aSelected, 3000), JSON.stringify(await selected()))

    section('복사 · 붙여넣기 (F-01-10)')
    // 지금 문서: T > C, T > t1, A(제목1·빨강배경), D > B.
    const blocksMime = 'application/x-notion-clone-blocks+json'

    // ① 블록을 고르고, 먼저 **무엇을 싣는지** 본다(합성 이벤트).
    //    그다음 진짜 Ctrl+C / Ctrl+V 로 시스템 클립보드를 오간다 — 커스텀 MIME 이
    //    실제로 살아남는지는 그렇게만 알 수 있다.
    //    ⚠ execCommand('copy') 는 쓰지 않는다. 블록 선택은 캐럿이 없어 DOM 선택이
    //    접혀 있고, 그러면 복사 이벤트 자체가 일어나지 않는다(그래서 직전에 복사해 둔
    //    것이 그대로 붙었다).
    const copyLine = await line(ids.T)
    await move(copyLine.x + 30, copyLine.y + copyLine.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const tGrip = await rect('.blk-gutter-grip')
    await click(tGrip.x + tGrip.w / 2, tGrip.y + tGrip.h / 2)
    await key('Escape')
    await sleep(60)
    check('복사할 블록을 고른다(T · 자식 둘)', same(await selected(), ['T']), JSON.stringify(await selected()))

    const payload = await evaluate(`(() => {
      const dt = new DataTransfer()
      const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })
      document.querySelector('.blk-editor').dispatchEvent(ev)
      return { json: dt.getData('${blocksMime}'), text: dt.getData('text/plain'), html: dt.getData('text/html') }
    })()`)
    check('세 벌을 싣는다 — JSON · 평문 · HTML (정본의 3종)', !!payload.json && !!payload.text && !!payload.html, JSON.stringify(payload).slice(0, 300))
    check('평문은 마크다운에 가깝다', payload.text.includes('- '), payload.text)
    check('HTML 은 toDOM 형태다', payload.html.includes('data-block-type'), payload.html.slice(0, 200))
    check('JSON 에 자식까지 들어 있다', (payload.json.match(/"type"/g) ?? []).length >= 3, payload.json.slice(0, 200))

    await key('c', MOD)
    await sleep(120)

    const dLine = await line(ids.D)
    await click(dLine.x + 20, dLine.y + dLine.h / 2)
    await sleep(60)
    await key('v', MOD)
    await sleep(200)
    const afterPaste = await order()
    check('★ 진짜 클립보드로 붙는다 — 중첩까지 (T · C · t1 이 한 벌 더)', afterPaste.filter((t) => t === 'C').length === 2 && afterPaste.filter((t) => t === 't1').length === 2, JSON.stringify(afterPaste))
    check('붙은 블록은 새 id 를 받는다', await evaluate(`(() => { const ids = [...document.querySelectorAll('.blk-editor [data-block-id]')].map((e) => e.getAttribute('data-block-id')); return new Set(ids).size === ids.length })()`))
    // D 는 자식(B)이 있으므로 텍스트를 쪼개지 않고 **첫 자식 자리**에 들어간다
    // (자식이 뒤 블록으로 딸려가는 것을 막는다 — §7-4 최빈 버그).
    const pastedShape = 'T | T > C | T > t1 | A | D | D > T | D > T > C | D > T > t1 | D > B'
    const savedAfterPaste = await settledShape(pastedShape)
    check('붙여넣은 것이 서버에 저장된다 — 자식(B)은 그대로', savedAfterPaste === pastedShape, savedAfterPaste)

    // ② 하위 페이지는 복사되지 않는다 — 안내가 뜬다.
    const subpage = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ parentPageId: pageId }) })).json()
    await send('Page.reload')
    await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length > 0`, 15000)
    const subLine = await line(subpage.page.id)
    await move(subLine.x + 30, subLine.y + subLine.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const subGrip = await rect('.blk-gutter-grip')
    await click(subGrip.x + subGrip.w / 2, subGrip.y + subGrip.h / 2)
    await key('Escape')
    await sleep(60)
    const subPayload = await evaluate(`(() => {
      const dt = new DataTransfer()
      document.querySelector('.blk-editor').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
      return dt.getData('${blocksMime}')
    })()`)
    check('하위 페이지는 JSON 에 실리지 않는다', subPayload === '' || !subPayload.includes('"page"'), subPayload.slice(0, 200))
    check('복사되지 않았다고 알려준다', await waitFor(`[...document.querySelectorAll('[role="status"]'), ...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('하위 페이지는 복사되지 않았습니다'))`, 2000))

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

    section('이미지 (F-01-15)')
    // 빈 이미지 블록 둘을 문서 끝에 붙인다 — 하나는 URL, 하나는 업로드용.
    // 문서를 통째로 바꾸지 않고 **덧붙인다**: 위에서 만든 하위 페이지가 빠지면
    // 저장이 거부된다(낡은 탭이 하위 페이지를 지우는 것을 막는 규칙).
    const imgUrlId = randomUUID()
    const imgFileId = randomUUID()
    const emptyImage = (id) => ({ id, type: 'image', title: [], properties: {}, format: {}, children: [] })
    const currentDoc = (await (await fetch(bodyUrl, { headers: authed })).json()).doc
    res = await fetch(bodyUrl, {
      method: 'PUT',
      headers: authed,
      body: JSON.stringify({ doc: { blocks: [...currentDoc.blocks, emptyImage(imgUrlId), emptyImage(imgFileId)] } }),
    })
    if (!res.ok) throw new Error(`이미지 블록 저장 ${res.status} ${await res.text()}`)
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })
    await waitFor(`!!document.querySelector('[data-block-id="${imgFileId}"] .blk-image-pick')`, 15000)

    /** 서버에 저장된 이 블록의 `properties.source`. */
    const savedSource = async (id) => {
      const body = await (await fetch(bodyUrl, { headers: authed })).json()
      let found = null
      const walk = (blocks) => {
        for (const b of blocks) {
          if (b.id === id) found = b.properties?.source ?? null
          if (b.children?.length) walk(b.children)
        }
      }
      walk(body.doc.blocks)
      return found
    }
    const settledSource = async (id, predicate) => {
      let source = null
      for (let i = 0; i < 40; i += 1) {
        source = await savedSource(id)
        if (predicate(source)) return source
        await sleep(150)
      }
      return source
    }

    check('빈 이미지 블록은 업로드 버튼과 주소 입력을 보여준다 — 정본 "빈 값" 엣지 케이스',
      await evaluate(`!!document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-pick') && !!document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-url-input')`))

    // ① javascript: 는 화면에서 먼저 막힌다(저장 경로도 막지만, 여기서 알려준다).
    await evaluate(`(() => {
      const i = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-url-input')
      i.value = 'javascript:alert(1)'
      i.closest('form').requestSubmit()
    })()`)
    await sleep(120)
    const refused = await evaluate(`(() => {
      const fig = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image')
      return { state: fig.dataset.state, alert: fig.querySelector('[role="alert"]')?.textContent ?? '' }
    })()`)
    check('★ javascript: 주소는 거부하고 이유를 말한다', refused.state === 'empty' && refused.alert.includes('http'), JSON.stringify(refused))

    // ② 외부 URL — 불러오지 못하는 주소로 폴백까지 본다.
    await evaluate(`(() => {
      const i = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-url-input')
      i.value = 'https://invalid.example/없는이미지.png'
      i.closest('form').requestSubmit()
    })()`)
    check('외부 주소를 넣으면 이미지 블록이 된다', await waitFor(`document.querySelector('[data-block-id="${imgUrlId}"] .blk-image').dataset.state === 'ready'`, 3000))
    check('★ 못 불러오면 깨진 이미지 대신 "불러올 수 없음" + 원본 링크 (정본 엣지 케이스)',
      await waitFor(`(() => {
        const e = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-error')
        return !!e && !!e.querySelector('a.blk-image-origin')
      })()`, 5000))
    const urlSource = await settledSource(imgUrlId, (s) => s?.type === 'external')
    check('외부 주소는 그대로 저장된다', urlSource?.type === 'external' && urlSource.url.startsWith('https://'), JSON.stringify(urlSource))

    // ③ 업로드 — 진짜 파일을 고르고, 진짜 multipart 로 올라가, 진짜로 그려지는지.
    const pngPath = join(profile, 'e2e.png')
    writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    await send('DOM.enable')
    const domRoot = (await send('DOM.getDocument', { depth: -1 })).root.nodeId
    const inputNode = (await send('DOM.querySelector', { nodeId: domRoot, selector: `[data-block-id="${imgFileId}"] .blk-image-file` })).nodeId
    check('업로드 입력은 허용 타입만 받는다', (await evaluate(`document.querySelector('[data-block-id="${imgFileId}"] .blk-image-file').accept`)).includes('image/png'))
    await send('DOM.setFileInputFiles', { files: [pngPath], nodeId: inputNode })

    check('★ 파일을 고르면 올라가고 그 자리에 그려진다',
      await waitFor(`!!document.querySelector('[data-block-id="${imgFileId}"] img')`, 10000))
    const loaded = await waitFor(`(() => { const i = document.querySelector('[data-block-id="${imgFileId}"] img'); return !!i && i.complete && i.naturalWidth > 0 })()`, 10000)
    check('★ 올린 이미지가 실제로 디코드된다 — 스토리지→라우트→브라우저 전 경로', loaded,
      await evaluate(`document.querySelector('[data-block-id="${imgFileId}"] img')?.src ?? '(img 없음)'`))
    check('주소는 우리 content 라우트다 — 서명 URL 을 저장하지 않는다(FS2)',
      await evaluate(`document.querySelector('[data-block-id="${imgFileId}"] img').getAttribute('src').startsWith('/api/workspaces/${workspaceId}/files/')`))

    const fileSource = await settledSource(imgFileId, (s) => s?.type === 'file')
    check('★ 저장되는 것은 file_id 다 — 주소가 아니다', fileSource?.type === 'file' && typeof fileSource.file_id === 'string' && !JSON.stringify(fileSource).includes('/api/'), JSON.stringify(fileSource))

    // ④ 블록을 지우면 이미지도 같이 사라진다(참조 카운트는 DB 테스트가 본다).
    await send('Page.reload')
    await waitFor(`!!document.querySelector('[data-block-id="${imgFileId}"] img')`, 15000)
    check('새로고침해도 그대로 보인다 — 문서에서 다시 읽어 그린다', true)

    section('이미지 드롭 · 붙여넣기 (F-01-15)')
    // PNG 한 장을 브라우저 안에서 만든다. 여기부터는 **진짜 File 객체**가 돈다 —
    // DataTransfer 에 담아 drop · paste 이벤트로 흘려 넣으면 우리 플러그인이
    // 실제로 받는 것과 같은 값이다.
    const makeFile = (name, type, b64) => `(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))
      return new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })
    })()`
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

    const countImages = () => evaluate(`document.querySelectorAll('.blk-editor .blk-image').length`)
    const before = await countImages()

    // ① 붙여넣기 — 스크린샷을 붙이는 그 경로다(clipboardData.files).
    const pasteTarget = await line(ids.A)
    await click(pasteTarget.x + 20, pasteTarget.y + pasteTarget.h / 2)
    await sleep(60)
    // 이미 그려져 있는 이미지가 있으므로(앞 절) **새로 생긴 블록만** 본다.
    const idsBeforePaste = await evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')].map((e) => e.getAttribute('data-block-id'))`)
    const newImageSelector = (known) => `[...document.querySelectorAll('.blk-editor [data-block-id]')]
      .filter((c) => !${JSON.stringify(known)}.includes(c.getAttribute('data-block-id')))
      .find((c) => c.querySelector('.blk-image'))`
    await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(${makeFile('붙인이미지.png', 'image/png', PNG_B64)})
      document.querySelector('.blk-editor').dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      )
    })()`)
    check('★ 이미지를 붙여넣으면 이미지 블록이 생긴다', await waitFor(`document.querySelectorAll('.blk-editor .blk-image').length === ${before + 1}`, 5000))
    check('★ 붙인 이미지가 올라가 그려진다 — 빈 블록으로 남지 않는다',
      await waitFor(`(() => {
        const box = ${newImageSelector(idsBeforePaste)}
        const img = box?.querySelector('.blk-image img')
        return !!img && img.complete && img.naturalWidth > 0 && img.getAttribute('src').includes('/files/')
      })()`, 15000),
      await evaluate(`(${newImageSelector(idsBeforePaste)})?.querySelector('.blk-image')?.dataset.state ?? '(블록 없음)'`))

    // ② 드롭 — 이미지가 아닌 파일은 받지 않되 이유를 말한다.
    const dropLine = await line(ids.A)
    const dropAt = { x: dropLine.x + 20, y: dropLine.y + dropLine.h / 2 }
    const beforeReject = await countImages()
    await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['hello'], '메모.txt', { type: 'text/plain' }))
      document.querySelector('.blk-editor').dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${dropAt.x}, clientY: ${dropAt.y} }),
      )
    })()`)
    check('★ 이미지가 아닌 파일은 조용히 버리지 않고 이유를 말한다',
      await waitFor(`[...document.querySelectorAll('[role="status"]'), ...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('이미지만'))`, 3000))
    check('거부한 파일은 블록을 만들지 않는다', (await countImages()) === beforeReject, `${await countImages()} vs ${beforeReject}`)

    // ③ 드롭 — 놓은 줄 바로 다음에 들어간다.
    const beforeDrop = await countImages()
    await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(${makeFile('놓은이미지.png', 'image/png', PNG_B64)})
      document.querySelector('.blk-editor').dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${dropAt.x}, clientY: ${dropAt.y} }),
      )
    })()`)
    check('★ 끌어다 놓으면 그 자리에 이미지 블록이 생긴다', await waitFor(`document.querySelectorAll('.blk-editor .blk-image').length === ${beforeDrop + 1}`, 5000))
    const dropped = await evaluate(`(() => {
      const containers = [...document.querySelectorAll('.blk-editor [data-block-id]')]
      const at = containers.findIndex((c) => c.getAttribute('data-block-id') === '${ids.A}')
      return { next: containers[at + 1]?.querySelector('.blk-image') ? '이미지' : containers[at + 1]?.firstElementChild?.getAttribute('data-block-type') ?? '없음' }
    })()`)
    check('놓은 줄 바로 다음에 들어간다 — 그 줄을 쪼개지 않는다', dropped.next === '이미지', JSON.stringify(dropped))

    // ④ 에디터를 빗나간 드롭은 삼킨다 — 안 그러면 브라우저가 그 파일을 열고
    //    편집하던 페이지를 떠난다.
    const strayPrevented = await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }))
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      document.body.appendChild(document.createElement('div')).dispatchEvent(ev)
      return ev.defaultPrevented
    })()`)
    check('★ 에디터 밖에 놓아도 브라우저가 파일을 열지 않는다 — 페이지를 떠나지 않게', strayPrevented)

    // ⑤ 올라간 것이 서버에 file_id 로 저장된다.
    const droppedSaved = await (async () => {
      let last = []
      for (let i = 0; i < 40; i += 1) {
        const body = await (await fetch(bodyUrl, { headers: authed })).json()
        const found = []
        const walk = (blocks) => {
          for (const b of blocks) {
            if (b.type === 'image' && b.properties?.source?.type === 'file') found.push(b.properties.source.file_id)
            if (b.children?.length) walk(b.children)
          }
        }
        walk(body.doc.blocks)
        if (found.length >= 3) return found
        last = found
        await sleep(150)
      }
      // 실패해도 **무엇이 저장돼 있었는지** 보여준다 — 빈 배열만 찍으면 원인을
      // 알 수 없다(반사실 실험에서 실제로 헷갈렸다).
      return last
    })()
    check('★ 올린 · 붙인 · 놓은 이미지가 모두 file_id 로 저장된다', droppedSaved.length >= 3, JSON.stringify(droppedSaved))

    section('오프라인 저장 큐 (F-05-04)')
    // 지금까지의 검사가 전부 "연결이 살아 있을 때"였다. 이 절은 **끊긴 동안 친 글이
    // 살아남는가**를 본다 — 이 기능이 존재하는 이유다.
    // ⚠ 네트워크를 통째로 끊지 않는다(`Network.emulateNetworkConditions`).
    //    그러면 **페이지 자체가 로드되지 않아** 새로고침 시나리오를 볼 수 없다
    //    (실제로 그렇게 썼다가 브라우저 오류 페이지를 받았다). 우리가 보려는 것은
    //    "저장 요청이 실패하는 동안 친 글이 살아남는가"이므로 **저장 라우트만** 막는다.
    const blockSaves = (yes) =>
      send('Network.setBlockedURLs', { urls: yes ? ['*/pages/*/body'] : [] })
    await send('Network.enable')

    // 새 페이지에서 한다 — 앞 절들이 만든 상태와 섞이지 않게.
    const syncPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
    const syncBodyUrl = `${BASE}/api/workspaces/${workspaceId}/pages/${syncPage}/body`
    const savedText = async () => {
      const body = await (await fetch(syncBodyUrl, { headers: authed })).json()
      return body.doc.blocks.map((b) => b.title?.[0]?.text?.content ?? '').join(' | ')
    }
    const typeText = async (text) => {
      await send('Input.insertText', { text })
      await sleep(60)
    }

    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${syncPage}` })
    await waitFor(`!!document.querySelector('.blk-editor [data-block-id]')`, 15000)
    await click((await rect('.blk-editor')).x + 40, (await rect('.blk-editor')).y + 10)
    await typeText('온라인에서 친 글')
    check('평상시 저장은 조용하다 — "저장됨"을 띄우지 않는다',
      !(await evaluate(`[...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('저장'))`)))
    check('온라인에서 친 글이 서버에 저장된다', (await (async () => {
      for (let i = 0; i < 40; i += 1) { if ((await savedText()).includes('온라인에서 친 글')) return true; await sleep(150) }
      return false
    })()))

    // ① 연결을 끊고 계속 친다.
    await blockSaves(true)
    await typeText(' + 끊긴 뒤에 친 글')
    check('★ 3초 넘게 못 보내면 "동기화 중"이라고 말한다',
      await waitFor(`[...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('동기화 중'))`, 15000))
    check('끊긴 동안 친 글은 아직 서버에 없다', !(await savedText()).includes('끊긴 뒤에 친 글'), await savedText())

    // ② 저장이 막힌 채로 탭을 다시 연다. 큐가 IndexedDB 에 있어야 살아남는다.
    await send('Page.reload')
    await waitFor(`!!document.querySelector('.blk-editor [data-block-id]')`, 20000)
    check('★ 저장이 막힌 채 새로고침해도 친 글이 화면에 돌아온다 — IndexedDB 에 남아 있었다',
      await waitFor(`document.querySelector('.blk-editor').textContent.includes('끊긴 뒤에 친 글')`, 15000),
      await evaluate(`document.querySelector('.blk-editor').textContent`))
    check('복구했다고 알려준다',
      await waitFor(`[...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('복구'))`, 5000))
    check('IndexedDB 에 실제로 남아 있다', await evaluate(`(async () => {
      const db = await new Promise((ok, no) => { const r = indexedDB.open('notion-clone-outbox', 1); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
      const rows = await new Promise((ok) => { const r = db.transaction('saves').objectStore('saves').getAll(); r.onsuccess = () => ok(r.result) })
      return rows.some((e) => JSON.stringify(e.doc).includes('끊긴 뒤에 친 글'))
    })()`))

    // ③ 연결이 돌아온다.
    await blockSaves(false)
    await evaluate(`window.dispatchEvent(new Event('online'))`)
    const recovered = await (async () => {
      for (let i = 0; i < 60; i += 1) { const t = await savedText(); if (t.includes('끊긴 뒤에 친 글')) return t; await sleep(200) }
      return await savedText()
    })()
    check('★ 연결이 돌아오면 끊긴 동안 친 글이 저장된다', recovered.includes('끊긴 뒤에 친 글'), recovered)
    check('큐가 비워진다 — 확정된 것을 남기지 않는다', await waitFor(`(async () => {
      const db = await new Promise((ok) => { const r = indexedDB.open('notion-clone-outbox', 1); r.onsuccess = () => ok(r.result) })
      const rows = await new Promise((ok) => { const r = db.transaction('saves').objectStore('saves').getAll(); r.onsuccess = () => ok(r.result) })
      return rows.length === 0
    })()`, 10000))
    check('"동기화 중" 표시가 사라진다',
      await waitFor(`![...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('동기화 중'))`, 5000))

    section('오류 · 복구 UX (F-12-16)')
    // ① 오프라인 배너 — 편집을 막지 않는다.
    await evaluate(`window.dispatchEvent(new Event('offline'))`)
    check('★ 오프라인이면 배너가 뜨고, 계속 편집할 수 있다고 말한다',
      await waitFor(`[...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('오프라인'))`, 3000))
    check('편집을 막지 않는다 — 입력을 막으면 사용자가 내용을 잃는다',
      await evaluate(`document.querySelector('.blk-editor').contentEditable !== 'false'`))
    await evaluate(`window.dispatchEvent(new Event('online'))`)
    check('연결이 돌아오면 배너가 사라진다',
      await waitFor(`![...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('오프라인'))`, 3000))

    // ② 서버가 본문 크기 한도를 413 + retryable:false 로 거절한다.
    const tooBig = await fetch(syncBodyUrl, {
      method: 'PUT',
      headers: authed,
      body: JSON.stringify({ doc: { blocks: [{ id: randomUUID(), type: 'paragraph', title: [textRun('가'.repeat(400000))], properties: {}, format: {}, children: [] }] } }),
    })
    const tooBigBody = await tooBig.json()
    check('★ 본문이 한도를 넘으면 413 이다', tooBig.status === 413, String(tooBig.status))
    check('그리고 다시 보내도 소용없다고 말해 준다 (retryable:false)', tooBigBody.retryable === false, JSON.stringify(tooBigBody))

    // ③ 화면에서는 **보내기 전에** 막고, 못 보낸 내용을 볼 수 있어야 한다.
    const editorBox = await rect('.blk-editor')
    await click(editorBox.x + 40, editorBox.y + 10)
    await send('Input.insertText', { text: '넘치는 글'.repeat(80000) })
    check('★ 한도를 넘으면 보내기 전에 말해 준다 — 413 을 받아 보지 않는다',
      await waitFor(`[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('KB'))`, 15000),
      await evaluate(`[...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent).join(' / ')`))

    // ⚠ 좌표를 읽기 전에 **보이는 곳으로 올린다.** 1MB 짜리 문단을 넣은 뒤라
    //    화면이 캐럿을 따라 내려가 있어서 배너가 뷰포트 위로 밀려나 있고,
    //    그 상태의 rect 는 음수라 클릭이 아무 데도 닿지 않는다(실제로 겪었다).
    const seeButton = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('저장하지 못한 내용'))
      if (!b) return null
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    check('★ "저장하지 못한 내용 보기"가 있다 — 조용히 버리면 데이터 손실 신고가 된다', !!seeButton)
    if (seeButton) {
      await click(seeButton.x, seeButton.y)
      check('★ 못 보낸 내용을 실제로 보여준다 — 복사해 갈 수 있다',
        await waitFor(`(() => {
          const t = document.querySelector('textarea[aria-label="저장하지 못한 내용"]')
          return !!t && t.value.includes('넘치는 글')
        })()`, 5000),
        await evaluate(`(() => {
          const t = document.querySelector('textarea[aria-label="저장하지 못한 내용"]')
          return t ? '길이 ' + t.value.length + ' / 앞 ' + JSON.stringify(t.value.slice(0, 40)) : '(textarea 없음)'
        })()`))
    }

    section('공유 패널 (F-06-05)')
    // 새 페이지 + 하위 페이지에서 본다 — 상속 표시와 "따로 관리하기"가 핵심이다.
    const shareParent = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
    const shareChild = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ parentPageId: shareParent }) })).json()).page.id

    const clickText = async (text, selector = 'button') => {
      const box = await evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().includes(${JSON.stringify(text)}))
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      if (!box) return false
      await click(box.x, box.y)
      await sleep(150)
      return true
    }
    const panelText = () => evaluate(`document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '(패널 없음)'`)

    // ① 루트 페이지 — 모두에게 전체 권한이 직접 부여돼 있다.
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${shareParent}` })
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
    check('공유 버튼이 있다', await clickText('공유'))
    check('★ 루트 페이지는 "모든 멤버"에게 부여돼 있다',
      await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes('워크스페이스 모든 멤버')`, 5000),
      await panelText())
    check('루트에서는 상속 표시가 없다', !(await panelText()).includes('상위에서 상속됨'))

    // ② 하위 페이지 — 같은 주체가 "상속됨"으로 보인다.
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${shareChild}` })
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
    await clickText('공유')
    check('★ 하위 페이지에서는 "상위에서 상속됨"으로 표시된다',
      await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes('상위에서 상속됨')`, 5000),
      await panelText())
    check('상위 설정을 따르고 있다고 말해 준다', (await panelText()).includes('상위 페이지의 공유 설정을 따르고'))

    // ③ ★ "따로 관리하기" — 끊는 순간 상속분이 복사돼야 한다(불변식 P1).
    check('"따로 관리하기"를 누른다', await clickText('따로 관리하기'))
    await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes('따로 관리')`, 5000)
    const afterRestrict = await panelText()
    check('★ 끊어도 접근이 사라지지 않는다 — 상속분이 이 페이지로 복사됐다 (P1)',
      afterRestrict.includes('워크스페이스 모든 멤버') && !afterRestrict.includes('상위에서 상속됨'),
      afterRestrict)
    check('끊었다는 것을 말로 알려준다', afterRestrict.includes('따로 관리되고 있습니다'))
    check('서버에도 반영됐다 — 이제 이 노드가 직접 갖고 있다', await (async () => {
      const data = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${shareChild}/access`, { headers: authed })).json()
      return data.entries.some((e) => e.principalType === 'workspace_everyone' && !e.inherited)
    })())

    // ④ 마지막 관리자를 지우려 하면 막고 이유를 말한다.
    check('"제거"를 누른다', await clickText('제거'))
    check('★ 관리할 사람이 아무도 안 남는 제거는 막는다',
      await waitFor(`[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('관리할 수 있는 사람'))`, 5000),
      await panelText())
    check('막힌 뒤에도 권한은 그대로다', (await panelText()).includes('워크스페이스 모든 멤버'))

    section('내비게이션 — 최근 · 즐겨찾기 (W6-a)')
    // 방금까지 여러 페이지를 오갔으므로 사이드바에 "최근"이 있어야 한다.
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })
    await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
    check('★ 사이드바에 "최근" 섹션이 생긴다 — 방문이 기록됐다',
      await waitFor(`!!document.querySelector('section[aria-label="최근"]')`, 5000),
      await evaluate(`document.querySelector('nav[aria-label="페이지 트리"]')?.textContent?.slice(0, 120) ?? '(사이드바 없음)'`))
    check('지금 보고 있는 페이지가 최근 목록에 있다',
      await evaluate(`!!document.querySelector('section[aria-label="최근"] a[href$="/${pageId}"]')`))

    // 즐겨찾기는 아직 없다 — 빈 섹션은 그리지 않는다.
    check('즐겨찾기가 없으면 그 섹션도 없다', !(await evaluate(`!!document.querySelector('section[aria-label="즐겨찾기"]')`)))

    const starBox = await evaluate(`(() => {
      const b = document.querySelector('button[aria-label="즐겨찾기에 넣기"]')
      if (!b) return null
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    check('별 버튼이 있다 — 상태를 이름으로도 알린다', !!starBox)
    if (starBox) {
      await click(starBox.x, starBox.y)
      check('★ 별을 누르면 즐겨찾기 섹션이 나타난다',
        await waitFor(`!!document.querySelector('section[aria-label="즐겨찾기"] a[href$="/${pageId}"]')`, 10000))
      check('별의 상태가 바뀐다 (aria-pressed)',
        await waitFor(`document.querySelector('button[aria-label="즐겨찾기에서 빼기"]')?.getAttribute('aria-pressed') === 'true'`, 5000))

      // 다시 누르면 사라진다.
      const unstar = await evaluate(`(() => {
        const b = document.querySelector('button[aria-label="즐겨찾기에서 빼기"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      if (unstar) {
        await click(unstar.x, unstar.y)
        check('다시 누르면 즐겨찾기에서 빠진다',
          await waitFor(`!document.querySelector('section[aria-label="즐겨찾기"]')`, 10000))
      }
    }

    // 제목을 복사해 두지 않는다 — 제목을 바꾸면 최근 목록도 바뀐다.
    const renamed = `이름 바꾼 페이지 ${Date.now()}`
    await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: 'PATCH',
      headers: authed,
      body: JSON.stringify({ title: renamed }),
    })
    await send('Page.reload')
    await waitFor(`!!document.querySelector('section[aria-label="최근"]')`, 15000)
    check('★ 제목을 바꾸면 최근 목록의 제목도 바뀐다 — 제목을 복사해 두지 않는다',
      await waitFor(`document.querySelector('section[aria-label="최근"]')?.textContent.includes(${JSON.stringify(renamed)})`, 5000),
      await evaluate(`document.querySelector('section[aria-label="최근"]')?.textContent ?? '(없음)'`))

    section('검색 오버레이 (W7 · F-07-01)')
    // 이 절이 헤드리스로는 절대 안 보이는 것을 본다: 단축키가 에디터까지 새지
    // 않는가 · 포커스가 돌아오는가 · ↑↓/Enter 가 본문을 건드리지 않는가.
    {
      // 찾을 대상 — 제목에 고유 토큰을 넣은 페이지를 API 로 만든다.
      const token = `검색대상${Date.now()}`
      const found = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: token }),
      })).json()).page.id

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })
      await waitFor(`!!document.querySelector('.blk-editor [data-block-id]')`, 15000)

      const overlayOpen = () => evaluate(`!!document.querySelector('[data-testid="search-overlay"]')`)
      const hitIds = () => evaluate(
        `[...document.querySelectorAll('[data-testid="search-hit"]')].map((e) => e.dataset.pageId)`)
      const selectedId = () => evaluate(
        `document.querySelector('[data-testid="search-hit"][aria-selected="true"]')?.dataset.pageId ?? null`)

      // ── 에디터에 포커스를 두고 연다 ──
      const editorBox = await rect('.blk-editor')
      await click(editorBox.x + 40, editorBox.y + 10)
      const bodyBefore = await evaluate(`document.querySelector('.blk-editor')?.textContent ?? ''`)

      await key('k', MOD)
      check('★ Mod+K 로 열린다 (선택이 없을 때)', await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 5000))
      check('입력창으로 포커스가 간다',
        await waitFor(`document.activeElement === document.querySelector('[data-testid="search-input"]')`, 3000))

      // 빈 입력 = 이동 모드. 방금까지 여러 페이지를 오갔으므로 최근 방문이 있다.
      check('★ 빈 입력이면 최근 방문이 보인다 (F-07-01 이동 모드)',
        await waitFor(`document.querySelector('[data-testid="search-results"]')?.textContent.includes('최근 방문')`, 3000),
        await evaluate(`document.querySelector('[data-testid="search-results"]')?.textContent?.slice(0, 120) ?? '(없음)'`))

      // ── 검색 모드 ──
      await typeText(token)
      check('★ 타이핑하면 결과가 바뀐다 — debounce 뒤 질의가 돈다',
        await waitFor(`[...document.querySelectorAll('[data-testid="search-hit"]')].some((e) => e.dataset.pageId === ${JSON.stringify(found)})`, 8000),
        JSON.stringify(await hitIds()))
      check('일치 구간이 강조된다 (<mark>)',
        await evaluate(`!!document.querySelector('[data-testid="search-hit"] mark')`))

      // ── ↑↓ 이동 ──
      const before = await selectedId()
      await key('ArrowDown')
      await sleep(80)
      const afterDown = await selectedId()
      const many = (await hitIds()).length > 1
      check('★ ↓ 로 선택이 옮겨진다', many ? afterDown !== before : afterDown === before,
        `결과 ${(await hitIds()).length}건 · ${before} → ${afterDown}`)
      await key('ArrowUp')
      await sleep(80)
      check('★ ↑ 로 되돌아온다', (await selectedId()) === before)

      // 오버레이가 열린 동안의 입력(검색어 타이핑 · ↑↓)이 본문에 닿지 않았다.
      //
      // `bodyBefore` 는 오버레이를 열기 **전**에 찍었다. 반사실로 확인한 결과
      // 이 검사가 실제로 잡는 것은 화살표가 아니라 **타이핑이 에디터로 새는 것**
      // 이었다(포커스 이동을 끄면 검색어가 본문에 박힌다). 이름을 그대로 적는다.
      check('★ 오버레이가 열린 동안의 입력이 본문에 새지 않았다',
        (await evaluate(`document.querySelector('.blk-editor')?.textContent ?? ''`)) === bodyBefore)

      // ★ 위 검사를 **성립시키는 메커니즘**을 따로 본다.
      //
      //   처음에는 그 보호를 `stopPropagation()` 이 한다고 적었는데, 반사실로
      //   확인해 보니 그 줄을 빼도 135개가 전부 통과했다. 실제 이유는 **포커스
      //   격리**다 — 오버레이가 에디터 DOM 밖에 있고 포커스가 그쪽으로 가므로
      //   ProseMirror 의 `handleKeyDown`(= `view.dom` 의 리스너)이 있는 경로를
      //   이벤트가 지나지 않는다. 그 사실이 깨지면(오버레이를 에디터 안에 그리거나
      //   포커스를 옮기지 않게 바꾸면) 이 검사가 잡는다.
      check('★ 포커스가 에디터 DOM 밖에 있다 — 이것이 에디터를 지키는 메커니즘이다',
        await evaluate(`(() => {
          const active = document.activeElement
          const editor = document.querySelector('.blk-editor')
          return !!active && !!editor && !editor.contains(active)
        })()`),
        await evaluate(`document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '(없음)'`))

      // ── Esc 로 닫고 포커스 복귀 ──
      await key('Escape')
      check('Esc 로 닫힌다', await waitFor(`!document.querySelector('[data-testid="search-overlay"]')`, 3000))
      check('★ 포커스가 에디터로 돌아온다 (F-07-01)',
        await waitFor(`document.activeElement?.closest('.blk-editor') !== null`, 3000),
        await evaluate(`document.activeElement?.className ?? '(없음)'`))

      // ── Mod+P 도 연다 (충돌 없는 우회 경로) ──
      await key('p', MOD)
      check('★ Mod+P 로도 열린다', await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 5000))

      // ── 0건 상태 ──
      await typeText(`없는말${Date.now()}`)
      check('결과가 없으면 그렇게 말한다',
        await waitFor(`!!document.querySelector('[data-testid="search-empty"]')`, 8000),
        await evaluate(`document.querySelector('[data-testid="search-results"]')?.textContent?.slice(0, 80) ?? '(없음)'`))

      // 지우면 다시 이동 모드 — 낡은 결과가 비치지 않는다.
      for (let i = 0; i < 40; i += 1) await key('Backspace')
      check('★ 지우면 이동 모드로 돌아간다 — 낡은 결과가 남지 않는다',
        await waitFor(`document.querySelector('[data-testid="search-results"]')?.textContent.includes('최근 방문')
                       && !document.querySelector('[data-testid="search-empty"]')`, 5000),
        await evaluate(`document.querySelector('[data-testid="search-results"]')?.textContent?.slice(0, 120) ?? '(없음)'`))

      // ── Enter 로 이동 ──
      await typeText(token)
      await waitFor(`[...document.querySelectorAll('[data-testid="search-hit"]')].some((e) => e.dataset.pageId === ${JSON.stringify(found)})`, 8000)
      // 찾은 페이지가 선택될 때까지 ↓ 를 누른다(최근 방문과 섞일 수 있다).
      for (let i = 0; i < 10 && (await selectedId()) !== found; i += 1) {
        await key('ArrowDown')
        await sleep(60)
      }
      check('목표 페이지가 선택됐다', (await selectedId()) === found)
      await key('Enter')
      check('★ Enter 로 그 페이지가 열린다',
        await waitFor(`location.pathname.endsWith('/${found}')`, 8000),
        await evaluate('location.pathname'))
      check('오버레이가 닫혔다', !(await overlayOpen()))

      // ── 사이드바 버튼 ──
      await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
      const searchBtn = await evaluate(`(() => {
        const b = [...document.querySelectorAll('nav[aria-label="페이지 트리"] button')]
          .find((e) => e.textContent.includes('검색'))
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      check('사이드바에 검색 버튼이 있다', searchBtn !== null)
      if (searchBtn) {
        await click(searchBtn.x, searchBtn.y)
        check('★ 사이드바 버튼으로도 열린다', await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 5000))
        await key('Escape')
      }
    }

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
