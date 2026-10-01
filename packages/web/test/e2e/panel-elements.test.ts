import { expect, test, type Page } from "@playwright/test";

async function settlePanels(page: Page): Promise<void> {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/packages/web/test/e2e/fixtures/panel-elements.html");
  await page.waitForFunction(() => (window as unknown as { __fixtureReady: boolean }).__fixtureReady);
});

test("popover attributes, focus, exclusivity and manual dismissal", async ({ page }) => {
  await page.evaluate(() => { (window as unknown as { keepPointerFocus: boolean }).keepPointerFocus = true; });
  await page.locator("#field").focus();
  await page.locator("#trigger").click();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#field")).toBeFocused();
  await expect(page.locator("#trigger")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#trigger").click();
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page.locator("#trigger")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#panel").evaluate(el => el.setAttribute("open", ""));
  await expect(page.locator("#trigger")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#panel").evaluate(el => el.removeAttribute("open"));
  await expect(page.locator("#trigger")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#field")).toBeFocused();
  await page.locator("#trigger").click();
  await page.locator("#inside").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page.locator("#trigger")).toBeFocused();
  await page.locator("#panel").evaluate(el => el.setAttribute("open", ""));
  await page.locator("#manual").evaluate(el => el.setAttribute("open", ""));
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#manual")).toBeVisible();
  await page.locator("#other").evaluate(el => el.setAttribute("open", ""));
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page.locator("#manual")).toBeVisible();
  await page.locator("#outside").click();
  await expect(page.locator("#other")).toBeHidden();
  await page.keyboard.press("Escape");
  await settlePanels(page);
  await expect(page.locator("#manual")).toBeVisible();
});

test("panels retain their parent, follow their trigger and flip at window edges", async ({ page }) => {
  await page.locator("#trigger").click();
  await expect(page.locator("#owner > #panel")).toBeVisible();
  const trigger = (await page.locator("#trigger").boundingBox())!;
  const panel = (await page.locator("#panel").boundingBox())!;
  expect(panel.x).toBeCloseTo(trigger.x, 0);
  expect(panel.y).toBeCloseTo(trigger.y + trigger.height + 4, 0);
  await page.locator("#inside").click();
  await page.locator("#trigger").evaluate(el => { el.style.position = "fixed"; el.style.left = "900px"; });
  await expect.poll(async () => (await page.locator("#panel").boundingBox())!.x).toBeGreaterThan(panel.x);
  await page.locator("#panel").evaluate(el => { el.style.width = "280px"; el.style.height = "180px"; });
  await expect.poll(async () => (await page.locator("#panel").boundingBox())!.height).toBe(180);
  await page.setViewportSize({ width: 420, height: 400 });
  await page.locator("#trigger").evaluate(el => { el.style.left = "auto"; el.style.right = "10px"; el.style.top = "20px"; });
  await expect.poll(async () => {
    const a = (await page.locator("#trigger").boundingBox())!;
    const b = (await page.locator("#panel").boundingBox())!;
    return Math.abs(b.y - a.y - a.height - 4) < 1 && Math.abs(b.x + b.width - a.x - a.width) < 1;
  }).toBe(true);
  await page.locator("#trigger").evaluate(el => { el.style.left = "auto"; el.style.right = "10px"; el.style.top = "auto"; el.style.bottom = "10px"; });
  await expect.poll(async () => {
    const a = (await page.locator("#trigger").boundingBox())!;
    const b = (await page.locator("#panel").boundingBox())!;
    return Math.abs(b.height - 180) < 1 && Math.abs(b.y + b.height - a.y + 4) < 1 && Math.abs(b.x + b.width - a.x - a.width) < 1;
  }).toBe(true);
  const beforeResize = (await page.locator("#panel").boundingBox())!;
  await page.locator("#panel").evaluate(el => { el.style.height = "220px"; });
  await expect.poll(async () => {
    const a = (await page.locator("#trigger").boundingBox())!;
    const b = (await page.locator("#panel").boundingBox())!;
    return Math.abs(b.height - 220) < 1 && Math.abs(b.y - beforeResize.y + 40) < 1 && Math.abs(b.y + b.height - a.y + 4) < 1;
  }).toBe(true);
  await page.setViewportSize({ width: 500, height: 450 });
  await expect.poll(async () => {
    const a = (await page.locator("#trigger").boundingBox())!;
    const b = (await page.locator("#panel").boundingBox())!;
    return Math.abs(b.x + b.width - a.x - a.width) < 1 && b.y + b.height <= a.y - 3;
  }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#owner > #panel")).toBeHidden();
});

test("trigger replacement and owner removal leave no stranded panel or ARIA", async ({ page }) => {
  await page.locator("#trigger").click();
  await page.locator("#trigger").evaluate(el => el.replaceWith(el.cloneNode(true)));
  await expect(page.locator("#trigger")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#trigger").evaluate(el => el.removeAttribute("aria-expanded"));
  await expect(page.locator("#trigger")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#owner").evaluate(el => el.remove());
  await expect(page.locator("#panel")).toHaveCount(0);
});

test("menu distinguishes keyboard and pointer opening and activates the highlighted action", async ({ page }) => {
  await page.evaluate(() => { (window as unknown as { keepPointerFocus: boolean }).keepPointerFocus = true; });
  await page.locator("#field").focus();
  await page.locator("#menu-trigger").click();
  const accessibility = await page.context().newCDPSession(page);
  const { nodes } = await accessibility.send("Accessibility.getFullAXTree");
  expect(nodes.some(node => node.role?.value === "menu")).toBe(true);
  expect(nodes.filter(node => node.role?.value === "menuitem").map(node => node.name?.value)).toEqual(["First", "Delete"]);
  await accessibility.detach();
  await expect(page.locator("#field")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#last")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#last")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#first")).toBeFocused();
  await page.locator("#last").hover();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#first")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#last")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#menu")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelActions: number }).panelActions)).toBe(1);
  await page.locator("#menu-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#first")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#first")).toBeFocused();
  await page.locator("#last").hover();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelActions: number }).panelActions)).toBe(2);
  await page.locator("#field").focus();
  await page.locator("#menu-trigger").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#first")).toBeFocused();
  await page.locator("#last").click();
  await expect(page.locator("#menu")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelActions: number }).panelActions)).toBe(3);
});

