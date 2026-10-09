import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const conflictMessage = "Это время уже заняли. Список обновлён — выберите другой интервал";

test.beforeEach(async ({ page }) => {
    // 08:00 in Asia/Bishkek, for client validation and MSW handlers alike.
    await page.clock.setFixedTime(new Date("2026-10-09T02:00:00Z"));
    await page.goto("/");
    await expect(page.getByLabel("Дата", { exact: true })).toHaveValue("2026-10-09");
    await expect(page.getByText("На выбранную дату бронирований нет.")).toBeVisible();
});

async function fillBooking(page: Page, title: string, start: string, end: string) {
    await page.getByLabel(/Название/).fill(title);
    await page.getByLabel("Время начала").fill(start);
    await page.getByLabel("Время окончания").fill(end);
}

function bookingRow(page: Page, title: string) {
    return page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
}

async function expectDraft(page: Page, title: string, start: string, end: string) {
    await expect(page.getByLabel(/Название/)).toHaveValue(title);
    await expect(page.getByLabel("Время начала")).toHaveValue(start);
    await expect(page.getByLabel("Время окончания")).toHaveValue(end);
}

test("создание → редактирование → удаление с подтверждением", async ({ page }) => {
    await fillBooking(page, "Встреча команды", "10:15", "10:45");
    await page.getByRole("button", { name: "Забронировать" }).click();
    const row = bookingRow(page, "Встреча команды");
    await expect(row).toContainText("10:15 — 10:45");
    await expectDraft(page, "", "", "");
    await row.getByRole("button", { name: "Редактировать" }).click();
    await expectDraft(page, "Встреча команды", "10:15", "10:45");
    await fillBooking(page, "Изменённая встреча", "11:15", "12:00");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const updatedRow = bookingRow(page, "Изменённая встреча");
    await expect(updatedRow).toContainText("11:15 — 12:00");
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expectDraft(page, "", "", "");
    // Deleting the edited booking must also close its form.
    await updatedRow.getByRole("button", { name: "Редактировать" }).click();
    page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        expect(dialog.message()).toContain("Изменённая встреча, 09.10.2026, 11:15–12:00");
        await dialog.dismiss();
    });
    await updatedRow.getByRole("button", { name: "Удалить" }).click();
    await expect(updatedRow).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    const deleted = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/api/bookings/"));
    await updatedRow.getByRole("button", { name: "Удалить" }).click();
    expect((await deleted).status()).toBe(204);
    await expect(page.getByText("На выбранную дату бронирований нет.")).toBeVisible();
    await expect(page.getByRole("form", { name: "Новое бронирование" })).toBeVisible();
    await expectDraft(page, "", "", "");
});

for (const editing of [false, true]) {
    test(`серверный 409 и повторное сохранение: ${editing ? "редактирование" : "создание"}`, async ({ page }) => {
        if (editing) {
            await fillBooking(page, "Исходная встреча", "09:00", "09:30");
            await page.getByRole("button", { name: "Забронировать" }).click();
            await bookingRow(page, "Исходная встреча").getByRole("button", { name: "Редактировать" }).click();
        }
        await page.getByText("Демо-сценарии", { exact: true }).click();
        const toggle = page.getByRole("switch", { name: "Конфликт при следующем сохранении" });
        await toggle.check();
        await fillBooking(page, "Мой черновик", "10:15", "10:45");
        const method = editing ? "PATCH" : "POST";
        const conflict = page.waitForResponse((response) => response.request().method() === method && response.url().includes("/api/bookings"));
        await page.getByRole("button", { name: editing ? "Сохранить" : "Забронировать", exact: true }).click();
        expect((await conflict).status()).toBe(409);
        await expect(page.getByRole("alert")).toHaveText(conflictMessage);
        await expect(bookingRow(page, "Бронь другого участника")).toContainText("10:15 — 10:45");
        await expectDraft(page, "Мой черновик", "10:15", "10:45");
        await expect(page.getByRole("form", { name: editing ? "Редактирование бронирования" : "Новое бронирование" })).toBeVisible();
        await expect(toggle).not.toBeChecked();
        await fillBooking(page, "Мой черновик", "11:00", "11:30");
        const saved = page.waitForResponse((response) => response.request().method() === method && response.url().includes("/api/bookings"));
        await page.getByRole("button", { name: editing ? "Сохранить" : "Забронировать", exact: true }).click();
        expect((await saved).status()).toBe(editing ? 200 : 201);
        await expect(bookingRow(page, "Мой черновик")).toContainText("11:00 — 11:30");
        await expect(page.getByRole("listitem")).toHaveCount(2);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expectDraft(page, "", "", "");
    });
}

