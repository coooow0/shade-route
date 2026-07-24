# PR 2 — OSM 보행 접근·방향 안전성

작성일: 2026-07-15  
상태: 구현·서울 데이터 재생성 완료, 커밋 전  
범위: OSM 보행 가능성 판정, 제한 노드, 보행 방향, fallback 도로 비용

## 결론

PR 2는 사용자를 사유지·허가제 통로·잠긴 게이트·역방향 에스컬레이터로 안내할 수 있던 네 가지 경로 정확도 문제를 막는다. 이 문제들은 인증 정보 유출이나 원격 코드 실행이 아니라 보행 안전과 무단 진입 위험에 해당한다. 모두 특정 지도 데이터와 출발지·도착지 조합이 필요하므로 심각도는 `Medium`으로 판정했다.

수정 전 서울 타일에는 공개 통행 제한이 명확한 way가 최소 102개 포함됐다. 제한 태그는 compact 타일 생성 과정에서 사라졌고, 앱은 이를 일반 `footway`로 복원해 A* 후보로 사용했다. 제한 노드와 보행 방향도 같은 방식으로 유실됐다.

PR 2는 다음 방어를 적용한다.

- 생성기와 런타임이 하나의 보행 판정 모듈을 사용한다.
- manifest schema 2가 제외 way, 차단 노드, fallback way, 보행 방향을 필수 정책으로 전달한다.
- 새 타일에서는 제한 way를 제거하고, 예전 schema 2 타일이 캐시에 남아 있어도 로딩 단계에서 다시 제거한다.
- 그래프는 제한 노드에 닿는 세그먼트를 만들지 않는다.
- A*는 `forward`와 `backward`를 강제하며, 간선을 가상 노드로 나눈 뒤에도 방향을 유지한다.
- 스냅, 컴포넌트 선택, 모든 경로 모드가 fallback 도로에 같은 1.5배 비용을 적용한다.

## 위협 모델과 실제 경로

신뢰 경계는 외부 OSM PBF와 앱이 사용하는 로컬 경로 그래프 사이다. 공격자가 앱 세션에 직접 데이터를 주입할 수는 없다. 그러나 잘못된 OSM 태그, 악의적인 지도 편집, 오래된 스냅샷, 또는 제한 태그를 무시한 컴파일러가 배포 타일에 영향을 줄 수 있다.

```text
OSM PBF의 access/foot/barrier/conveying 태그
  → 서울 데이터 생성기
  → 제한 태그가 없는 compact 타일
  → 앱이 모든 way를 footway/steps로 복원
  → 양방향 그래프와 A*
  → 사용자에게 제한 구간을 실제 도보 경로로 표시
```

공격 또는 오동작에는 다음 조건이 모두 필요하다.

1. 제한 구간이 선택한 출발지와 도착지 사이의 로딩 corridor에 들어온다.
2. 스냅된 그래프에서 그 구간이 더 짧거나 그늘 비용이 낮다.
3. 사용자가 앱 결과를 실제 보행 경로로 따른다.

## 발견 1 — 제한 way가 일반 보행로로 복원됨

- 심각도: `Medium`
- 상태: 수정 완료
- 정확한 위치:
  - 수정 전 기준 `010e6e3`: `scripts/seoul-compiler-core.mjs:129-188`
  - 수정 전 기준 `010e6e3`: `scripts/build-seoul-tiles.mjs:236-264`
  - 수정 전 기준 `010e6e3`: `src/domain/routing/tileRouteData.ts:233-252`
  - 현재 판정: `src/domain/routing/walkability.mjs:115-149`
  - 현재 생성·정책 수집: `scripts/build-seoul-tiles.mjs:246-288`
  - 현재 캐시 타일 필터: `src/domain/routing/tileRouteData.ts:279-307`, `438-455`

### 공격 조건과 실제 경로

PBF에 `foot=private`, `foot=permit`, `foot=use_sidepath`, 또는 공개 통행을 허용하지 않는 `access=*`가 있는 way가 필요하다. 수정 전 생성기는 일부 `no/private`만 확인했다. 그 뒤 타일은 `covered`, `steps`, `fallback` 세 플래그만 저장했고, 런타임은 모든 way를 일반 `footway` 또는 `steps`로 만들었다. A*는 제한 정보를 볼 수 없어서 해당 way를 선택했다.

