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

`확장 프로그램 → Apps Script`를 열고 `Code.gs`를 아래 내용으로 교체한다. 로케일에 상관없이 첫 번째 시트에 쓰고, 수식 주입 방지(선행 `= + - @` 이스케이프)와 동시 쓰기 잠금(`LockService`), 일일 저장 상한(`PropertiesService`)이 포함되어 있다.

```javascript
// 하루에 허용할 최대 저장 행 수. 초과 요청은 이 스크립트가 200으로 응답하되 시트에 쓰지 않는다.
const DAILY_ROW_LIMIT = 500;

function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  const lock = LockService.getScriptLock();
  try {
    // 동시 요청이 동일한 카운터·시트를 건드리지 않도록 스크립트 단위 락을 잡는다.
    lock.waitLock(5000);
    const body = JSON.parse(e.postData.contents);
    if (!isValid(body)) {
      output.setContent(JSON.stringify({ ok: false, error: "invalid" }));
      return output;
    }
    if (!withinDailyLimit()) {
      output.setContent(JSON.stringify({ ok: false, error: "rate_limited" }));
      return output;
    }
    // 로케일에 따라 기본 탭 이름이 "Sheet1" / "시트1"로 다를 수 있어 첫 번째 시트를 쓴다.
    const sheet = SpreadsheetApp.getActive().getSheets()[0];
    if (!sheet) throw new Error("No sheet found in the bound spreadsheet");
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
      escapeCell(body.memo),
      escapeCell(body.wantedCity),
    ]);
    output.setContent(JSON.stringify({ ok: true }));
  } catch (error) {
    output.setContent(JSON.stringify({ ok: false, error: String(error) }));
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseError) {
      // 락을 못 잡은 경우 releaseLock이 던질 수 있으니 무시한다.
    }
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

// Google Sheets는 셀 값이 = + - @ 로 시작하면 수식으로 해석한다.
// IMPORTXML / HYPERLINK 등을 이용한 데이터 유출·피싱을 막기 위해 앞에 작은따옴표를 붙여 텍스트로 강제한다.
function escapeCell(value) {
  if (value === undefined || value === null) return "";
  const s = String(value);
  if (s.length === 0) return "";
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// 자정(스크립트 시간대 기준)마다 초기화되는 일일 저장 카운터.
// 시트 오염과 스크립트 쿼터 소진을 어느 정도 완화한다. 완전한 rate limit은 아니다.
function withinDailyLimit() {
  const store = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const rawDate = store.getProperty("counterDate");
  const rawCount = Number(store.getProperty("counterCount") || "0");
  const count = rawDate === today ? rawCount : 0;
  if (count >= DAILY_ROW_LIMIT) return false;
  store.setProperties({
    counterDate: today,
    counterCount: String(count + 1),
  });
  return true;
}
```

주의: `DAILY_ROW_LIMIT`는 시트 오염을 늦출 뿐이고, Apps Script 실행 쿼터(계정 일일 6h 실행 시간, 20k 실행) 자체를 지켜주지는 않는다. 진짜 rate limit이 필요하면 Cloudflare Worker 같은 앞단을 두어 IP/토큰 기반으로 차단해야 한다.

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

기본 흐름:

1. `npm run dev`로 앱을 띄우고 경로를 하나 검색해 결과 화면에서 위젯이 보이는지 확인한다.
2. 좋음/보통/나쁨 중 하나를 누르고 `보내기`를 누른 다음 시트에 행이 추가되는지 확인한다.
3. 같은 경로에서는 브라우저 `localStorage`에 저장되어 두 번 뜨지 않는다.

수식 주입 이스케이프가 걸려 있는지 검증:

- 자유 메모에 `=IMPORTXML("https://example.com","//x")` 같은 문자열을 넣고 보내기.
- 시트의 memo 셀이 수식이 아니라 앞에 작은따옴표가 붙은 텍스트(`'=IMPORTXML(...)`)로 저장되고 아무 계산도 실행되지 않아야 한다.

토스 QR 샌드박스 확인 (`.ait` 실기기 검증):

- `npm run build`로 만든 최신 `.ait`를 앱인토스 콘솔에서 QR로 열고, 실기기에서 결과 화면 위젯을 눌러 실제 시트에 행이 쌓이는지 확인한다.
- iOS·Android WebView에서 CORS 관련 오류가 콘솔에 뜨지 않는지 함께 살핀다. Vite dev 서버와 앱인토스 WebView는 오리진이 다르므로 이 검증이 필수다.

## 운영

- Apps Script는 무료 티어에서 하루 20,000회 실행이 가능하다. 이 앱 규모에서 사실상 무제한.
- 위 스크립트의 `DAILY_ROW_LIMIT`(기본 500)은 시트 오염을 늦추는 완화책이지, 실행 쿼터 자체를 지켜주지는 못한다. 진짜 rate limit이 필요하면 Cloudflare Worker 앞단으로 옮긴다.
- 시트에서 필터·피벗·차트로 만족도 분포, 도시 요청 워드클라우드 등을 바로 만들 수 있다.
- 개인정보가 남지 않으므로 시트 공유를 넓게 잡아도 안전하다. 다만 시트 편집 권한은 최소로 유지한다.
- URL은 `.env.local`에 있어도 프로덕션 빌드 시 앱 JS 번들에 인라인된다. Vite `VITE_*` 환경변수는 클라이언트 노출 값이라는 점을 전제로 운영한다. 스팸이 관찰되면 (a) 위 카운터를 줄여 조기 차단, (b) URL 재발급, (c) Cloudflare Worker 앞단 도입 순으로 대응한다.
