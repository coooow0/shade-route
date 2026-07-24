# 데이터 출처와 라이선스

## OpenStreetMap 데이터

다음 파일은 OpenStreetMap 원본을 변환하거나 재구성한 데이터베이스입니다.

- `buildings.json`: OpenStreetMap Overpass API에서 받은 건물 데이터
- `seoul/tiles/`: 서울 보행로와 건물의 타일 데이터
- `seoul/places.json`: 서울 장소·주소 검색 인덱스
- `seoul/manifest.json`: 타일 범위, 보행 정책, release ID, 원본 provenance, 개별 파일 SHA-256 메타데이터

앱 번들은 manifest와 장소 인덱스 SHA-256을 직접 고정하고, manifest는 개별 타일·장소·경계 파일 SHA-256을 고정합니다. 데이터를 수정한 뒤에는 `npm run data:seoul`로 전체 산출물을 다시 만들고 `npm run data:verify`로 파일 집합·크기·해시를 검증해야 합니다. generated integrity root를 손으로 수정하지 마세요.

이 데이터에는 [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자의 정보가 포함되어 있으며 [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)에 따라 제공됩니다. 데이터를 다시 배포하거나 가공할 때도 저작자 표시와 ODbL 의무를 확인해 주세요.

## 출처 확인이 필요한 경계 데이터

`seoul/boundary.json`과 런타임 `src/data/seoulBoundary.ts`는 같은 `data-src/seoul-boundary.geojson`과 생성 실행을 사용합니다. `npm run data:verify`는 런타임 모듈이 원본에서 기대한 결과와 정확히 같은지도 검사합니다. 현재 저장소에는 원본 URL과 라이선스 기록이 없으므로, 공개 전환 전에 출처와 재배포 조건을 확인해야 합니다.

## 소스 코드와의 구분

이 안내는 위 데이터 파일에만 적용됩니다. 애플리케이션 소스 코드 라이선스는 별도의 루트 `LICENSE` 파일로 정하며, 현재는 아직 선택하지 않았습니다.