async function tabTo(page: Page, target: Locator) {
    for (let step = 0; step < 30; step++) {
        if (await target.evaluate((element) => element === document.activeElement)) return;
        await page.keyboard.press("Tab");
    }
    await expect(target).toBeFocused();
}

test("управление клавиатурой и перенос фокуса при редактировании", async ({ page }) => {
    const summary = page.locator("summary");
    await page.keyboard.press("Tab");
    await expect(summary).toBeFocused();
    await expect(summary).toHaveCSS("outline-style", "solid");
    await expect(summary).toHaveCSS("outline-width", "3px");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    const toggle = page.getByRole("switch");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await page.keyboard.press("Space");
    await expect(toggle).not.toBeChecked();
    await tabTo(page, page.getByLabel("Дата", { exact: true }));
    await tabTo(page, page.getByLabel(/Название/));
    await page.keyboard.type("Keyboard meeting");
    await tabTo(page, page.getByLabel("Время начала"));
    await page.keyboard.type("10");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("15");
    await tabTo(page, page.getByLabel("Время окончания"));
    await page.keyboard.type("10");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("45");
    await expectDraft(page, "Keyboard meeting", "10:15", "10:45");
    await tabTo(page, page.getByRole("button", { name: "Забронировать" }));
    await page.keyboard.press("Enter");
    const row = bookingRow(page, "Keyboard meeting");
    await expect(row).toBeVisible();
    await tabTo(page, row.getByRole("button", { name: "Редактировать" }));
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/Название/)).toBeFocused();
    await expect(page.getByLabel(/Название/)).toBeInViewport();
    await tabTo(page, page.getByRole("button", { name: "Отмена" }));
    await page.keyboard.press("Enter");
    await expect(row.getByRole("button", { name: "Редактировать" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/Название/)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Keyboard update");
    await tabTo(page, page.getByRole("button", { name: "Сохранить", exact: true }));
    await page.keyboard.press("Enter");
    const updated = bookingRow(page, "Keyboard update");
    await expect(updated).toBeVisible();
    await tabTo(page, updated.getByRole("button", { name: "Удалить" }));
    page.once("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Enter");
    await expect(page.getByText("На выбранную дату бронирований нет.")).toBeVisible();
});

test("адаптивная страница без горизонтального переполнения", async ({ page }, testInfo) => {
    await page.getByText("Демо-сценарии", { exact: true }).click();
    const title = "ОченьДлинноеНазваниеВстречиБезПробелов".repeat(4);
    await fillBooking(page, title, "10:15", "10:45");
    await page.getByRole("button", { name: "Забронировать" }).click();
    const row = bookingRow(page, title);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Редактировать" }).click();
    await page.getByRole("switch").check();
    await fillBooking(page, title, "11:15", "11:45");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(conflictMessage);
    const widths = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    expect(widths.body).toBeLessThanOrEqual(widths.viewport);
    for (const field of [page.getByLabel("Дата", { exact: true }), page.getByLabel("Время начала"), page.getByLabel("Время окончания")]) {
        const box = await field.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(widths.viewport);
    }
    await page.screenshot({ path: testInfo.outputPath("booking-layout.png"), fullPage: true });
});
