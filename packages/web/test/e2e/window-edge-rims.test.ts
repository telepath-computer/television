import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Rendered-pixel regression for the fractional seam and source-over frame paint.
// The fixture mounts production views; its application service is a stub, so
// these checks do not claim server state, navigation or native Electron coverage.
async function pixels(page: Page, points: number[][]): Promise<number[][]> {
  const image = (await page.screenshot()).toString("base64");
  return page.evaluate(async ({ image, points }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${image}`)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3));
  }, { image, points });
}

test("window rim theme decorations accept complete overrides and inactive frames retain their edge", async ({ page }) => {
  await page.goto("/packages/web/test/e2e/fixtures/window-edge-rims.html");
  const frame = page.locator(".artifact-frame").first();
  await expect(page.frameLocator(".artifact-frame iframe").first().getByRole("heading")).toBeVisible();
  await page.addStyleTag({ content: ":root { --panel-border: 2px solid purple; }" });
  await expect(frame).toHaveCSS("border-top-width", "2px");
  await expect(page.locator(".sidebar")).toHaveCSS("border-right-width", "2px");
  await page.addStyleTag({ content: ":root { --shadow-xl: none; --frame-border: 3px dashed red; --sidebar-border: 2px dotted green; }" });
  await expect(frame).toHaveCSS("box-shadow", "none");
  expect(await frame.evaluate(element => getComputedStyle(element, "::before").boxShadow)).not.toBe("none");
  await expect(frame).toHaveCSS("border-top-width", "3px");
  await expect(frame).toHaveCSS("border-top-style", "dashed");
  await expect(page.locator(".sidebar")).toHaveCSS("border-right-width", "2px");
  await page.addStyleTag({ content: ":root { --panel-edge-highlight: none; --panel-edge-shadow: none; --artifact-frame-shadow: 1px 2px 3px red; }" });
  await expect(frame).toHaveCSS("box-shadow", "rgb(255, 0, 0) 1px 2px 3px 0px");
  expect(await frame.evaluate(element => getComputedStyle(element, "::before").boxShadow)).toBe("none");
  expect(await frame.evaluate(element => getComputedStyle(element, "::after").backgroundImage)).toBe("none");
  await expect(frame).toHaveCSS("border-top-width", "3px");
  expect(await page.locator(".sidebar").evaluate(element => getComputedStyle(element, "::after").backgroundImage)).toBe("none");
  expect(await page.locator(".app-main").evaluate(element => getComputedStyle(element, "::before").boxShadow)).toBe("none");
  await page.reload();
  await expect(page.frameLocator(".artifact-frame iframe").first().getByRole("heading")).toBeVisible();
  await page.addStyleTag({ content: ".specimen:first-child { --frame-radius: 20px; } .specimen:last-child { --frame-radius: 6px; }" });
  await expect(frame).toHaveCSS("border-radius", "20px");
  for (const [index, radius] of [20, 6].entries()) {
    const gradient = await page.locator(".artifact-frame").nth(index).evaluate(element => getComputedStyle(element, "::after").backgroundImage);
    expect(gradient).toContain(`${radius}px`);
  }
  const menu = frame.locator(".artifact-menu-trigger");
  await menu.focus();
  await expect(menu).toBeFocused();
  expect(await menu.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await menu.click();
  await expect(page.locator("tv-menu[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/packages/web/test/e2e/fixtures/artifact-menu-placement.html");
  const inactive = page.locator(".page:not([selected]) .artifact-frame").first();
  await expect(inactive).toBeAttached();
  await expect(inactive).toHaveCSS("box-shadow", "none");
  expect(await inactive.evaluate(element => getComputedStyle(element, "::before").boxShadow)).not.toBe("none");
  await expect(inactive).toHaveCSS("pointer-events", "none");
  await page.goto("/packages/web/test/e2e/fixtures/tab-strip.html");
  const selectedTab = page.locator('.tab[aria-selected="true"]');
  await selectedTab.focus();
  await expect(selectedTab).toHaveCSS("outline-style", "solid");
  expect(await selectedTab.evaluate(element => getComputedStyle(element, "::before").boxShadow)).not.toBe("none");
  const tabBox = await selectedTab.boundingBox();
  await page.addStyleTag({ content: ":root { --panel-edge-highlight: none; --panel-edge-shadow: none; }" });
  expect(await selectedTab.boundingBox()).toEqual(tabBox);
  await expect(selectedTab).toHaveCSS("outline-style", "solid");

});

for (const dpr of [1, 2]) {
  test(`window rims retain fractional paint and iframe input at DPR${dpr}`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL, viewport: { width: 1000, height: 650 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    try {
      for (const theme of ["none", "swiss"]) for (const appearance of ["light", "dark"]) for (const ground of ["white", "dark"]) {
        await page.goto(`/packages/web/test/e2e/fixtures/window-edge-rims.html?${new URLSearchParams({ theme, appearance, ground })}`);
        for (let index = 0; index < 2; index++) {
          const document = page.frameLocator(".artifact-frame iframe").nth(index);
          await expect(document.getByRole("heading")).toHaveText("Independent document");
          await document.getByRole("button").click();
          await expect(document.getByRole("button")).toHaveText("Clicked");
        }
        await page.evaluate(() => document.fonts.ready);
        const frame = await page.locator(".artifact-frame").nth(1).boundingBox();
        const sidebar = await page.locator(".sidebar").boundingBox();
        if (!frame || !sidebar) throw new Error("Missing production geometry");
        const points = [
          [(frame.x + frame.width - 1) * dpr, (frame.y + 60) * dpr],
          [(sidebar.x + sidebar.width) * dpr, 500 * dpr],
          [(sidebar.x + sidebar.width) * dpr + 1, 500 * dpr],
          [(frame.x + frame.width / 2) * dpr, frame.y * dpr],
          [(frame.x + frame.width / 2) * dpr, frame.y * dpr + 1],
        ].map(point => point.map(Math.round));
        const normal = await pixels(page, points);
        const disabled = await page.addStyleTag({ content: ".artifact-frame::after, .app-main::before { display: none !important; }" });
        const underpaint = await pixels(page, points);
        await disabled.evaluate(element => element.parentNode?.removeChild(element));
        // White .20 over the dark document, independent of app appearance.
        for (let channel = 0; channel < 3; channel++) {
          expect(Math.abs(normal[0][channel] - (underpaint[0][channel] * .8 + 255 * .2))).toBeLessThanOrEqual(2);
          const coverage = dpr === 2 ? 1 : .5;
          const alpha = appearance === "dark" ? .912 : .205;
          expect(Math.abs(normal[1][channel] - underpaint[1][channel] * (1 - alpha * coverage)), `${theme}/${appearance}/${ground}/DPR${dpr}`).toBeLessThanOrEqual(2);
        }
        if (dpr === 2) {
          for (const [sample, alpha] of [[3, .36], [4, .28]]) {
            for (let channel = 0; channel < 3; channel++) {
              expect(Math.abs(normal[sample][channel] - (underpaint[sample][channel] * (1 - alpha) + 255 * alpha))).toBeLessThanOrEqual(2);
            }
          }
        }
        // A half-pixel seam must survive DPR1 and occupy one device column at DPR2.
        expect(underpaint[1][0] - normal[1][0]).toBeGreaterThan(0);
        if (dpr === 2) expect(normal[2]).toEqual(underpaint[2]);
        if (process.env.EDGE_EVIDENCE_DIR) {
          await mkdir(process.env.EDGE_EVIDENCE_DIR, { recursive: true });
          await page.screenshot({ path: `${process.env.EDGE_EVIDENCE_DIR}/${theme}-${appearance}-${ground}-dpr${dpr}.png` });
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(".sidebar")).toBeVisible();
      await expect(page.locator(".artifact-frame").first()).toBeVisible();
      if (process.env.EDGE_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EDGE_EVIDENCE_DIR}/narrow-dpr${dpr}.png` });
    } finally {
      await context.close();
    }
  });
}

