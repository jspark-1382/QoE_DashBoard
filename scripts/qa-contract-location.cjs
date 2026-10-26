const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { load } = require('./analyst-ts-loader.cjs');
const { normalizeDay } = load('lib/analyst/data.ts');
const dataset = JSON.parse(fs.readFileSync('public/mdt-data.json', 'utf8'));
const output = 'outputs/analyst-ui/browser-restore-2026-10-26';
const base = process.argv[3] || 'http://localhost:3001/qoe/';
fs.mkdirSync(output, { recursive: true });
const candidates = {};
let checked = 0;
for (const customer of dataset.customers
  .filter(
    (c) =>
      c.gnssSampleCount === 0 && c.sampleCount >= 30 && c.sampleCount <= 800,
  )
  .sort((a, b) => b.sampleCount - a.sampleCount)) {
  const entry = dataset.days.find((d) => d.customerId === customer.id);
  const day = normalizeDay(
    dataset,
    JSON.parse(fs.readFileSync('public/' + entry.dataPath, 'utf8')),
    'MDT',
  );
  for (const sample of day.samples) {
    const method = sample.estimation?.method;
    if (method && !candidates[method])
      candidates[method] = { customer, day, sample };
  }
  if (
    candidates.MULTILATERATION &&
    candidates.WEIGHTED_2_SITE &&
    candidates.CELL_SITE
  )
    break;
  if (++checked >= 50) break;
}
assert(
  candidates.MULTILATERATION &&
    candidates.WEIGHTED_2_SITE &&
    candidates.CELL_SITE,
  'Current source has representative automatic-estimation fixtures',
);
const urlFor = ({ customer, day, sample }) =>
  base +
  '?' +
  new URLSearchParams({
    source: 'MDT',
    view: 'contract',
    date: day.date,
    customer: customer.id,
    call: sample.callId,
    sample: String(sample.index),
  });
