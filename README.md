# shade-route

그늘길은 출발 시각의 건물 그림자를 계산해 햇빛 노출을 줄이는 서울 도보 경로를 추천하는 앱인토스 미니앱입니다.

서비스 목표, 현재 구현, 제품 결정과 다음 우선순위는 [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)에 정리되어 있습니다.

## 시작하기

```bash
npm ci
npm run dev
```

## 장소·주소 검색

- 서울 OSM 원본을 미리 컴파일한 약 5만 건의 로컬 인덱스를 사용해요.
- 지하철역, 카페, 음식점, 병원·약국, 회사, 학교·도서관, 공원, 건물명과 도로명 주소를 검색할 수 있어요.
- 검색어는 외부 장소 API로 전송하지 않고, API 키도 앱에 포함하지 않아요.

원본 PBF가 `/private/tmp/south-korea-latest.osm.pbf`에 있을 때 서울 경로·장소 데이터를 다시 만들 수 있어요.

```bash
npm run data:seoul
```

## 현재 날씨·자외선

- [Open-Meteo](https://open-meteo.com/)에서 현재 기온, 체감온도, 자외선 지수를 불러와 경로 추천에 반영해요.
- 날씨는 서울 대표 좌표로만 조회하며, 사용자의 현재 위치는 Open-Meteo에 보내지 않아요.
- 날씨 요청이 실패해도 장소 검색과 경로 계산은 그대로 이용할 수 있어요.
- Open-Meteo 무료 API는 비상업 용도와 일 10,000회 제한이 있어요. 광고·결제를 추가하거나 호출량이 커지면 유료 customer API와 서버 프록시로 전환해야 해요.
- 날씨 데이터는 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)이며, 좌표 반올림·UV 등급·경로 추천은 그늘길이 가공해요.

## 결과 지도와 현재 위치

- 경로를 찾으면 검색 폼을 숨기고 출발지·도착지, 세 경로 비교, 지도를 먼저 보여줘요.
- `지도에 내 위치 표시`를 누르면 현재 위치와 GPS 오차 범위를 계속 갱신해요.
- `지도 자동 이동`은 위치 수집을 끄지 않고 지도 카메라만 내 위치에 맞춰요. `위치 숨기기`를 누르거나 앱이 백그라운드로 가면 위치 갱신을 끝내요.
- 정확한 위치가 선택한 경로 밖에서 3번 연속 확인될 때만 경로 이탈 가능성을 알려요.
- 위치는 화면에 표시하는 동안만 메모리에서 쓰고 앱·서버·로컬 저장소에 저장하지 않아요.
- 지도에 보이는 주변 영역은 OpenStreetMap 타일 서버에 전달될 수 있어요.

## 보안·자원 보호

- 루팅 타일을 큰 객체로 확장하기 전에 요소·좌표 수를 검증하고, 그래프·그늘·경로·상세 길안내의 작업량을 제한해 WebView 자원 고갈을 막아요.
- Leaflet 경로는 세그먼트별 레이어 대신 최대 4개 multi-polyline으로 묶고, 상세 길안내는 펼칠 때만 DOM을 만들어요.
- 세부 공격 경로, 상한 근거, 호환성, 테스트는 [PR 1 보안 보고서](./docs/security/pr1-webview-resource-hardening.md)와 [HTML 요약](./docs/security/pr1-webview-resource-hardening.html)에 정리했어요.
- OSM의 제한 접근, 잠긴 게이트, 보행·에스컬레이터 방향을 경로 그래프에 반영하고, 보행 공간이 불확실한 도로에는 안전 비용을 적용해요.
- 보행 판정 근거, 실제 서울 데이터 영향, 오탐 경계와 테스트는 [PR 2 보안 보고서](./docs/security/pr2-osm-pedestrian-semantics.md)와 [HTML 요약](./docs/security/pr2-osm-pedestrian-semantics.html)에 정리했어요.
- 앱 번들이 manifest와 장소 인덱스를 직접, manifest가 개별 경로 타일을 SHA-256으로 고정해 부분 배포·스테일 캐시·변조를 fail-closed로 차단해요.
- 경로 데이터 로드와 계산은 module Web Worker에서 실행하고, 앱이 닫히거나 백그라운드 수명주기 이벤트를 받으면 진행 중 Worker 실행 컨텍스트를 종료해요.
- 데이터 무결성 연결, Worker 메시지 경계, 성능·호환성·남은 위험은 [PR 3 보안 보고서](./docs/security/pr3-artifact-integrity-worker.md)와 [HTML 요약](./docs/security/pr3-artifact-integrity-worker.html)에 정리했어요.

## 라이선스와 기여

- 소스 코드 라이선스는 아직 선택하지 않았어요. 공개 전환 전에 [공개 체크리스트](./docs/public-release-checklist.md)에 따라 `LICENSE`를 추가해야 해요.
- 서울 경로·장소·건물 데이터의 OpenStreetMap 저작자 표시와 데이터별 출처는 [데이터 안내](./public/data/README.md)를 확인해 주세요.
- 기여 방법은 [CONTRIBUTING.md](./CONTRIBUTING.md), 보안 문제 제보 방법은 [SECURITY.md](./SECURITY.md)에 정리되어 있어요.

## 배포하기

- 앱인토스 배포 API 키는 [앱인토스 콘솔](https://apps-in-toss.toss.im/) > 워크스페이스 > API 키 > 콘솔 API 키 에서 발급받을 수 있어요.

```bash
npm run build
npm run deploy
```

## 유용한 링크

- [앱인토스 콘솔](https://apps-in-toss.toss.im/)
- [앱인토스 개발자센터](https://developers-apps-in-toss.toss.im/)
- [앱인토스 개발자 커뮤니티](https://techchat-apps-in-toss.toss.im/)

AI를 사용하시는 경우 [여기](https://developers-apps-in-toss.toss.im/development/llms.html)를 확인해보세요.
