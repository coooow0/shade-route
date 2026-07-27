import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

// 개발자 머신의 `.env.local`이 `VITE_FEEDBACK_WEBHOOK_URL`을 채워 두더라도, 기본 테스트는
// "웹훅 꺼짐" 시나리오로 실행한다. 특정 테스트에서 URL이 있을 때의 동작을 검증하고 싶으면
// 그 테스트 안에서 `vi.stubEnv(...)`로 켠 다음 확인해야 한다.
beforeEach(() => {
  vi.stubEnv("VITE_FEEDBACK_WEBHOOK_URL", "");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
