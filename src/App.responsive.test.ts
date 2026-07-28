import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync("src/App.css", "utf8");
const wideMediaStart = appCss.indexOf("@media (min-width: 680px)");
const wideMediaEnd = appCss.indexOf(
  "@media (prefers-reduced-motion: reduce)",
  wideMediaStart,
);
const mobileLayoutCss = appCss.slice(0, wideMediaStart);
const wideLayoutCss = appCss.slice(wideMediaStart, wideMediaEnd);

describe("wide result layout", () => {
  it("keeps the search and mobile result layouts below 680px", () => {
    expect(mobileLayoutCss).toMatch(
      /#root\s*{[\s\S]*?max-width:\s*480px[\s\S]*?margin:\s*0 auto/,
    );
    expect(mobileLayoutCss).toMatch(
      /\.c-sheet\s*{[\s\S]*?bottom:\s*0[\s\S]*?left:\s*0[\s\S]*?max-height:\s*62vh/,
    );
    expect(wideLayoutCss).not.toContain("#root");
  });

  it("switches the result map and sheet to a full-width split layout", () => {
    expect(wideLayoutCss).toMatch(
      /\.c-topbar\s*{[\s\S]*?right:\s*0[\s\S]*?left:\s*0[\s\S]*?width:\s*auto[\s\S]*?max-width:\s*none/,
    );
    expect(wideLayoutCss).toMatch(
      /\.result-view\s*{[\s\S]*?--result-panel-width:\s*calc\([\s\S]*?clamp\(320px,\s*42vw,\s*400px\)[\s\S]*?\+\s*env\(safe-area-inset-right,\s*0px\)[\s\S]*?\)/,
    );
    expect(wideLayoutCss).toMatch(
      /\.c-map-full\s*{[\s\S]*?right:\s*var\(--result-panel-width\)[\s\S]*?width:\s*auto[\s\S]*?max-width:\s*none/,
    );
    expect(wideLayoutCss).toMatch(
      /\.c-sheet\s*{[\s\S]*?top:\s*calc\(env\(safe-area-inset-top,\s*0px\)\s*\+\s*56px\)[\s\S]*?left:\s*auto[\s\S]*?width:\s*var\(--result-panel-width\)[\s\S]*?max-height:\s*none/,
    );
  });

  it("contains sheet scrolling and respects horizontal safe areas", () => {
    expect(appCss).toMatch(
      /\.c-sheet\s*{[\s\S]*?overscroll-behavior:\s*contain/,
    );
    expect(appCss).toMatch(
      /\.c-topbar\s*{[\s\S]*?padding-right:\s*calc\(14px \+ env\(safe-area-inset-right,\s*0px\)\)[\s\S]*?padding-left:\s*calc\(14px \+ env\(safe-area-inset-left,\s*0px\)\)/,
    );
    expect(appCss).toMatch(
      /\.c-map-full \.map-location-controls\s*{[\s\S]*?right:\s*calc\(12px \+ env\(safe-area-inset-right,\s*0px\)\)[\s\S]*?left:\s*calc\(12px \+ env\(safe-area-inset-left,\s*0px\)\)/,
    );
    expect(appCss).toMatch(
      /\.c-sheet\s*{[\s\S]*?padding-right:\s*calc\(14px \+ env\(safe-area-inset-right,\s*0px\)\)[\s\S]*?padding-left:\s*calc\(14px \+ env\(safe-area-inset-left,\s*0px\)\)/,
    );
  });
});