(async () => {
  let browser;
  const errors = [],
    detailRequests = [];
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    const openMapOptions = async () => {
      const options = page.getByLabel('지도 옵션', { exact: true });
      await options.waitFor({ timeout: 30000 });
      if ((await options.getAttribute('open')) === null)
        await options.locator('summary').click();
    };
    const openEvidence = async () => {
      const details = page.getByLabel('선택 관측 위치 추정 근거');
      await details.waitFor({ timeout: 30000 });
      if ((await details.getAttribute('open')) === null)
        await details.locator('summary').click();
    };
    const setEvidence = async (checked) => {
      await openMapOptions();
      await page.getByLabel('추정 근거 보기', { exact: true }).setChecked(checked);
      await page.getByLabel('지도 옵션', { exact: true }).locator('summary').click();
    };
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/mdt-data/'))
        detailRequests.push(request.url());
    });
    await page.goto(base + '?source=MDT', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    await page.getByLabel('전체 분석 요약').waitFor({ timeout: 60000 });
    const trigger = page.getByRole('button', {
      name: '계약 목록 / 계약 선택',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '계약 선택', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.locator('tbody tr').count(), 25);
    assert.equal(
      detailRequests.length,
      0,
      'Browsing metadata must not download customer partitions',
    );
    await page.screenshot({
      path: output + '/contract-picker-browse-1920.png',
      fullPage: true,
    });
    const firstContract = await dialog
      .locator('tbody tr strong')
      .first()
      .innerText();
    await dialog.getByRole('button', { name: '다음', exact: true }).click();
    assert.notEqual(
      await dialog.locator('tbody tr strong').first().innerText(),
      firstContract,
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(
      await trigger.evaluate((element) => element === document.activeElement),
    );
    await trigger.click();
    await page.mouse.click(2, 2);
    await dialog.waitFor({ state: 'hidden' });
    await trigger.click();
    await dialog.getByLabel('GNSS 없는 계약만 (0건 확인)').check();
    const target = candidates.MULTILATERATION;
    await dialog
      .getByRole('textbox', { name: '계약번호 / 고객 검색', exact: true })
      .fill(target.customer.sourceContractId);
    await dialog
      .getByRole('button', {
        name: target.customer.sourceContractId + ' 선택',
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: output + '/contract-picker-1920.png',
      fullPage: true,
    });
    await dialog
      .getByRole('button', {
        name: target.customer.sourceContractId + ' 선택',
        exact: true,
      })
      .click();
    await openMapOptions();
    await page.getByLabel('자동 위치 추정 상태').waitFor({ timeout: 30000 });
    assert.equal(
      new URL(page.url()).searchParams.get('customer'),
      target.customer.id,
    );
    assert(
      (await page.locator('body').innerText()).includes(
        target.customer.sourceContractId,
      ),
    );

    await page.goto(urlFor(target), { waitUntil: 'domcontentloaded' });
    const evidence = page.getByLabel('선택 관측 위치 추정 근거');
    await evidence.waitFor({ timeout: 30000 });
    await openEvidence();
    await openMapOptions();
    assert((await evidence.innerText()).includes('3개 이상 기지국'));
    assert((await evidence.innerText()).includes('삼변·다변측량'));
    assert(
      (await page.getByLabel('자동 위치 추정 상태').innerText()).includes(
        'GNSS 0건',
      ),
    );
    await setEvidence(true);
    await page
      .getByRole('button', {
        name: '위치 추정 근거 기지국으로 지도 이동',
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label^="추정 근거 기지국 "]').length >=
        3,
    );
    assert.equal(
      await page.locator('[aria-label^="추정 근거 기지국 "]').count(),
      target.sample.estimation.usedSites.length,
    );
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await page.screenshot({
      path: output + '/multilateration-1920.png',
      fullPage: true,
    });
    const beforeSample = new URL(page.url()).searchParams.get('sample');
    await openMapOptions();
    await page
      .getByRole('button', { name: /^무선 추정 시점으로 이동/ })
      .click();
    await page.waitForFunction(
      (before) => new URL(location.href).searchParams.get('sample') !== before,
      beforeSample,
    );
    await setEvidence(false);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label^="추정 근거 기지국 "]')
          .length === 0,
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    await openEvidence();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: output + '/estimate-1366.png',
      fullPage: true,
    });

    await page.goto(urlFor(candidates.WEIGHTED_2_SITE), {
      waitUntil: 'domcontentloaded',
    });
    await openMapOptions();
    await page.getByLabel('자동 위치 추정 상태').waitFor({ timeout: 30000 });
    await openEvidence();
    assert((await evidence.innerText()).includes('2개 기지국 가중중심'));
    await page.goto(urlFor(candidates.CELL_SITE), {
      waitUntil: 'domcontentloaded',
    });
    await openMapOptions();
    await page.getByLabel('자동 위치 추정 상태').waitFor({ timeout: 30000 });
    await openEvidence();
    const singleText = await evidence.innerText();
    assert(singleText.includes('고객 위치 보류'));
    assert(singleText.includes('임시 좌표는 고객 위치에서 제외'));
    assert(!singleText.includes('단일 Site 좌표를 임시 위치로 사용'));
    await setEvidence(true);
    await page
      .getByRole('button', {
        name: '위치 추정 근거 기지국으로 지도 이동',
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label^="추정 근거 기지국 "]')
          .length === 1,
    );
    await page.screenshot({
      path: output + '/single-site-withheld.png',
      fullPage: true,
    });
    await trigger.click();
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert(
      await trigger.evaluate((element) => element === document.activeElement),
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        browserErrors: errors,
        blankContractBrowse: true,
        metadataOnly: true,
        pagination: true,
        escapeBackdropAndFocus: true,
        gnssMissingFilterAndSelection: true,
        actualAutomaticMultilateration: true,
        selectedUsedSiteOverlay: true,
        estimateSampleNavigation: true,
        twoSiteLabel: true,
        singleSiteWithheld: true,
        smallScreenFits: true,
      }),
    );
  } finally {
    await browser?.close();
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