test("select reserves width, separates highlight from selection and commits once", async ({ page }) => {
  const trigger = page.locator("#select-trigger");
  await expect(trigger).toContainText("Beta");
  const width = (await trigger.boundingBox())!.width;
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toBeFocused();
  await expect(page.locator('#select tv-option[value="b"]')).toHaveAttribute("highlighted", "");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('#select tv-option[value="c"]')).toHaveAttribute("highlighted", "");
  await expect(trigger).toContainText("Beta");
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("Considerably longer");
  expect((await trigger.boundingBox())!.width).toBeCloseTo(width, 0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelChanges: number }).panelChanges)).toBe(1);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('#select tv-option[value="a"]')).toHaveAttribute("highlighted", "");
  await page.keyboard.press("Escape");
  await expect(trigger).toContainText("Considerably longer");
  await page.locator("#select").evaluate(el => { (el as HTMLElement & { value: string }).value = "missing"; });
  await expect(trigger).toContainText("Considerably longer");
  expect(await page.locator("#select").evaluate(el => (el as HTMLElement & { value: string }).value)).toBe("c");
  await expect(page.locator("#select tv-option[selected]")).toHaveCount(1);
  await expect(page.locator('#select tv-option[value="c"]')).toHaveAttribute("selected", "");
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelChanges: number }).panelChanges)).toBe(1);
  await page.locator("#select").evaluate(el => { (el as HTMLElement & { value: string }).value = "a"; });
  await expect(trigger).toContainText("Alpha");
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelChanges: number }).panelChanges)).toBe(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("b");
  await trigger.evaluate(el => el.addEventListener("keydown", () => document.body.dataset.leaked = "yes"));
  await page.keyboard.press("Tab");
  await expect(page.locator("body")).not.toHaveAttribute("data-leaked");
  await expect(trigger).toContainText("Beta");
  await expect(page.locator("#after")).toBeFocused();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#select")).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Home");
  await page.locator("#outside").click();
  await expect(page.locator("#select")).toBeHidden();
  await expect(trigger).toContainText("Beta");
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelChanges: number }).panelChanges)).toBe(2);
  await trigger.focus();
  await page.keyboard.press(" ");
  await expect(page.locator("#select")).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Escape");
});

