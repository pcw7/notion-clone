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

**[`docs/HANDOFF.md`](docs/HANDOFF.md)** — 지금 어디까지 왔고 다음에 뭘 하는가. 세션을 이어받을 때 CLAUDE.md 다음으로 읽는다.

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
  - **컨테이너 런타임은 WSL2 Ubuntu 안의 Docker Engine (`docker.io`, Apache-2.0).** Docker Desktop은 개인·교육·비영리 OSS·소규모 사업자(250명 미만 AND 연매출 $10M 미만)만 무료인 **조건부** 무료다. Rancher Desktop(Apache-2.0)을 먼저 시도했으나 이 환경에서 Windows↔WSL 브리지가 깨져 포기했다(아래 "알려진 문제"). Ubuntu 안에 직접 설치하면 그 브리지 자체를 안 거친다.

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

런타임: **WSL2 Ubuntu 안의 Docker Engine**. Windows 쪽에는 docker를 설치하지 않는다.

```bash
# 최초 1회 — WSL2 + Ubuntu + Docker Engine
wsl --install                                            # 관리자 PowerShell, 이후 재부팅
wsl -d Ubuntu -u root -- apt-get update
wsl -d Ubuntu -u root -- apt-get install -y docker.io docker-compose-v2
wsl -d Ubuntu -u root -- systemctl enable --now docker
wsl -d Ubuntu -u root -- usermod -aG docker $USER

# 이후
npm install
cp .env.example .env    # AUTH_SECRET 은 직접 생성해 채운다

npm run db:up           # postgres(pg_bigm) + valkey 기동
npm run db:verify       # 확장 · collation · 한국어 2-gram · valkey 확인
npm run dev             # http://localhost:3000

npm run db:migrate      # 미적용 마이그레이션 실행
npm run db:migrate:status
npm run db:verify:schema # 스키마가 정본대로인지 + 불변식이 실제로 거부하는지

npm run check           # typecheck + lint + license
npm run db:reset        # 볼륨 삭제 → 재생성 → 마이그레이션
npm run dc -- <args>    # 임의의 docker compose 명령
```

> **WSL2는 유휴 상태가 되면 VM을 내린다.** 컨테이너도 함께 멈췄다가 다음 `db:up` 에서 복구된다. 작업을 시작할 때 `npm run db:up` 을 한 번 치면 healthy까지 기다려준다.
>
> `.wslconfig` 의 `vmIdleTimeout=-1` 은 **WSL 2.7.13 에서 동작하지 않는 것을 확인했다** (`[wsl2]`·`[experimental]` 양쪽 다 시도, 90초 유휴 후 여전히 내려감). 안 되는 설정을 남겨두면 나중에 원인을 오해하게 되므로 넣지 않는다.
>
> DB가 필요한 테스트는 접속 실패 시 **건너뛴다.** CI의 `db` 잡은 `REQUIRE_DB=1` 로 돌려서 건너뛰지 못하게 한다 — 조용히 skip 되기만 하면 그 테스트는 썩는다.

`db:*` 스크립트는 [`scripts/dc.mjs`](scripts/dc.mjs)를 거친다. Windows에서는 `wsl -d Ubuntu` 안에서 실행하고, Linux·macOS에서는 `docker`를 그대로 호출한다. 컨테이너가 발행한 포트는 WSL2 localhost 포워딩으로 Windows의 `localhost:5432` · `localhost:6379`에 그대로 도달한다.

DB collation은 **한 번 정하면 못 바꾼다.** ICU + `ko-KR`로 초기화하므로, 이미 만든 볼륨이 있다면 `db:reset` 후에 적용된다.

### 왜 Rancher Desktop을 쓰지 않는가 (이 환경에서 겪은 것)

Rancher Desktop 1.24.0을 먼저 설치했으나 WSL 2.7.13과의 조합에서 **Win32 socket proxy가 크래시-재시작 루프**를 돌았다.

- `docker` 명령이 기동 후 **40~50초만 동작**하다 `failed to connect to the backend: timed out dialing Hyper-V socket`으로 죽는다
- `%LOCALAPPDATA%\rancher-desktop\logs\background.log`에 `Background process Win32 socket proxy (pid ...) exited with status 1`이 1초 간격으로 반복
- `docker.log`가 226MB까지 부풀었다
- 레지스트리 `HKLM\...\Virtualization\GuestCommunicationServices`에 **Rancher Desktop의 vsock 서비스 GUID가 등록되지 않았다** (WSL 기본 2개만 존재). 관리자 권한으로 재실행해도 등록되지 않았다.
- Kubernetes 끄기, 백엔드 재시작, 관리자 실행 모두 효과 없음

