# notion-clone

노션과 같은 기능을 하는 웹 애플리케이션. TypeScript + Next.js.

기획은 [`docs/notion-feature-research.md`](docs/notion-feature-research.md)에 끝나 있다. 기능 278개, MVP 65개, Phase 0~3.

@AGENTS.md

> ⚠ **Next.js 16이다.** `AGENTS.md`가 경고하듯 API·규약·파일 구조가 이전 버전과 다르다.
> Next.js 코드를 쓰기 전에 `node_modules/next/dist/docs/` 의 해당 가이드를 먼저 읽는다.
> `AGENTS.md` 블록은 `next dev`가 다시 써넣으므로 커밋해 둔다.

---

## 문서 계층 (충돌 시 위가 이긴다)

| 순위 | 문서 | 역할 |
|---|---|---|
| 1 | [`docs/research/00-canonical-data-model.md`](docs/research/00-canonical-data-model.md) | **스키마 정본.** 테이블 73개. 도메인 문서와 다르면 이쪽이 맞다 |
| 2 | [`docs/research/00-feature-ownership.md`](docs/research/00-feature-ownership.md) | F-ID 인벤토리 · 확정 난이도/우선순위 · MVP 목록 |
| 3 | [`docs/notion-feature-research.md`](docs/notion-feature-research.md) | 마스터 의사결정 문서 (로드맵 · 스택 · 리스크) |
| 4 | `docs/research/01~17-*.md` | 도메인 상세 명세. **판결 이후 소급 수정하지 않았으므로 폐기된 스키마가 남아 있다** (마스터 문서 부록 A 참조) |

`docs/research/_canon/`에 판결문 4건, `_critique/`에 커버리지 비평이 있다.

---

## 절대 제약

### 1. 무료 라이브러리만 쓴다

허용: **MIT · BSD(2/3-Clause) · Apache-2.0 · ISC · PostgreSQL License · MPL-2.0**(빌드 도구 한정)

금지: **AGPL · SSPL · RSAL · BUSL · 상용 유료 라이선스 · 유료 SaaS 의존**

- CI가 `npm run check:licenses`로 자동 검사한다. 위반 시 빌드 실패.
- 새 의존성 추가 시 라이선스를 먼저 확인한다. 판단이 애매하면 추가하지 않는다.
- 확정된 회피 목록:
  - **Redis → Valkey (BSD-3)**. Redis는 2024년부터 RSALv2/SSPL, 8.0부터 AGPLv3 추가. 우리 용도로는 걸리지 않지만 판단 자체를 없앤다.
  - **MinIO 사용 금지.** AGPLv3인 데다 2026-04-25 리포지토리 아카이브(개발 중단). 자체 호스팅이 필요하면 SeaweedFS(Apache-2.0), 기본은 Cloudflare R2.
  - **Tiptap Cloud 사용 안 함.** 에디터 라이브러리는 MIT라 문제없다. 협업 서버는 Hocuspocus(MIT) 자체 호스팅.
  - **Tiptap Tracked Changes(유료) 사용 안 함.** 제안 편집은 판결 U-2대로 Y.Doc 안의 자체 mark 3종으로 구현한다.
  - **Docker Desktop 대신 Rancher Desktop (Apache-2.0).** Docker Desktop은 개인·교육·비영리 OSS·소규모 사업자(250명 미만 AND 연매출 $10M 미만)만 무료인 **조건부** 무료다. 조건을 계속 추적하느니 조건 없는 쪽을 쓴다. Rancher Desktop은 dockerd(moby)를 그대로 쓰므로 `docker` · `docker compose` 명령이 동일하다.

### 2. LLM 토큰은 하드 캡 — 초과 시 자동 결제 없이 차단한다

Phase 2의 AI 기능(F-10-*)은 **fail-closed**로 만든다.

- 워크스페이스별 크레딧 한도를 DB에 두고, **호출 전에 잔량을 확인**한다. 부족하면 요청을 거부한다.
- 한도 초과 시 **자동 충전·자동 결제·초과 과금을 하지 않는다.** 사용자에게 "한도 도달"을 보여주고 멈춘다.
- 초과분을 나중에 청구하는 설계(post-paid overage)도 금지한다.
- 스트리밍 중 한도를 넘으면 **스트림을 중단**하고 부분 응답을 저장한다.
- 이 게이트(F-10-12)는 AI 기능 첫 커밋과 **반드시 동시에** 들어간다. "나중에 붙인다"는 금지.

