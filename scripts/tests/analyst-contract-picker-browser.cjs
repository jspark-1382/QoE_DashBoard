const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    await page.goto(process.argv[3] || 'http://localhost:3001/qoe/?source=MDT');
    const trigger = page.getByRole('button', {
      name: '계약 목록 / 계약 선택',
      exact: true,
    });
    await trigger.waitFor({ timeout: 60000 });
    const dialog = page.getByRole('dialog', { name: '계약 선택', exact: true });
    await trigger.click();
    await dialog.getByRole('button', { name: '다음', exact: true }).click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(await trigger.evaluate((e) => e === document.activeElement));
    await trigger.click();
    const rect = await dialog.boundingBox();
    assert(
      rect.x > 2 && rect.y > 2,
      'Native modal must remain centered despite global CSS resets',
    );
    await page.mouse.click(rect.x + 2, rect.y + 2);
    assert(
      await dialog.evaluate((e) => e.open),
      'Internal dialog padding is not the backdrop',
    );
    await page.mouse.click(2, 2);
    await dialog.waitFor({ state: 'hidden', timeout: 3000 });
    assert(await trigger.evaluate((e) => e === document.activeElement));
    await trigger.click();
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert(await trigger.evaluate((e) => e === document.activeElement));
    console.log(
      'Contract dialog browser centering, backdrop, padding, reopen, Escape, cancel and focus regression passed',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