test("a select inside Settings keeps its popover open and closes with its owner", async ({ page }) => {
  await page.locator("#trigger").click();
  await page.locator("#nested-trigger").click();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#nested")).toBeVisible();
  await page.locator('#nested tv-option[value="b"]').click();
  await expect(page.locator("#nested")).toBeHidden();
  await expect(page.locator("#panel")).toBeVisible();
  await page.locator("#nested").evaluate(el => el.setAttribute("open", ""));
  await page.locator("#panel").evaluate(el => el.removeAttribute("open"));
  await expect(page.locator("#nested")).toBeHidden();
  await page.locator("#select").evaluate(el => el.setAttribute("open", ""));
  await page.locator("#other").evaluate(el => el.setAttribute("open", ""));
  await settlePanels(page);
  await expect(page.locator("#select")).toHaveAttribute("open", "");
  await page.locator("#menu").evaluate(el => el.setAttribute("open", ""));
  await settlePanels(page);
  await expect(page.locator("#select")).toHaveAttribute("open", "");
  await expect(page.locator("#menu")).toBeVisible();
});

test("explicit removal does not resurrect an open panel and preserves inline priority on close", async ({ page }) => {
  await page.locator("#panel").evaluate(el => el.style.setProperty("position", "relative", "important"));
  await page.locator("#trigger").click();
  await page.keyboard.press("Escape");
  expect(await page.locator("#panel").evaluate(el => [el.style.position, el.style.getPropertyPriority("position")])).toEqual(["relative", "important"]);
  await page.locator("#trigger").click();
  await page.locator("#panel").evaluate(el => el.remove());
  await expect(page.locator("#panel")).toHaveCount(0);
  await expect(page.locator("#trigger")).not.toHaveAttribute("aria-expanded");
});

test("select restores owned semantics after rerender and keeps minted identities stable", async ({ page }) => {
  const select = page.locator("#select");
  const option = page.locator('#select tv-option[value="b"]');
  const optionID = await option.getAttribute("id");
  await option.evaluate(el => el.removeAttribute("id"));
  await expect(option).toHaveAttribute("id", optionID!);
  await page.locator("#select-trigger").evaluate(el => { const replacement = document.createElement("button"); replacement.id = el.id; replacement.setAttribute("aria-labelledby", "select-label"); el.replaceWith(replacement); });
  const trigger = page.locator("#select-trigger");
  await expect(trigger).toHaveAttribute("role", "combobox");
  await expect(trigger).toHaveAttribute("aria-controls", "select");
  await expect(trigger).toHaveAccessibleName("Choice");
  await expect(trigger).toHaveText("Beta");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-activedescendant", optionID!);
  // Playwright's DOM-derived role selector omits ElementInternals defaults.
  // Inspect Chromium's actual accessibility tree instead.
  const accessibility = await page.context().newCDPSession(page);
  const { nodes } = await accessibility.send("Accessibility.getFullAXTree");
  expect(nodes.some(node => node.role?.value === "listbox")).toBe(true);
  expect(nodes.some(node => node.role?.value === "option" && node.name?.value === "Beta" && node.properties?.some(property => property.name === "selected" && property.value.value === true))).toBe(true);
  await accessibility.detach();
  await trigger.evaluate(el => { for (const attribute of ["role", "aria-haspopup", "aria-controls", "aria-activedescendant"]) el.removeAttribute(attribute); el.replaceChildren("wrong"); });
  await expect(trigger).toHaveAccessibleName("Choice");
  await expect(trigger).toHaveText("Beta");
  await expect(trigger).toHaveAttribute("aria-activedescendant", optionID!);
  await expect(trigger).toHaveAttribute("role", "combobox");
  await expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  await expect(trigger).toHaveAttribute("aria-controls", "select");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await select.evaluate(el => el.remove());
  await expect(trigger).not.toHaveAttribute("aria-controls");
  await expect(trigger).not.toHaveAttribute("role");
  await expect(trigger).not.toHaveAttribute("aria-haspopup");
  await expect(trigger).not.toHaveAttribute("aria-activedescendant");
  await expect(trigger).not.toHaveAttribute("aria-expanded");

  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "generated-selects";
    fixture.innerHTML = ["one", "two"].map(name => `<button id="generated-${name}"></button><tv-select trigger="generated-${name}"><tv-option value="a">First</tv-option><tv-option value="b">Second</tv-option></tv-select>`).join("");
    document.body.append(fixture);
  });
  const generated = page.locator("#generated-selects tv-select");
  await expect(generated.locator("tv-option[selected]")).toHaveCount(2);
  for (const name of ["one", "two"]) await expect(page.locator(`#generated-${name}`)).toHaveText("First");
  const identities = await generated.evaluateAll(elements => elements.flatMap(el => [el.id, ...[...el.querySelectorAll("tv-option")].map(option => option.id)]));
  expect(identities.every(id => id.length > 0)).toBe(true);
  expect(new Set(identities).size).toBe(6);
  for (const name of ["one", "two"]) {
    const button = page.locator(`#generated-${name}`);
    const control = page.locator(`tv-select[trigger="generated-${name}"]`);
    await expect(button).toHaveAttribute("aria-controls", (await control.getAttribute("id"))!);
    await button.click();
    await expect(button).toHaveAttribute("aria-activedescendant", (await control.locator("tv-option[selected]").getAttribute("id"))!);
    await page.keyboard.press("Escape");
  }
  expect(await generated.evaluateAll(elements => elements.flatMap(el => [el.id, ...[...el.querySelectorAll("tv-option")].map(option => option.id)]))).toEqual(identities);
});