### 3. 스키마는 정본을 따른다

`00-canonical-data-model.md`가 이미 판결한 사안을 다시 판단하지 않는다. 바꿔야 한다고 판단되면 **정본 문서를 먼저 고치고** 판결 근거를 남긴다.

특히 되돌리기 비싼 4가지:
- 본문 순서의 정본은 Y.Doc, `block.order_key`는 파생 (판결 X-1)
- DB 행은 `block` 테이블의 행이다. `row_page` 같은 별도 엔티티를 만들지 않는다 (C-3)
- 셀 값은 EAV (`page_property_value`), relation은 `relation_edge` 별도 테이블 (C-2)
- `lifecycle`은 `type='page'` 블록만의 축 (X-3)

---

## 스택

```
Next.js(App Router) + TypeScript + Tiptap(ProseMirror) + Yjs + TanStack + Radix
        │
        └── PostgreSQL 16(+pg_bigm) · Valkey · S3 호환(R2)
```

전체 근거는 마스터 문서 §6.

---

## 개발

런타임: **Rancher Desktop**(Container Engine = `dockerd (moby)`, Kubernetes 끔).

```bash
npm install
cp .env.example .env    # AUTH_SECRET 은 직접 생성해 채운다

npm run db:up           # postgres(pg_bigm) + valkey 기동
npm run db:verify       # 확장 · collation · 한국어 2-gram · valkey 확인
npm run dev             # http://localhost:3000

npm run check           # typecheck + lint + license
npm run db:reset        # 볼륨까지 삭제 후 재생성
```

DB collation은 **한 번 정하면 못 바꾼다.** ICU + `ko-KR`로 초기화하므로, 이미 만든 볼륨이 있다면 `db:reset` 후에 적용된다.

### 알려진 문제: Windows `docker` CLI 불안정 (Rancher Desktop 1.24.0 + WSL 2.7.13)

Rancher Desktop의 **Win32 socket proxy**가 크래시-재시작 루프를 돈다. 증상:

- `docker` 명령이 기동 후 **40~50초만 동작**하다가 `failed to connect to the backend: timed out dialing Hyper-V socket`으로 죽는다
- `%LOCALAPPDATA%\rancher-desktop\logs\background.log` 에 `Background process Win32 socket proxy (pid ...) exited with status 1` 이 1초 간격으로 반복된다
- `docker.log` 가 수백 MB까지 부풀어 오른다 (실제로 226MB까지 갔다)

**컨테이너 자체는 영향이 없다.** WSL 안에서 정상 동작하고, `localhost:5432` · `localhost:6379` 도 Windows에서 정상 접근된다. 즉 **앱 개발에는 지장이 없고 `docker` 관리 명령만 막힌다.**

그래서 `scripts/verify-db.mjs` 는 `docker compose exec` 가 아니라 **앱과 같은 TCP 경로**로 접속한다. 검증은 실제 사용 경로를 재현해야 한다 — 그렇지 않으면 DB가 멀쩡한데 죽었다고 잘못 보고한다.

**우회 (컨테이너가 이미 떠 있다면 그냥 개발하면 된다):**

```bash
# 컨테이너 상태 확인
wsl -d rancher-desktop -e docker ps

# DB 검증 (docker CLI 불필요)
npm run db:verify
```

**시도해볼 해결책** (둘 다 GUI 전용, `rdctl` 로는 설정 불가):
1. Preferences → Application → **Administrative Access 켜기** — 소켓 프록시가 권한 부족으로 죽는 것일 수 있다
2. Preferences → WSL → Integrations → **Ubuntu 체크** — Ubuntu 셸에서 `docker compose` 를 쓸 수 있게 된다

## 커밋 규칙

- 한 커밋 = 한 가지 변경. 작게 자주.
- 커밋 메시지는 한국어로 쓰되 prefix는 영어를 쓴다: `feat:` `fix:` `chore:` `docs:` `refactor:` `test:` `ci:`
- 기능 커밋에는 해당 F-ID를 본문에 남긴다 (예: `F-14-01`).
- `main`에 직접 푸시하지 않는다. 작업 브랜치 → PR.