### 코드 근거와 재현 증거

동일 PBF와 기존 public 타일을 대조했을 때 명확한 제한 way가 최소 102개, 744개 세그먼트, 약 14.48km 포함돼 있었다. 여기에는 일반 접근 제한 97개와 구체적인 보행 제한 6개가 포함되며 1개는 겹친다. 수정 전 타일 레코드를 `buildGraph → astar`로 전달한 회귀 재현에서 경로 생성이 성공했다.

현재 코드는 구체적인 `foot=*`를 일반 `access=*`보다 우선한다. `yes`, `designated`, `permissive`만 공개 보행으로 인정하며, 조건부 접근·폐기 상태·고난도 산길·방향 불명 상태는 제외한다. 새 manifest에는 현재 판정에서 제외된 2,073개 way가 기록돼 구 타일 캐시도 차단한다.

### 오탐 가능성

- `foot=yes/designated/permissive`는 일반 `access=private/no`를 덮어쓰므로 유지한다.
- `access=permissive` 252개는 공개 보행 후보로 유지한다.
- `access=unknown` 3개와 허용 조건만 가진 conditional 태그는 실제로 통행 가능할 수 있다. 앱에 시간·조건 평가기가 없으므로 이번 PR은 fail-closed로 제외한다.
- `construction=*`가 정상 `highway=*`와 함께 남은 44개는 공사 중이라고 단정하지 않는다. `highway=construction`만 기존 지원 목록 밖에 둔다.
- `smoothness=impassable`과 `ford=*`는 보행 불가를 뜻한다고 단정하지 않아 일괄 차단하지 않는다.

### 최소 수정과 보안 테스트

최소 수정은 판정을 단일 모듈로 통합하고, 제외 ID를 manifest에 넣어 타일 확장 전에 필터링하는 것이다. `scripts/seoul-compiler-core.test.mjs:36-82`가 제한 값, 구체 태그 우선순위, conditional, lifecycle, 산길 경계를 검증한다. `src/domain/routing/tileRouteData.test.ts:144-228`은 캐시 타일 제거와 구 manifest fail-closed를 검증한다. `src/domain/routing/realWalkingPolicy.test.ts:24-55`는 실제 812개 타일 전체에서 제외 ID가 남지 않았음을 검사한다.

## 발견 2 — 제한 게이트·노드 태그가 유실됨

- 심각도: `Medium`
- 상태: 수정 완료
- 정확한 위치:
  - 수정 전 기준 `010e6e3`: `scripts/build-seoul-tiles.mjs:222-225`, `258-264`
  - 현재 노드 판정: `src/domain/routing/walkability.mjs:162-173`
  - 현재 정책 수집: `scripts/build-seoul-tiles.mjs:231-235`, `271-278`
  - 현재 그래프 차단: `src/domain/routing/graph.ts:77-87`

### 공격 조건과 실제 경로

way 자체는 공개 보행로지만 중간 노드에 `access=no/private/permit`, `foot=no/permit`, 또는 `locked=yes`가 있어야 한다. 수정 전 생성기는 노드의 좌표만 남겨 제한 태그를 버렸다. 따라서 A*는 잠긴 문이나 제한 게이트를 연결점으로 사용할 수 있었다.

### 코드 근거와 재현 증거

PBF에는 명시적 제한 노드 123개가 기존 보행 후보 way 144개에서 150회 참조됐다. PR 2가 제한 way를 먼저 제거한 뒤에도 실제로 사용되는 114개 제한 노드가 남았고, manifest 정책에 기록됐다. 그래프 생성기는 이 노드에 닿는 양쪽 세그먼트를 생략한다.

### 오탐 가능성

`barrier=gate`나 `barrier=bollard`만으로 통행 금지를 추정하지 않는다. 구체적인 접근 제한이나 잠금 태그가 있을 때만 차단한다. 노드의 `foot=permissive`는 일반 `access=private`를 덮어쓰므로 허용한다.

### 최소 수정과 보안 테스트

노드 전체 태그를 타일마다 복제하지 않고, 실제 보행 way가 참조하는 차단 노드 ID만 manifest에 저장한다. `scripts/seoul-compiler-core.test.mjs:111-124`가 제한과 허용 경계를, `src/domain/routing/graphWalkingPolicy.test.ts:54-67`이 차단 노드에 닿는 세그먼트 제거를, 실제 산출물 검사는 114개 ID가 방출된 노드만 참조하는지 확인한다.