test("manual notifications do not take keyboard navigation away from an open menu", async ({ page }) => {
  await page.evaluate(() => {
    const button = document.createElement("button"); button.id = "late-trigger";
    const panel = document.createElement("tv-popover"); panel.id = "late-manual"; panel.setAttribute("manual", ""); panel.setAttribute("trigger", "late-trigger"); panel.textContent = "Notification";
    document.body.append(button, panel); panel.setAttribute("open", "");
  });
  await page.locator("#menu-trigger").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#last")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#menu")).toBeHidden();
  await expect(page.locator("#late-manual")).toBeVisible();
});

test("select opens over its selected row without stationary-pointer or document-scroll changes", async ({ page }) => {
  const trigger = page.locator("#select-trigger");
  await trigger.focus();
  const before = (await trigger.boundingBox())!;
  await page.mouse.move(before.x + 5, before.y + 1);
  const scroll = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("ArrowDown");
  await settlePanels(page);
  await expect(page.locator('#select tv-option[value="b"]')).toHaveAttribute("highlighted", "");
  const row = (await page.locator('#select tv-option[value="b"]').boundingBox())!;
  expect(row.y + row.height / 2).toBeCloseTo(before.y + before.height / 2, 0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await page.locator('#select tv-option[value="a"]').hover();
  await expect(page.locator('#select tv-option[value="a"]')).toHaveAttribute("highlighted", "");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('#select tv-option[value="b"]')).toHaveAttribute("highlighted", "");
});

test("a constrained select reveals the selected row and preserves keyboard scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 300 });
  await page.locator("#select-trigger").evaluate(el => { el.style.position = "fixed"; el.style.top = "100px"; el.style.left = "80px"; el.style.marginTop = "0"; });
  await page.locator("#select").evaluate(el => {
    for (let index = 0; index < 30; index++) {
      const option = document.createElement("tv-option"); option.setAttribute("value", String(index)); option.textContent = `Item ${index}`; el.append(option);
    }
    (el as HTMLElement & { value: string }).value = "29";
  });
  await page.locator("#select-trigger").click();
  await expect.poll(() => page.locator('#select tv-option[value="29"]').evaluate(el => {
    const panel = el.closest("tv-select")!.getBoundingClientRect(); const row = el.getBoundingClientRect();
    return row.top >= panel.top && row.bottom <= panel.bottom;
  })).toBe(true);
  await page.keyboard.press("Home");
  await settlePanels(page);
  await expect(page.locator('#select tv-option[value="a"]')).toHaveAttribute("highlighted", "");
  await expect.poll(() => page.locator('#select tv-option[value="a"]').evaluate(el => {
    const panel = el.closest("tv-select")!.getBoundingClientRect(); return el.getBoundingClientRect().top >= panel.top;
  })).toBe(true);
  for (const [top, alignment] of [[30, "top"], [220, "bottom"]] as const) {
    await page.keyboard.press("Escape");
    await page.locator("#select-trigger").evaluate((el, y) => { el.style.top = `${y}px`; }, top);
    await page.locator("#select").evaluate(el => { (el as HTMLElement & { value: string }).value = "15"; });
    await page.locator("#select-trigger").click();
    await expect.poll(async () => {
      const trigger = (await page.locator("#select-trigger").boundingBox())!;
      const panel = (await page.locator("#select").boundingBox())!;
      const aligned = alignment === "top" ? Math.abs(panel.y - trigger.y) < 1 : Math.abs(panel.y + panel.height - trigger.y - trigger.height) < 1;
      return aligned && panel.width >= trigger.width && panel.x >= 4 && panel.y >= 4 && panel.x + panel.width <= 496 && panel.y + panel.height <= 296;
    }).toBe(true);
  }
});