for (const appearance of ["light", "dark"]) {
  test(`canonical panels share complete paints and independent borders in ${appearance}`, async ({ page }) => {
    await page.goto(`/packages/web/test/e2e/fixtures/panel-edge-paints.html?appearance=${appearance}`);
    const panels = page.locator("tv-popover, tv-menu, tv-select, dialog");
    for (const panel of await panels.all()) {
      await expect(panel).toHaveCSS("border-top-width", "0px");
      const paint = await panel.evaluate(element => ({
        rim: getComputedStyle(element, "::before").boxShadow,
        highlight: getComputedStyle(element, "::after").backgroundImage,
        radius: getComputedStyle(element).borderTopLeftRadius,
      }));
      // Chromium serializes alpha after 8-bit quantization.
      const alpha = Number(/rgba\(0, 0, 0, ([\d.]+)\)/.exec(paint.rim)?.[1]);
      expect(Math.abs(alpha - (appearance === "dark" ? .912 : .205))).toBeLessThan(1 / 255);
      expect(paint.highlight).toContain(paint.radius);
    }
    const input = page.getByRole("textbox");
    await expect(input).toHaveCSS("border-top-width", "1px");
    await input.focus();
    await expect(input).toHaveCSS("outline-style", "solid");
    await page.addStyleTag({ content: ":root { --popover-shadow: none; --dialog-shadow: none; --panel-border: 3px dashed red; }" });
    for (const panel of await panels.all()) {
      await expect(panel).toHaveCSS("box-shadow", "none");
      await expect(panel).toHaveCSS("border-top-width", "3px");
      expect(await panel.evaluate(element => getComputedStyle(element, "::before").boxShadow)).not.toBe("none");
    }
    await page.addStyleTag({ content: ":root { --panel-edge-shadow: none; --panel-edge-highlight: none; --popover-shadow: 0 2px 4px blue; --dialog-shadow: 0 2px 4px blue; }" });
    for (const panel of await panels.all()) {
      expect(await panel.evaluate(element => getComputedStyle(element, "::before").boxShadow)).toBe("none");
      expect(await panel.evaluate(element => getComputedStyle(element, "::after").backgroundImage)).toBe("none");
      await expect(panel).not.toHaveCSS("box-shadow", "none");
      await expect(panel).toHaveCSS("border-top-width", "3px");
      await panel.getByRole("button").click();
      await expect(panel.getByRole("button")).toBeFocused();
    }
    await input.fill("Still editable");
    await expect(input).toHaveValue("Still editable");
    await expect(input).toHaveCSS("border-top-width", "1px");
  });
}