## 발견 3 — 보행 방향과 에스컬레이터 방향을 무시함

- 심각도: `Medium`
- 상태: 수정 완료
- 정확한 위치:
  - 수정 전 기준 `010e6e3`: `src/domain/routing/types.ts:30-40`
  - 수정 전 기준 `010e6e3`: `src/domain/routing/router.ts:131-147`
  - 현재 태그 판정: `src/domain/routing/walkability.mjs:79-113`
  - 현재 edge 전달: `src/domain/routing/graph.ts:70-76`, `113-123`
  - 현재 A* 강제: `src/domain/routing/router.ts:131-140`

### 공격 조건과 실제 경로

`oneway:foot`, `foot:forward/backward`, 또는 방향이 정해진 `conveying` way가 경로에 있어야 한다. 수정 전 `Edge`에는 방향 필드가 없었고 adjacency와 A*는 모든 edge를 양방향으로 이동했다. 사용자는 역방향 에스컬레이터나 명시적 보행 일방통행으로 안내될 수 있었다.

### 코드 근거와 재현 증거

현재 PBF에는 `conveying=forward` 6개와 `conveying=backward` 1개가 있다. 수정 전 A* 단위 재현은 두 방향 모두 성공했다. PR 2는 이 7개 way 방향을 manifest에 기록하고, A*가 허용 방향에서만 이웃 노드로 이동하게 한다.

### 오탐 가능성

- 일반 차량용 `oneway=yes` 10,855개는 보행 방향으로 사용하지 않는다.
- 현재 스냅샷에는 `oneway:foot`이 없다. 테스트는 다음 데이터 갱신에서 생길 회귀도 막는다.
- `conveying=yes` 49개와 `conveying=reversible` 1개는 방향을 확정할 수 없어 제외한다. 이 선택은 지하철 내부 연결성을 낮출 수 있지만 역방향 안내보다 안전하다.

### 최소 수정과 보안 테스트

방향은 `forward/backward` 두 값만 정책으로 전달한다. `src/domain/routing/routerDirection.test.ts:30-64`는 정·역방향과 간선 분할 후 방향 보존을 검증한다. `src/domain/routing/graphWalkingPolicy.test.ts:69-82`는 컴파일러 방향이 모든 세그먼트에 붙는지 확인한다.

## 발견 4 — 빠른길이 fallback 안전 비용을 무시함

- 심각도: `Medium`
- 상태: 수정 완료
- 정확한 위치:
  - 수정 전 기준 `010e6e3`: `src/domain/routing/routeService.ts:146-154`, `194-203`
  - 현재 공통 비용: `src/domain/routing/safetyPolicy.ts:1`, `src/domain/routing/routeService.ts:146-172`, `194-206`
  - 현재 스냅 비용: `src/domain/routing/graph.ts:239-273`
  - A* 비용 반영: `src/domain/routing/router.ts:142-148`

### 공격 조건과 실제 경로

보행 공간이 명확한 짧은 우회로와 더 짧은 fallback 도로가 동시에 있어야 한다. 수정 전 미리보기와 `빠른길`은 multiplier 1을 넘겨 fallback 표시를 무시했다. 첫 보완 뒤에도 컴포넌트 선택은 물리 길이만 비교하고 스냅은 기하학적 최근접만 비교해 안전 비용을 우회할 수 있었다.

### 코드 근거와 재현 증거

현재 데이터에는 fallback way 11,157개가 있다. 합성 그래프에서 fallback 직선과 약간 긴 보행 우회로를 만들면 수정 전 빠른길은 직선을 선택했다. 별도 컴포넌트 두 개를 스냅할 때도 물리 길이가 짧은 fallback 컴포넌트가 고정됐다. PR 2는 스냅 거리, 미리보기 컴포넌트, 세 경로 모두 1.5배 비용을 사용한다.

### 오탐 가능성

fallback은 통행 금지가 아니다. 안전한 대안이 없으면 경로 연결성을 위해 선택될 수 있다. 스냅에서 non-fallback을 무조건 우선하면 1m 옆 fallback 대신 건물 너머 149m 보행로로 직선 connector를 만들 수 있으므로 같은 1.5배 유한 비용을 쓴다. 보행 공간 없이 `sidewalk=separate`만 있는 primary~tertiary 본선 261개는 fallback으로 남기지 않고 완전히 제외했다. `foot=use_sidepath`도 명시적 의무이므로 제외한다.