test("ordinary document layers cover panels in order and reconnecting restores pairing", async ({ page }) => {
  await page.locator("#trigger").click();
  await page.evaluate(() => {
    const overlay = document.createElement("div"); overlay.id = "overlay";
    Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "1" }); document.body.append(overlay);
  });
  const point = await page.locator("#inside").evaluate(el => { const box = el.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("tv-popover")?.id, point)).toBe("panel");
  await page.locator("#overlay").evaluate(el => { el.style.zIndex = "200"; });
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point)).toBe("overlay");
  await page.locator("#overlay").evaluate(el => el.remove());
  await page.locator("#panel").evaluate(el => { el.remove(); document.querySelector("#owner")!.append(el); });
  await expect(page.locator("#trigger")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#trigger").click();
  await expect(page.locator("#panel")).toBeVisible();
});

test("select keys work away from the trigger and typeahead accumulates then resets", async ({ page }) => {
  await page.evaluate(() => { (window as unknown as { keepPointerFocus: boolean }).keepPointerFocus = true; });
  await page.locator("#select").evaluate(el => {
    const option = document.createElement("tv-option"); option.setAttribute("value", "az"); option.textContent = "Azure"; el.append(option);
  });
  await page.locator("#field").focus();
  await page.locator("#select-trigger").click();
  await expect(page.locator("#field")).toBeFocused();
  await page.keyboard.type("az");
  await expect(page.locator('#select tv-option[value="az"]')).toHaveAttribute("highlighted", "");
  // The actual typeahead inactivity timer is deliberately exercised.
  await page.waitForTimeout(650);
  await page.keyboard.press("b");
  await expect(page.locator('#select tv-option[value="b"]')).toHaveAttribute("highlighted", "");
  await page.keyboard.press(" ");
  await expect(page.locator("#select")).toBeHidden();
  await expect(page.locator("#field")).toHaveValue("");
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelChanges: number }).panelChanges)).toBe(0);
});

test("select width follows new options and an ordinary CSS width wins", async ({ page }) => {
  const trigger = page.locator("#select-trigger");
  const initial = (await trigger.boundingBox())!.width;
  await page.locator("#select").evaluate(el => {
    const option = document.createElement("tv-option"); option.setAttribute("value", "long"); option.textContent = "A newly added option longer than all previous options"; el.append(option);
  });
  await expect.poll(async () => (await trigger.boundingBox())!.width).toBeGreaterThan(initial);
  await page.addStyleTag({ content: "#select-trigger { width: 90px; }" });
  expect((await trigger.boundingBox())!.width).toBe(90);
});

test("constrained panels scroll, keep window clearance and follow live root theme changes", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 300 });
  await page.locator("#panel").evaluate(el => { const content = document.createElement("div"); content.style.height = "800px"; content.textContent = "Tall content"; el.append(content); });
  await page.locator("#trigger").click();
  await expect.poll(async () => {
    const bounds = (await page.locator("#panel").boundingBox())!;
    return bounds.x >= 4 && bounds.y >= 4 && bounds.x + bounds.width <= 416 && bounds.y + bounds.height <= 296;
  }).toBe(true);
  expect(await page.locator("#panel").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator("#panel").evaluate(el => { el.scrollTop = 70; });
  await settlePanels(page);
  expect(await page.locator("#panel").evaluate(el => el.scrollTop)).toBe(70);
  await page.locator("#panel").evaluate(el => el.scrollTo({ top: 100 }));
  await settlePanels(page);
  expect(await page.locator("#panel").evaluate(el => el.scrollTop)).toBe(100);
  await page.locator("html").evaluate(el => el.style.setProperty("--color-surface", "rgb(17, 34, 51)"));
  await expect(page.locator("#panel")).toHaveCSS("background-color", "rgb(17, 34, 51)");
});