test("scrolling production panels paint the sharp rim outside their clipping box", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1000, height: 650 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await page.goto("/packages/web/test/e2e/fixtures/window-edge-rims.html");
    await page.addStyleTag({ content: ":root { --popover-shadow: none; } tv-menu { width: 200px; box-sizing: border-box; }" });
    await page.locator(".artifact-menu-trigger").first().click();
    const menu = page.locator("tv-menu[open]");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS("overflow", "auto");
    const box = await menu.boundingBox();
    if (!box) throw new Error("Missing open menu geometry");
    const points = [[Math.ceil((box.x + box.width) * 2), Math.round((box.y + 20) * 2)]];
    const normal = await pixels(page, points);
    const disabled = await page.addStyleTag({ content: ":root { --panel-edge-shadow: none; }" });
    const underpaint = await pixels(page, points);
    await disabled.evaluate(element => element.parentNode?.removeChild(element));
    expect(normal[0][0]).toBeLessThan(underpaint[0][0]);
  } finally {
    await context.close();
  }
});


test("opened canonical panels and native dialog retain visible rims while scrolling", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 800, height: 450 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    for (const kind of ["popover", "menu", "select", "dialog"]) {
      await page.goto("/packages/web/test/e2e/fixtures/scrolling-panel-edges.html");
      await page.locator(`#open-${kind}`).click();
      const panel = page.locator(`#${kind}`);
      await expect(panel).toBeVisible();
      const scrollTop = () => panel.evaluate(element => (element.querySelector(".dialog-content") ?? element).scrollTop);
      const box = await panel.boundingBox();
      if (!box) throw new Error("Missing panel");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 300);
      await expect.poll(scrollTop).toBeGreaterThan(0);
      const scrolled = await scrollTop();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await scrollTop()).toBeGreaterThanOrEqual(scrolled);
      const settledBox = await panel.boundingBox();
      if (!settledBox) throw new Error("Missing scrolled panel");
      const points = [[Math.ceil((settledBox.x + settledBox.width) * 2), Math.round((settledBox.y + 20) * 2)]];
      const painted = await pixels(page, points);
      await page.addStyleTag({ content: ":root { --panel-edge-shadow: none; }" });
      const disabled = await pixels(page, points);
      expect(painted[0][0], kind).toBeLessThan(disabled[0][0]);
      await page.keyboard.press("Escape");
      await expect(panel).not.toBeVisible();
    }
  } finally { await context.close(); }
});

// Authored data runs through canonical's real custom-element controller.
test("authored panel height constrains tall content and native scrolling", async ({ page }) => {
  await page.goto("/packages/web/test/e2e/fixtures/authored-panel-layout.html");
  await page.locator("#open-height").click();
  const panel = page.locator("#height");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  if (!box) throw new Error("Missing authored panel");
  expect(box.height).toBe(100);
  const outside = await pixels(page, [[Math.round(box.x + 50), Math.round(box.y + 120)]]);
  expect(outside[0]).toEqual([255, 255, 255]);
  await page.mouse.move(box.x + 80, box.y + 50);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await panel.evaluate(element => element.scrollTo(0, 400));
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBe(400);
});