### 최소 수정과 보안 테스트

호출부마다 다른 숫자를 넘기지 않고 `FALLBACK_ROAD_MULTIPLIER` 하나를 스냅, 미리보기, 컴포넌트 선택, 모든 모드에 사용한다. `src/domain/routing/routeService.test.ts:7-106`이 우회로와 분리 컴포넌트를, `src/domain/routing/graphWalkingPolicy.test.ts:94-136`이 가까운 안전길과 지나치게 먼 안전길의 경계를 검증한다.

## 남은 발견 — endpoint connector는 접근 통제를 검증하지 않음

- 심각도: `Medium`
- 상태: 이번 PR에서 미해결, 후속 설계 필요
- 정확한 위치: `src/domain/routing/routeService.ts:65-113`, `128-142`

### 공격 조건과 실제 경로

사유지나 제한 구역 안의 POI·주소가 목적지로 선택되고 공개 그래프가 150m 안에 있어야 한다. PR 2는 그래프 way와 노드를 차단하지만, 스냅 지점부터 실제 출발지·목적지까지의 connector는 두 좌표를 직선으로 잇는다. 이 선은 제한 way, barrier, 건물 경계와의 교차를 검사하지 않는다.

### 코드 근거

`connectorSegment`는 두 좌표의 거리만 계산하고, `addAccessConnectors`는 시작과 끝 connector를 결과에 그대로 붙인다. 이름 장소는 최대 150m, 현재 위치는 최대 100m까지 스냅할 수 있다. 동일 PBF와 `places.json`을 대조하면 명시적 제한 태그가 붙은 검색 장소 36개가 남아 있고, 36개 모두 방출 보행 노드 150m 안에 있었다. 따라서 제한 그래프를 통과하지 않더라도 마지막 접근 선이 사유지나 잠긴 게이트를 가로지를 수 있다.

### 오탐 가능성

OSM에 짧은 건물 진입로가 빠졌거나 `customers/destination`이 실제 endpoint 접근을 허용하는 경우 connector가 올바른 근사일 수 있다. 모든 connector를 제거하거나 수십 m로 일괄 축소하면 정상 장소 검색 성공률이 크게 떨어진다.

### 최소 수정과 필요한 테스트

완전한 수정에는 제외 way의 geometry, barrier 위치, 목적지의 endpoint 접근 등급을 스냅 단계까지 보존해야 한다. 후속 PR은 connector와 제한 geometry의 교차를 거부하고, `customers/destination` endpoint 예외와 공개 출입구를 함께 모델링해야 한다. private/no 구역 내부 POI, 공개 출입구가 있는 고객 시설, OSM 진입로가 빠진 정상 건물을 각각 통합 테스트해야 한다.

## 데이터 재생성 결과

사용한 원본은 `/private/tmp/south-korea-latest.osm.pbf`다.

- 파일 크기: 282,641,335 bytes
- 파일 수정 시각: 2026-07-11 19:00:42 +0900
- SHA-256: `828c27e48293061e4187b068052f711c9926837f3b85c4245e95e052f35c4e77`
- 다운로드 URL과 실제 다운로드 시각: 확인 불가. 파일 해시로 이번 입력만 고정했다.

재생성 산출물:

| 항목                            |             결과 |
| ------------------------------- | ---------------: |
| 타일                            |            812개 |
| unique way                      |        115,236개 |
| 타일 총 크기                    | 57,282,527 bytes |
| 최대 타일                       |    451,254 bytes |
| manifest                        |    256,505 bytes |
| 정책 제외 way                   |          2,073개 |
| 차단 노드                       |            114개 |
| fallback way                    |         11,157개 |
| 방향 way                        |              7개 |
| 변경된 기존 타일                |            144개 |
| 이전 타일에서 제거된 unique way |            170개 |
| 새 판정으로 추가된 unique way   |              1개 |

제거된 170개에는 제한 접근, 조건부 접근, 폐기 상태, 방향 불명, 고난도 산길이 포함된다. 정밀 판정에서 공개 통행으로 확인된 1개만 새로 포함했다. unique way는 115,405개에서 115,236개로 169개 줄었다.

## 호환성과 성능

