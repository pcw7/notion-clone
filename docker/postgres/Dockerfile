# PostgreSQL + pg_bigm
#
# pg_bigm 은 공식 postgres 이미지에 없고 apt 패키지도 배포되지 않으므로 직접 빌드한다.
# 한국어 검색이 여기에 걸려 있다 — to_tsvector('simple') 은 CJK 를 토큰으로 쪼개지 못한다.
# 근거: docs/notion-feature-research.md §6.5, §9-Q5
#
# 이 결정을 미루면 나중에 인덱스 전체를 재구축해야 한다.

ARG POSTGRES_VERSION=16
FROM postgres:${POSTGRES_VERSION}-bookworm

# 최신 안정 태그: https://github.com/pgbigm/pg_bigm/tags
ARG PG_BIGM_VERSION=1.2-20250903
ARG POSTGRES_VERSION=16

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential \
        "postgresql-server-dev-${POSTGRES_VERSION}" \
        curl \
        ca-certificates; \
    \
    curl -fsSL -o /tmp/pg_bigm.tar.gz \
        "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz"; \
    mkdir -p /tmp/pg_bigm; \
    tar -xzf /tmp/pg_bigm.tar.gz -C /tmp/pg_bigm --strip-components=1; \
    \
    cd /tmp/pg_bigm; \
    make USE_PGXS=1; \
    make USE_PGXS=1 install; \
    \
    # 빌드 도구는 이미지에 남기지 않는다
    cd /; \
    rm -rf /tmp/pg_bigm /tmp/pg_bigm.tar.gz; \
    apt-get purge -y --auto-remove \
        build-essential \
        "postgresql-server-dev-${POSTGRES_VERSION}" \
        curl; \
    rm -rf /var/lib/apt/lists/*

# 설치 검증 — 확장 파일이 없으면 빌드 단계에서 실패시킨다.
# 컨테이너를 띄우고 CREATE EXTENSION 이 깨지는 것보다 여기서 죽는 편이 낫다.
RUN test -f "$(pg_config --sharedir)/extension/pg_bigm.control" \
 && test -f "$(pg_config --pkglibdir)/pg_bigm.so"