test("a select connected inside a hidden wrapper measures when revealed", async ({ page }) => {
  await page.evaluate(() => {
    const wrapper = document.createElement("div"); wrapper.id = "hidden-wrapper"; wrapper.style.display = "none";
    wrapper.innerHTML = '<button id="hidden-select-trigger"></button><tv-select trigger="hidden-select-trigger"><tv-option value="a">Alpha</tv-option><tv-option value="long">Much considerably longer label</tv-option></tv-select>';
    document.body.append(wrapper);
  });
  await settlePanels(page);
  await page.locator("#hidden-wrapper").evaluate(el => { el.style.display = "block"; });
  await expect.poll(() => page.locator("#hidden-select-trigger").evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(150);
});

test("select consumes Tab away from its trigger without committing or advancing focus", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { keepPointerFocus: boolean }).keepPointerFocus = true;
    document.querySelector("#field")!.addEventListener("keydown", () => document.body.dataset.leaked = "yes");
  });
  await page.locator("#field").focus();
  await page.locator("#select-trigger").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await settlePanels(page);
  await expect(page.locator("#field")).toBeFocused();
  await expect(page.locator("#select")).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-leaked");
  await expect.poll(() => page.evaluate(() => (window as unknown as { panelChanges: number }).panelChanges)).toBe(0);
});


test("menu minimum width yields to a narrow artifact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 150, height: 500 });
  await page.locator("#menu-trigger").evaluate(el => { Object.assign(el.style, { position: "fixed", left: "50px", top: "100px", margin: "0" }); });
  await page.locator("#menu").evaluate(el => el.setAttribute("open", ""));
  await expect.poll(async () => {
    const bounds = (await page.locator("#menu").boundingBox())!;
    return bounds.x >= 4 && bounds.x + bounds.width <= 146;
  }).toBe(true);
});

// proofs/ui/foundation/popover/index.md#^po-ac-nesting
async function nestedPanels(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector("#panel")!.insertAdjacentHTML("beforeend", `
      <input id="editor" aria-label="Nested editor">
      <button id="child-trigger">Child</button>
      <button id="sibling-trigger">Sibling</button>
      <button id="portal-select-trigger">Select</button>
    `);
    // Authored outside the parent: ownership must follow the trigger.
    document.body.insertAdjacentHTML("beforeend", `
      <tv-popover id="child" trigger="child-trigger">
        <button id="grandchild-trigger">Grandchild</button>
        <button id="child-action">Child action</button>
      </tv-popover>
      <tv-popover id="sibling" trigger="sibling-trigger"><button>Sibling action</button></tv-popover>
      <tv-popover id="grandchild" trigger="grandchild-trigger"><button id="grandchild-action">Grandchild action</button></tv-popover>
      <tv-select id="portal-select" trigger="portal-select-trigger"><tv-option value="first">First</tv-option></tv-select>
    `);
    document.querySelector("#editor")!.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") event.preventDefault();
    });
  });
}

test("nested branches follow trigger ancestry and dismiss at the original input boundary", async ({ page }) => {
  await nestedPanels(page);
  await page.locator("#trigger").click();
  await page.locator("#child-trigger").click();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#child")).toBeVisible();
  await page.locator("#grandchild-trigger").click();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#child")).toBeVisible();
  await page.locator("#grandchild-action").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#grandchild")).toBeHidden();
  await expect(page.locator("#grandchild-trigger")).toBeFocused();
  await expect(page.locator("#child")).toBeVisible();
  await page.locator("#sibling-trigger").click();
  await expect(page.locator("#child")).toBeHidden();
  await expect(page.locator("#sibling")).toBeVisible();
  await expect(page.locator("#panel")).toBeVisible();
  await page.locator("#editor").click();
  await expect(page.locator("#sibling")).toBeHidden();
  await expect(page.locator("#editor")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).toBeVisible();
  await page.locator("#child-trigger").click();
  await page.locator("#outside").click();
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page.locator("#child")).toBeHidden();
  await expect(page.locator("#outside")).toBeFocused();
});