- 타일 payload schema는 2를 유지한다. 안전 정책은 약 256KB manifest에 들어가므로 추가 네트워크 요청이 없다.
- 구 런타임은 manifest schema 2를 거부한다. 새 정책을 무시하고 안전하지 않은 경로를 만드는 대신 로딩 실패로 끝난다.
- 새 런타임은 구 schema 2 타일을 받더라도 제외 way를 객체 확장 전에 제거하고 새 fallback 플래그를 덮어쓴다.
- 구 캐시 타일이 새 파일보다 커도 파일당 2MB까지 읽되, 실제 수신한 경로 타일 합계 12MB를 다시 검사한다. 새 manifest의 작은 byte 값으로 안전 검사를 우회하거나 정상 캐시를 잘못 거부하지 않는다.
- 정책 배열은 종류별 최대 20,000개, 오름차순, 중복 없음, 양의 안전 정수로 검증한다. 잘못된 정책은 `INVALID_TILE_MANIFEST`로 거부한다.
- 앱은 manifest를 `Set`과 `Map`으로 한 번 변환한다. 그래프 생성은 ID 조회를 평균 O(1)에 수행하고, A*는 edge마다 방향 분기 하나를 추가한다.
- 실제 타일 수와 최대 타일 크기는 PR 1 자원 상한 안에 남았다.

## 검증

완료한 검증:

- 최초 실패 테스트: 제한 접근 5건, 방향 2건 실패 확인
- PR 2 보행 판정·정책·그래프·라우터·캐시·실제 산출물 집중 테스트 39개 통과
- 실제 서울 대표 8개 경로, 강남 경로, 전체 정책 12개 테스트 통과
- 실제 812개 타일 전체 정책 일관성 테스트 통과
- TypeScript와 ESLint 통과
- 전체 32개 파일, 191개 테스트 통과
- 커버리지: 문장 87.50%, 분기 83.60%, 함수 92.87%, 라인 91.42%
- 앱인토스 프로덕션 빌드 통과, `shade-route.ait` 23,069,840 bytes
- minified JavaScript 1,476.76KB, gzip 471.01KB. 500KB 청크 권장 크기 경고는 기존과 같이 남아 있으며 PR 2의 보행 정책 변경으로 의미 있게 증가하지 않았다.

## 남은 위험과 다음 PR

- conditional 접근을 실제 요일·시각으로 평가하지 않는다. 현재는 모두 제외해 안전 쪽으로 실패한다.
- `conveying=yes/reversible`의 실시간 방향을 알 수 없어 제외한다.
- OSM 태그와 현장 상태가 다르면 여전히 잘못된 경로가 나올 수 있다. 사용자 화면의 현장 차이 안내를 유지한다.
- endpoint connector는 제한 geometry와 교차하는지 검사하지 않는다. 위 미해결 발견을 후속 접근 모델에 포함한다.
- 가장 가까운 edge가 목적지 방향과 반대인 경우 같은 weak component의 두 번째 스냅 후보를 다시 찾지 않는다. 잘못된 역방향 경로 대신 `SNAP_FAILED`로 종료되므로 안전상 fail-closed지만 검색 성공률을 낮출 수 있다.
- manifest와 타일은 정적 자산이지만 암호학적으로 서로 묶여 있지 않다. 배포 자산 변조·부분 업데이트·provenance 검증은 PR 3의 artifact integrity 범위다.
- 이 PR은 의존성 경고를 변경하지 않는다. 앱인토스/Granite 도구 체인 업데이트는 별도 PR에서 처리한다.

## OSM 판정 근거

- [Access 계층과 구체적 이동수단 태그 우선순위](https://wiki.openstreetmap.org/wiki/Access)
- [Conditional restrictions](https://wiki.openstreetmap.org/wiki/Conditional_restrictions)
- [oneway:foot](https://wiki.openstreetmap.org/wiki/Key%3Aoneway%3Afoot)
- [conveying 방향](https://wiki.openstreetmap.org/wiki/Key%3Aconveying)
- [Sidewalk와 separate 표현](https://wiki.openstreetmap.org/wiki/Sidewalk)
- [foot=use_sidepath](https://wiki.openstreetmap.org/wiki/Compulsory_use_of_parallel_way)
- [sac_scale=mountain_hiking](https://wiki.openstreetmap.org/wiki/Tag%3Asac_scale%3Dmountain_hiking)
