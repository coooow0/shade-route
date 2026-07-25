# 정확도 피드백 웹훅 설정

결과 화면 하단 위젯이 사용자의 만족도(좋음/보통/나쁨)와 선택 메모, 요청 도시를 웹훅으로 보낸다. 좌표·검색어·계정 정보는 보내지 않는다. 이 문서는 Google Apps Script + Google Sheets로 웹훅을 세팅하는 절차다.

## 페이로드 형식

앱은 아래 JSON을 `POST`로 보낸다. Content-Type은 `text/plain;charset=utf-8`(CORS preflight 회피). Apps Script `doPost` 안에서 `JSON.parse(e.postData.contents)`로 읽는다.

```json
{
  "satisfaction": "good | mid | bad",
  "memo": "선택 자유 메모 (없으면 필드 자체가 생략됨)",
  "wantedCity": "다른 도시 요청 (없으면 필드 자체가 생략됨)",
  "routeMode": "shortest | balanced | maxShade",
  "timeSec": 720,
  "lengthM": 880,
  "sunSec": 240,
  "shadeRatio": 0.62,
  "requestedAt": "2026-07-25T08:00:00.000Z",
  "submittedAt": "2026-07-25T08:00:12.000Z",
  "appVersion": "0.1.0"
}
```

memo는 최대 500자, wantedCity는 최대 60자로 클라이언트에서 잘라낸다.

## Google Sheets + Apps Script 세팅

### 1. 시트 만들기

새 Google Sheet를 만들고 첫 행에 아래 헤더를 붙여 넣는다.

```
receivedAt	satisfaction	routeMode	timeSec	lengthM	sunSec	shadeRatio	requestedAt	submittedAt	appVersion	memo	wantedCity
```

### 2. Apps Script 붙이기

`확장 프로그램 → Apps Script`를 열고 `Code.gs`를 아래 내용으로 교체한다.

```javascript
const SHEET_NAME = "Sheet1"; // 필요하면 실제 시트 이름으로 바꿔줘

function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    const body = JSON.parse(e.postData.contents);
    if (!isValid(body)) {
      output.setContent(JSON.stringify({ ok: false, error: "invalid" }));
      return output;
    }
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    sheet.appendRow([
      new Date(),
      body.satisfaction,
      body.routeMode,
      body.timeSec,
      body.lengthM,
      body.sunSec,
      body.shadeRatio,
      body.requestedAt,
      body.submittedAt,
      body.appVersion,
      body.memo || "",
      body.wantedCity || "",
    ]);
    output.setContent(JSON.stringify({ ok: true }));
  } catch (error) {
    output.setContent(JSON.stringify({ ok: false, error: String(error) }));
  }
  return output;
}

function isValid(body) {
  if (!body || typeof body !== "object") return false;
  const okSatisfaction = ["good", "mid", "bad"].includes(body.satisfaction);
  const okMode = ["shortest", "balanced", "maxShade"].includes(body.routeMode);
  const numeric = ["timeSec", "lengthM", "sunSec", "shadeRatio"].every(
    (key) => typeof body[key] === "number" && isFinite(body[key])
  );
  const okStrings =
    typeof body.requestedAt === "string" &&
    typeof body.submittedAt === "string" &&
    typeof body.appVersion === "string";
  const okMemo =
    body.memo === undefined ||
    (typeof body.memo === "string" && body.memo.length <= 500);
  const okCity =
    body.wantedCity === undefined ||
    (typeof body.wantedCity === "string" && body.wantedCity.length <= 60);
  return okSatisfaction && okMode && numeric && okStrings && okMemo && okCity;
}
```

### 3. 웹앱으로 배포

- 우측 상단 `배포 → 새 배포`
- 유형: `웹앱`
- 실행 계정: `나`
- 액세스 권한: `모든 사용자`
- `배포`를 누르면 웹앱 URL이 발급된다. `https://script.google.com/macros/s/AKfyc.../exec` 형태.

주의: 액세스를 `모든 사용자`로 열어야 앱에서 익명 POST가 가능하다. 대신 검증 로직(`isValid`)이 필수다.

### 4. 앱에 환경변수 등록

프로젝트 루트에 `.env.local`을 만들고(존재 확인만) 다음 줄을 넣는다.

```
VITE_FEEDBACK_WEBHOOK_URL=https://script.google.com/macros/s/AKfyc.../exec
```

`.env.local`은 `.gitignore`가 이미 무시하므로 커밋되지 않는다. dev 서버·`ait build` 모두 이 값을 사용한다. 값이 비어 있거나 파일이 없으면 결과 화면에 피드백 위젯 자체가 렌더링되지 않는다.

### 5. 확인

`npm run dev`로 앱을 띄우고 경로를 하나 검색해 결과 화면에서 위젯이 보이는지 확인한다. 좋음/보통/나쁨 중 하나를 누르고 `보내기`를 누른 다음 시트에 행이 추가되는지 확인한다. 같은 경로에서는 브라우저 `localStorage`에 저장되어 두 번 뜨지 않는다.

## 운영

- Apps Script는 무료 티어에서 하루 20,000회 실행이 가능하다. 이 앱 규모에서 사실상 무제한.
- 시트에서 필터·피벗·차트로 만족도 분포, 도시 요청 워드클라우드 등을 바로 만들 수 있다.
- 개인정보가 남지 않으므로 시트 공유를 넓게 잡아도 안전하다. 다만 시트 편집 권한은 최소로 유지한다.
- 프로덕션에서 스팸이 걱정되면 Apps Script 안에서 `PropertiesService`로 토큰을 만들고 앱에서 Authorization 헤더를 붙이는 방식으로 확장할 수 있다. 현재 프로토타입은 스팸 리스크가 낮아 생략.