for (const layout of ["grid", "flex"]) {
  test(`authored panel ${layout} retains direct-child layout`, async ({ page }) => {
    await page.goto("/packages/web/test/e2e/fixtures/authored-panel-layout.html");
    await page.locator(`#open-${layout}`).click();
    const panel = page.locator(`#${layout}`);
    await expect(panel).toBeVisible();
    const boxes = await panel.locator(":scope > div").evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(boxes[1].x - boxes[0].x).toBe(100);
    expect(boxes[1].y).toBe(boxes[0].y);
    expect(boxes[2].x).toBe(boxes[0].x);
    expect(boxes[2].y - boxes[0].y).toBe(40);
    expect((await panel.boundingBox())?.height).toBe(80);
  });
}

test("authored panel rounded corners clip a zero-padding image", async ({ page }) => {
  await page.goto("/packages/web/test/e2e/fixtures/authored-panel-layout.html");
  await page.locator("#open-corner").click();
  const panel = page.locator("#corner");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  if (!box) throw new Error("Missing image panel");
  const sample = await pixels(page, [[Math.round(box.x + 2), Math.round(box.y + 2)], [Math.round(box.x + 100), Math.round(box.y + 50)]]);
  expect(sample[0]).toEqual([255, 255, 255]);
  expect(sample[1]).toEqual([0, 128, 255]);
});

test("panel paint follows its box with classic scrollbars and transformed ancestors", async ({ browser, baseURL }) => {
  const visibleScrollbars = await browser.browserType().launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await visibleScrollbars.newPage({ baseURL, viewport: { width: 800, height: 600 } });
  try {
    for (const transformed of [false, true]) {
      await page.goto("/packages/web/test/e2e/fixtures/authored-panel-layout.html");
      await page.addStyleTag({ content: "html { scrollbar-gutter: stable; } html::-webkit-scrollbar { width: 16px; } body { min-height: 2000px; } :root { --panel-edge-shadow: 0 0 0 3px black; }" });
      if (transformed) await page.evaluate(() => {
        const parent = document.createElement("section");
        parent.style.transform = "translate(20px, 10px) scale(.9)";
        document.body.append(parent);
        parent.append(document.querySelector("#open-height")!, document.querySelector("#height")!);
      });
      await page.locator("#open-height").click();
      const panel = page.locator("#height");
      await expect(panel).toBeVisible();
      expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
      const box = await panel.boundingBox();
      if (!box) throw new Error("Missing scroll-gutter panel");
      // Sample a whole exterior pixel inside the authored rim, away from its
      // antialiased outer edge even after the .9 ancestor scale.
      const rim = await pixels(page, [[Math.floor(box.x + box.width) + 1, Math.round(box.y + box.height / 2)]]);
      expect(rim[0], `transformed=${transformed}`).toEqual([0, 0, 0]);
    }
  } finally { await visibleScrollbars.close(); }
});


for (const dimension of ["height", "max-height"]) {
  test(`authored native dialog ${dimension} constrains its explicit content wrapper`, async ({ page }) => {
    await page.goto("/packages/web/test/e2e/fixtures/scrolling-panel-edges.html");
    await page.addStyleTag({ content: `#dialog { ${dimension}: 100px; }` });
    await page.locator("#open-dialog").click();
    const dialog = page.locator("#dialog");
    const content = dialog.locator(".dialog-content");
    const hostBox = await dialog.boundingBox();
    const contentBox = await content.boundingBox();
    if (!hostBox || !contentBox) throw new Error("Missing native dialog");
    expect(hostBox.height).toBe(100);
    expect(contentBox.height).toBeLessThanOrEqual(hostBox.height);
    await content.evaluate(element => element.scrollTo(0, 200));
    expect(await content.evaluate(element => element.scrollTop)).toBe(200);
  });
}

test("opened production panels retain an authored border with both edge paints off", async ({ page }) => {
  for (const kind of ["popover", "menu", "select", "dialog"]) {
    await page.goto("/packages/web/test/e2e/fixtures/scrolling-panel-edges.html");
    await page.addStyleTag({ content: ":root { --panel-edge-shadow: none; --panel-edge-highlight: none; --panel-border: 3px solid red; }" });
    await page.locator(`#open-${kind}`).click();
    const panel = page.locator(`#${kind}`);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS("box-shadow", "none");
    await expect(panel).toHaveCSS("border-top-width", "3px");
    const box = await panel.boundingBox();
    if (!box) throw new Error("Missing bordered panel");
    const border = await pixels(page, [[Math.round(box.x + 1), Math.round(box.y + 40)]]);
    expect(border[0], kind).toEqual([255, 0, 0]);
    expect(await panel.evaluate(element => getComputedStyle(element, "::before").boxShadow)).toBe("none");
    expect(await panel.evaluate(element => getComputedStyle(element, "::after").backgroundImage)).toBe("none");
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
  }
});