test("nested branches close descendants on root replacement, closure and removal", async ({ page }) => {
  await nestedPanels(page);
  await page.locator("#trigger").click();
  await page.locator("#child-trigger").click();
  await page.locator("#other-trigger").click();
  await expect(page.locator("#other")).toBeVisible();
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page.locator("#child")).toBeHidden();
  await page.locator("#trigger").click();
  await page.locator("#child-trigger").click();
  await page.locator("#grandchild-trigger").click();
  await page.locator("#grandchild-action").focus();
  await page.locator("#panel").evaluate((panel) => panel.removeAttribute("open"));
  await expect(page.locator("#child")).toBeHidden();
  await expect(page.locator("#grandchild")).toBeHidden();
  await expect(page.locator("#trigger")).toBeFocused();
  await page.locator("#trigger").click();
  await page.locator("#child").evaluate((panel) => panel.setAttribute("manual", ""));
  await page.locator("#child-trigger").click();
  await page.locator("#portal-select-trigger").click();
  await expect(page.locator("#child")).toBeVisible();
  await expect(page.locator("#portal-select")).toBeVisible();
  await page.locator("#panel").evaluate((panel) => panel.remove());
  await expect(page.locator("#child")).toBeHidden();
  await expect(page.locator("#portal-select")).toBeHidden();
  await expect(page.locator("#nested")).toHaveCount(0);
});

// proofs/ui/foundation/popover/index.md#^po-ac-placement
test("authored panel height caps survive viewport placement and restore inline priority", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.addStyleTag({ content: "#panel { max-height: 600px; }" });
  await page.locator("#panel").evaluate(el => {
    const content = document.createElement("div");
    content.id = "height-content";
    content.style.height = "900px";
    el.append(content);
  });
  await page.locator("#trigger").click();
  await expect.poll(async () => (await page.locator("#panel").boundingBox())!.height).toBe(600);
  await page.setViewportSize({ width: 1000, height: 300 });
  await expect.poll(async () => {
    const box = (await page.locator("#panel").boundingBox())!;
    return box.height < 300 && box.y >= 4 && box.y + box.height <= 296;
  }).toBe(true);
  await page.setViewportSize({ width: 1000, height: 1000 });
  await expect.poll(async () => (await page.locator("#panel").boundingBox())!.height).toBe(600);
  await page.locator("#height-content").evaluate(el => { el.style.height = "20px"; });
  await expect.poll(async () => (await page.locator("#panel").boundingBox())!.height).toBeLessThan(600);
  await page.locator("#trigger").click();
  await page.locator("#panel").evaluate(el => el.style.setProperty("max-height", "500px", "important"));
  await page.locator("#height-content").evaluate(el => { el.style.height = "900px"; });
  await page.locator("#trigger").click();
  await expect.poll(async () => (await page.locator("#panel").boundingBox())!.height).toBe(500);
  await page.setViewportSize({ width: 1000, height: 300 });
  await expect.poll(async () => (await page.locator("#panel").boundingBox())!.height).toBeLessThan(300);
  await page.locator("#trigger").click();
  expect(await page.locator("#panel").evaluate(el => [el.style.getPropertyValue("max-height"), el.style.getPropertyPriority("max-height")])).toEqual(["500px", "important"]);
});

test("nested branches retain the original click boundary when an action removes its panel", async ({ page }) => {
  await nestedPanels(page);
  await page.evaluate(() => {
    document.querySelector("#child-action")!.addEventListener("click", () => {
      document.querySelector("#child")!.remove();
      document.querySelector<HTMLInputElement>("#editor")!.focus();
    });
  });
  await page.locator("#trigger").click();
  await page.locator("#child-trigger").click();
  await page.locator("#child-action").click();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#editor")).toBeFocused();
});

// The original outside action may restore a parent after a dialog closes.
test("nested branches do not dismiss a panel opened by the same outside action", async ({ page }) => {
  await page.locator("#outside").evaluate(button => {
    button.addEventListener("click", () => document.querySelector("#panel")!.setAttribute("open", ""));
  });
  await page.locator("#outside").click();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(page.locator("#outside")).toBeFocused();
});
