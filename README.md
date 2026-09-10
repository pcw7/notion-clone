# notion-clone

[![CI](https://github.com/pcw7/notion-clone/actions/workflows/ci.yml/badge.svg)](https://github.com/pcw7/notion-clone/actions/workflows/ci.yml)

노션과 같은 기능을 하는 웹 애플리케이션. **TypeScript + Next.js**로 만듭니다.

> 코드보다 기획이 먼저 끝났습니다. 기능 **278개**를 조사·명세하고, 문서 간 모순 **26건**을 판결해 스키마 정본을 확정한 뒤, **MVP 65개 / 6~8주**로 잘라낸 상태에서 시작했습니다.

---

## 진행 상황 — Phase 0 (MVP)

| 주차 | 내용 | 상태 |
|---|---|---|
| **W1** | 스키마 · 인증 | ✅ 테이블 20개 · ENUM 6개 · 뷰 1개 |
| **W2** | 계약 고정 | ✅ capability 모델 · `SessionContext` · DB 접근 계층 |
| W3–4 | 블록 모델 · 에디터 코어 | 예정 |
| W5 | 페이지 트리 + 편집 확장 | 예정 |
| W6 | 내비게이션 + 권한 | 예정 |
| W7 | 검색 | 예정 |
| W8 | DB 코어 + 뷰 | 예정 |

지금까지: 마이그레이션 4개, 테스트 31개, CI 2잡(타입·린트·라이선스·빌드 / 스키마·불변식).

---

## 이 저장소에서 특이한 것

**ORM을 쓰지 않습니다.** 정본 스키마가 부분 인덱스 · `GIN on uuid[]` · 생성 컬럼 · 파티셔닝 · **DEFERRABLE 순환 FK**를 씁니다. 스키마를 소유하려는 ORM은 이것들을 표현하지 못하거나 매번 싸웁니다. 스키마는 SQL로 쓰고 애플리케이션은 읽기만 합니다. 마이그레이션 러너([`scripts/migrate.mjs`](scripts/migrate.mjs))도 외부 의존성 없이 직접 만들었고, **적용된 파일이 수정되면 체크섬으로 실행을 거부**합니다.

**권한 레벨은 전순서가 아닙니다.** `create`는 `view`를 포함하지 않습니다 — 폼 제출처럼 "내용은 못 보면서 추가만" 하는 경우가 있기 때문입니다. 레벨을 정수로 매겨 `MAX`를 취하면 권한이 틀어지므로, [`levels.ts`](src/lib/permissions/levels.ts)는 **레벨 비교 함수를 의도적으로 제공하지 않습니다.** 판정의 진실은 capability 비트마스크이고, 물을 수 있는 건 `can(caps, 'edit_content')` 하나뿐입니다.

**`SessionContext`를 갖고 있다는 것 자체가 권한의 증명입니다.** 브랜디드 타입이라 리터럴로 만들 수 없고 `resolveSessionContext()`만 발급하는데, 그 함수가 발급 전에 SSO 게이트를 통과시킵니다. 그래서 `userId`만 받는 권한 함수를 만드는 실수를 저지를 수 없습니다.

**검증은 "생겼는가"가 아니라 "실제로 막는가"를 봅니다.** `CHECK`을 걸어놓고 동작을 확인하지 않으면 걸지 않은 것과 같습니다. [`verify-schema.mjs`](scripts/verify-schema.mjs)는 위반 INSERT를 실제로 던져보고 거부되는지 확인합니다.

**무료 라이브러리만 씁니다.** [`check-licenses.mjs`](scripts/check-licenses.mjs)가 CI에서 AGPL · SSPL · RSAL · BUSL · GPL · LGPL · 라이선스 미상을 거부합니다. 검사기 자체도 **외부 의존성 0개** — 라이선스 검사기를 넣자고 라이선스 불분명한 패키지를 하나 더 다는 건 자기모순이라서요.

---

## 구조

```
docs/                        기획 (3.3MB)
  notion-feature-research.md   마스터 의사결정 문서
  research/
    00-canonical-data-model.md 스키마 정본 (테이블 73개)
    00-feature-ownership.md    F-ID 인벤토리 · MVP 목록
    01~17-*.md                 도메인 상세
    _canon/ _critique/         판결문 · 커버리지 비평

db/migrations/               raw SQL. ORM 없음
  0001_workspace_foundation    공통 타입 · region · organization · workspace
  0002_auth_accounts           user · 이메일 · 자격증명 · MFA · 세션 · SSO · 감사
  0003_membership              workspace_member · group · 좌석 계산 뷰
  0004_level_capability        레벨 → capability 매트릭스

src/lib/
  ids.ts                       브랜디드 ID
  db/{pool,tx}.ts              커넥션 풀 · 트랜잭션
  permissions/levels.ts        capability 모델 (MAX_BY_CAP)
  auth/session-context.ts      SessionContext · SSO 게이트

scripts/                      전부 의존성 없는 .mjs
  migrate.mjs                  마이그레이션 러너
  verify-db.mjs                확장 · collation · 한국어 2-gram
  verify-schema.mjs            스키마 + 불변식이 실제로 거부하는지
  check-licenses.mjs           라이선스 정책 강제
  dc.mjs                       docker compose 래퍼 (Windows→WSL)
```

---

## 문서

| 문서 | 내용 |
|---|---|
| [**마스터 기능 명세서**](docs/notion-feature-research.md) | 전체 인벤토리 · 통합 데이터 모델 · 의존 그래프 · 로드맵 · 스택 · 리스크 TOP 7 · 만들지 않을 것 20개 |
| [**정본 데이터 모델**](docs/research/00-canonical-data-model.md) | 테이블 73개. 스키마의 유일한 정답지 |
| [**기능 소유권**](docs/research/00-feature-ownership.md) | F-ID 전수 인벤토리, 확정 난이도/우선순위, MVP 목록 |
| [도메인 상세 01~17](docs/research/) | 블록 에디터 · DB · 권한 · 협업 · 검색 · AI 등 |
| [판결문](docs/research/_canon/) · [커버리지 비평](docs/research/_critique/) | 스키마 모순을 어떻게 판결했는지의 근거 |
| [CLAUDE.md](CLAUDE.md) | 절대 제약 · 코딩 규칙 · 알려진 문제 |
| [**인수인계**](docs/HANDOFF.md) | 진행 위치 · 다음 작업 · 내린 판결 · 세션 운영 요령 |

---

## 로드맵

| Phase | 목표 | 기간 | 기능 |
|---|---|---|---|
| **0** | MVP — 혼자 쓰는 노션 | 6~8주 | 65 |
| **1** | 협업 — 둘이 쓰는 노션 | 6주 | 47 |
| **2** | 제품화 — 팀이 쓰는 노션 | 12주 | 89 |
| **3** | 확장 · 엔터프라이즈 | 12주+ | 49 |

---

## 스택

```
Next.js 16 (App Router) + TypeScript
  ├─ 에디터   Tiptap v3 (ProseMirror)      — MIT          (W3~)
  ├─ 협업     Yjs + y-prosemirror           — MIT          (Phase 1)
  │           Hocuspocus 자체 호스팅        — MIT
  ├─ UI       TanStack Query/Table/Virtual  — MIT
  │           Radix UI · dnd-kit            — MIT
  ├─ DB       PostgreSQL 16 + pg_bigm       — PostgreSQL License
  ├─ 캐시·큐  Valkey + BullMQ               — BSD-3 / MIT
  └─ 파일     S3 호환 (Cloudflare R2)
```

**pg_bigm이 필수입니다.** `to_tsvector('simple')`은 CJK를 토큰으로 쪼개지 못해 한국어 검색이 통째로 죽습니다. 공식 이미지에 없어서 [소스로 빌드](docker/postgres/Dockerfile)합니다. DB collation도 ICU + `ko-KR`로 초기화하는데, **한 번 정하면 인덱스 재구축 없이는 못 바꿉니다.**

선택 근거와 **탈락 이유**는 [마스터 문서 §6](docs/notion-feature-research.md)에 있습니다.

---

## 개발

**사전 준비 (Windows)** — WSL2 Ubuntu 안에 Docker Engine을 설치합니다. Windows 쪽에는 docker를 설치하지 않습니다.

```powershell
wsl --install            # 관리자 PowerShell, 이후 재부팅
```

```bash
wsl -d Ubuntu -u root -- apt-get update
wsl -d Ubuntu -u root -- apt-get install -y docker.io docker-compose-v2
wsl -d Ubuntu -u root -- systemctl enable --now docker
wsl -d Ubuntu -u root -- usermod -aG docker $USER
```

Docker Desktop을 쓰지 않는 이유는 라이선스입니다 — 조건부 무료라서요. Rancher Desktop(Apache-2.0)도 시도했지만 이 환경에서 Windows↔WSL 브리지가 깨져 포기했습니다. 경위는 [CLAUDE.md](CLAUDE.md).

**실행**

```bash
npm install
cp .env.example .env        # AUTH_SECRET 을 생성해 채운다

npm run db:up               # postgres(pg_bigm) + valkey, healthy 까지 대기
npm run db:migrate          # 마이그레이션
npm run dev                 # http://localhost:3000
```

**검증**

```bash
npm run check               # typecheck + lint + license + test
npm test                    # 단위 테스트 (DB 없으면 DB 테스트는 skip)
npm run db:verify           # 확장 · ICU collation · 한국어 2-gram · Valkey
npm run db:verify:schema    # 스키마 + 불변식이 실제로 거부하는지
npm run db:migrate:status
npm run db:reset            # 볼륨 삭제 → 재생성 → 마이그레이션
```

> WSL2는 살아 있는 WSL 세션이 하나도 없으면 VM을 내립니다. 그러면 Postgres·Valkey도 같이 멈춰서 앱이 `ECONNREFUSED`를 맞습니다. `npm run db:up`이 **세션 유지 프로세스를 자동으로 띄우므로** 그럴 일이 없습니다 — `npm run db:down`이 정리하고, 끄려면 `WSL_KEEPALIVE=0`을 주면 됩니다. (`.wslconfig`의 `vmIdleTimeout=-1`은 WSL 2.7.13에서 동작하지 않는 것을 확인했습니다.)

---

## 원칙

**무료 라이브러리만 씁니다.** MIT · BSD · Apache-2.0 · ISC · PostgreSQL License만 허용하고, AGPL · SSPL · RSAL · 유료 SaaS 의존은 금지합니다. CI가 자동으로 검사합니다.

**LLM 토큰은 하드 캡입니다.** 한도를 넘으면 자동 결제 없이 차단합니다. 자동 충전도, 초과분 후불 청구도 하지 않습니다. 이 게이트는 AI 기능 첫 커밋과 **반드시 동시에** 들어갑니다.

**정본이 이긴다.** 스키마를 바꿔야 한다고 판단되면 코드가 아니라 [정본 문서](docs/research/00-canonical-data-model.md)를 먼저 고치고 판결 근거를 남깁니다.

자세한 건 [CLAUDE.md](CLAUDE.md).