컨테이너와 포트 포워딩은 멀쩡했으므로 문제는 **Windows↔WSL 제어 브리지 하나**였다. Ubuntu 안에 Docker Engine을 직접 설치하면 그 브리지를 아예 안 거친다.

이 경험이 남긴 설계 원칙 하나: **`scripts/verify-db.mjs`는 `docker compose exec`가 아니라 앱과 같은 TCP 경로로 접속한다.** 검증은 실제 사용 경로를 재현해야 한다 — 그렇지 않으면 DB가 멀쩡한데 죽었다고 잘못 보고한다. 실제로 그랬다.

## 스키마 마이그레이션

`db/migrations/NNNN_snake_case.sql` — raw SQL. ORM이 스키마를 소유하지 않는다.

정본 스키마가 부분 인덱스 · GIN on uuid[] · 생성 컬럼 · 파티셔닝 · DEFERRABLE 순환 FK를 쓰기 때문이다. 스키마를 소유하려는 ORM은 이것들을 표현하지 못하거나 매번 싸운다. **스키마는 SQL로 쓰고, 애플리케이션은 그것을 읽기만 한다.**

- 번호는 단조 증가하며 재사용하지 않는다.
- **적용된 마이그레이션 파일은 수정하지 않는다.** 러너가 체크섬을 검사해 어긋나면 실행을 거부한다. 고칠 것이 있으면 새 마이그레이션을 추가한다.
- 각 마이그레이션은 하나의 트랜잭션에서 돈다. `CREATE INDEX CONCURRENTLY` 처럼 트랜잭션 안에서 못 도는 것이 있으면 파일 첫 줄에 `-- migrate:no-transaction`.
- 각 파일 머리에 **정본 문서의 어느 절을 옮긴 것인지** 적는다.
- 표현 가능한 불변식은 `CHECK` · 부분 UNIQUE 인덱스로 **승격**한다. 주석으로만 남기지 않는다. 승격했으면 `scripts/verify-schema.mjs` 에 **거부되는지 확인하는 프로브**를 추가한다 — CHECK을 걸어놓고 동작을 확인하지 않으면 걸지 않은 것과 같다.

## 권한 코드 규칙

정본 §3.3 규칙 A2: **level 은 전순서가 아니다.** `create` 는 `view` 를 포함하지 않는다.

- 레벨을 정수로 매겨 비교하지 않는다. `src/lib/permissions/levels.ts` 는 레벨 비교 함수를 **의도적으로 제공하지 않는다.**
- 판정의 진실은 `CapSet`(capability 비트마스크)이다. 물어야 할 질문은 `can(caps, 'edit_content')` 뿐이다.
- `displayLevel()` 은 **화면 표시 전용**이다. 반환된 레벨을 판정에 다시 넣으면 안 된다. 올림하지 않고 부분집합 중 최대를 고르므로 과소 표시일 수 있다.
- 매트릭스는 DB(`level_capability`)와 TS 상수 두 곳에 있다. `levels.db.test.ts` 가 일치를 강제한다. 한쪽만 고치면 CI가 막는다.

정본 불변식 A9: **`effective()` 의 입력은 `user_id` 가 아니다.**

- 권한을 묻는 모든 함수는 `SessionContext` 를 받는다. `UserId` 만 받는 권한 함수를 만들지 않는다.
- `SessionContext` 는 브랜디드 타입이라 리터럴로 만들 수 없다. `resolveSessionContext()` 만 발급하고, 그 함수는 발급 전에 0단계 게이트(`can_enter_workspace`)를 통과시킨다.
- 따라서 **`SessionContext` 를 갖고 있다는 것 자체가 "이 사용자는 이 워크스페이스에 들어올 수 있다"는 증명**이다. 우회하려면 타입을 캐스팅해야 하고, 그건 리뷰에서 보인다.

## 커밋 규칙

- 한 커밋 = 한 가지 변경. 작게 자주.
- 커밋 메시지는 한국어로 쓰되 prefix는 영어를 쓴다: `feat:` `fix:` `chore:` `docs:` `refactor:` `test:` `ci:`
- 기능 커밋에는 해당 F-ID를 본문에 남긴다 (예: `F-14-01`).
- `main`에 직접 푸시하지 않는다. 작업 브랜치 → PR.
