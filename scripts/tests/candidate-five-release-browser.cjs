/* eslint-disable @typescript-eslint/no-require-imports -- Node browser acceptance CLI. */
/* Browser acceptance against live saved data. No route is mocked; any generation is blocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { output, target, categories, origin, read } = require('./candidate-five-release-verify.cjs');
const job = read('candidate-23-job');
const history = read('candidate-23-history');
const diagnostics = read('candidate-23-diagnostics');
assert.deepEqual(job.target, target);
assert.equal(job.id, read('generation-receipt').id);
assert.equal(history.jobs[0].id, job.id);
const result = { origin: origin.origin, jobId: job.id, status: 'running', checks: [], blockedRequests: [], runtimeErrors: [], screenshots: [] };
const base = path.join(output, 'browser-' + origin.port);
const persist = () => fs.writeFileSync(base + '.json', JSON.stringify(result, null, 2));
const pending = new Map();
let socket, browser, profile, seq = 0;
async function waitFor(probe, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let cause;
  do {
    try { const value = await probe(); if (value) return value; }
    catch (error) { cause = error; }
    await delay(200);
  } while (Date.now() < deadline);
  throw Error('Timed out waiting for ' + label + (cause ? ': ' + cause.message : ''));
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 12000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ method, params, id }));
  });
}
async function evaluate(fn, ...args) {
  const answer = await cdp('Runtime.evaluate', { expression: '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', awaitPromise: true, returnByValue: true });
  if (answer.exceptionDetails) throw Error(answer.exceptionDetails.exception?.description || answer.exceptionDetails.text);
  return answer.result.value;
}
async function attach() {
  const binary = process.env.QOE_QA_CHROME || path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe');
  assert(fs.existsSync(binary), 'Chrome executable is required');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qoe-five-release-'));
  browser = spawn(binary, ['--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const port = await waitFor(() => fs.existsSync(portFile) && Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]), 'isolated Chrome');
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    const waiter = pending.get(packet.id);
    if (waiter) {
      pending.delete(packet.id);
      clearTimeout(waiter.timer);
      if (packet.error) waiter.reject(Error(packet.error.message));
      else waiter.resolve(packet.result);
    } else if (packet.method === 'Runtime.exceptionThrown') {
      result.runtimeErrors.push(packet.params.exceptionDetails.exception?.description || packet.params.exceptionDetails.text);
    } else if (packet.method === 'Fetch.requestPaused') {
      const { requestId, request } = packet.params;
      const mutates = request.method !== 'GET' && request.method !== 'HEAD';
      if (mutates) result.blockedRequests.push({ method: request.method, path: new URL(request.url).pathname });
      const command = mutates ? cdp('Fetch.failRequest', { requestId, errorReason: 'Aborted' }) : cdp('Fetch.continueRequest', { requestId });
      command.catch(error => { result.interceptionError = error.message; });
    }
  });
  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(Error('Browser closed')); }
    pending.clear();
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/analysis/jobs*', requestStage: 'Request' }] });
}
async function cleanup() {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await cdp('Browser.close'); } catch {}
    socket.close();
  }
  // Only the isolated child handle and profile created above belong to this run.
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await Promise.race([once(browser, 'exit'), delay(800)]);
    if (browser.exitCode === null && browser.signalCode === null) browser.kill();
  }
  if (profile && path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('qoe-five-release-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); }
    catch { result.retainedBrowserProfile = profile; }
  }
}
async function openReport() {
  const url = new URL('/qoe/', origin);
  url.search = new URLSearchParams({ variant: 'improvement2', ...target.scope, distributionMode: 'mos', evidence: 'all', mapMode: 'improvement' }).toString();
  await cdp('Page.navigate', { url: url.href });
  await waitFor(() => evaluate(() => {
    const group = document.querySelector('fieldset[aria-label="개선후보 표시 기준"]');
    const all = [...(group?.querySelectorAll('button') || [])].find(node => node.textContent.trim().startsWith('전체 '));
    if (all && all.getAttribute('aria-pressed') !== 'true') { all.click(); return false; }
    const button = [...document.querySelectorAll('button[aria-label="후보 지역 23 AI 분석"]')].find(node => node.getBoundingClientRect().width);
    if (!button) return false;
    button.scrollIntoView({ block: 'center' }); button.click(); return true;
  }), 'mixed-period candidate 23');
  await selectReport(job.id);
  await waitFor(() => evaluate(id => {
    const map = document.querySelector('dialog[open] [data-map-panel] [data-candidate-pot-map]');
    return map?.dataset.candidatePotMap === id && !!map.querySelector('.leaflet-container [data-pot-id]');
  }, target.candidateId), 'real candidate Leaflet POT layer');
}
async function selectReport(id) {
  await waitFor(() => evaluate(id => {
    const button = [...document.querySelectorAll('dialog[open] [data-saved-analysis]')].find(node => node.dataset.savedAnalysis === id);
    if (!button) return false;
    button.click(); return true;
  }, id), 'saved report button ' + id);
  await waitFor(() => evaluate(id => document.querySelector('dialog[open] [data-displayed-analysis]')?.dataset.displayedAnalysis === id, id), 'displayed report ' + id);
  await waitFor(() => evaluate(id => document.querySelector('dialog[open] [data-source-assessment-job]')?.dataset.sourceAssessmentJob === id, id), 'same saved report source ' + id);
  const saved = history.jobs.find(row => row.id === id);
  assert(await evaluate(text => document.querySelector('dialog[open] [data-analysis-stage="1"]')?.textContent.includes(text), saved.report.summary.observed), 'original saved report narrative ' + id);
}
async function layout(width, height) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await delay(300);
  const view = await evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    const map = dialog.querySelector('[data-map-panel]');
    const results = dialog.querySelector('[data-results-panel]');
    const rect = node => { const { x, y, right, bottom, width, height } = node.getBoundingClientRect(); return { x, y, right, bottom, width, height }; };
    return {
      dialog: rect(dialog), map: rect(map), results: rect(results), dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      rows: [...results.querySelectorAll('details[data-source-cause]')].map(node => ({ id: node.dataset.sourceCause, status: node.dataset.sourceCauseStatus, open: node.open, summary: node.querySelector('summary').innerText })),
      mapTargets: [...map.querySelectorAll('[data-map-target-role]')].map(node => ({ role: node.dataset.mapTargetRole, pot: node.dataset.potId, percent: node.dataset.weakPercent, text: node.innerText })),
      leafletPots: [...map.querySelectorAll('.leaflet-container [data-pot-id]')].map(node => ({
        pot: node.dataset.potId, role: node.dataset.potRole,
        selected: node.dataset.potSelected === 'true', pressed: node.getAttribute('aria-pressed') === 'true',
      })),
      priority: results.querySelector('[data-investigation-priority]')?.innerText || dialog.querySelector('[data-investigation-priority]')?.innerText,
      history: [...dialog.querySelectorAll('[data-saved-analysis]')].map(node => node.dataset.savedAnalysis),
    };
  });
  assert(view.map.right <= view.results.x + 2 && view.map.width > 200 && view.results.width > 200, 'live map left and results right at ' + width);
  assert(view.dialog.x >= -1 && view.dialog.right <= width + 1 && view.dialog.bottom <= height + 1 && view.dialogOverflow <= 1, 'dialog fits viewport');
  assert(view.priority?.trim(), 'investigation priority');
  assert.deepEqual(view.history, history.jobs.map(row => row.id));
  assert.deepEqual(view.rows.map(row => row.id).sort(), [...categories].sort());
  for (const row of view.rows) {
    const source = job.evidence.causeAssessments.find(item => item.category === row.id);
    assert.equal(row.open, false);
    assert.equal(row.status, source.status);
    assert(row.summary.includes(source.headline), 'current headline ' + row.id);
  }
  for (const [role, id] of [['primary', job.evidence.coverageComparison.primaryTargetId], ['comparison', job.evidence.coverageComparison.comparisonTargetId]]) {
    const target = job.evidence.analysisTargets.find(row => row.id === id);
    const pot = target.mapPoints[0].pot;
    const label = view.mapTargets.find(row => row.role === role && row.pot === pot);
    const percent = target.metrics.find(row => row.label === 'RSRP ≤-105 dBm').value;
    assert.equal(Number(label?.percent), percent, 'source ratio on real map for ' + pot);
    assert(label.text.includes(percent.toFixed(2) + '%'), 'visible source ratio');
    const marker = view.leafletPots.find(node => node.pot === pot && node.role === role);
    assert(marker, 'map renders ' + role + ' POT ' + pot);
    assert.equal(marker.selected, role === 'primary', 'original selection on paired map');
    assert.equal(marker.pressed, marker.selected);
  }
  const imagePath = base + '-' + width + 'x' + height + '.png';
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(imagePath, Buffer.from(shot.data, 'base64'));
  result.screenshots.push(imagePath);
  result.checks.push({ name: 'saved-report-layout', width, height, map: view.map, results: view.results, rows: view.rows, mapTargets: view.mapTargets });
}
async function inspectCategories() {
  const calls = [...job.evidence.calls, ...job.evidence.members];
  let sourceLink;
  for (const source of job.evidence.causeAssessments) {
    const actual = await evaluate(category => {
      const row = document.querySelector('dialog[open] details[data-source-cause="' + category + '"]');
      const summary = row.querySelector('summary');
      summary.click();
      return { open: row.open, text: row.innerText,
        links: [...row.querySelectorAll('a[href]')].map(node => node.href),
        targetIds: [...row.querySelectorAll('[data-source-criteria-inspect]')].map(node => node.dataset.sourceCriteriaInspect),
        hypotheses: [...row.querySelectorAll('[data-cause-category]')].map(node => ({ category: node.dataset.causeCategory, text: node.textContent })),
      };
    }, source.category);
    assert(actual.open);
    assert(actual.text.includes(source.reason), 'expanded source observation ' + source.category);
    assert(actual.text.includes(source.nextCheck), 'source next check ' + source.category);
    for (const text of source.missingEvidence) assert(actual.text.includes(text), 'missing evidence for ' + source.category);
    for (const id of actual.targetIds) assert(job.evidence.analysisTargets.some(row => row.id === id), 'source target resolves');
    const hypotheses = job.report.hypotheses.filter(row => row.category === source.category && ['possible', 'supported'].includes(row.assessment));
    for (const hypothesis of hypotheses) assert(actual.hypotheses.some(row => row.category === source.category && row.text.includes(hypothesis.title)), 'actual model result ' + source.category);
    if (!hypotheses.length) assert.equal(actual.hypotheses.filter(row => row.category === source.category).length, 0, 'no fabricated Qwen hypothesis ' + source.category);
    for (const link of actual.links) {
      const parsed = new URL(link);
      assert.equal(parsed.origin, origin.origin);
      if (!parsed.searchParams.has('call')) continue;
      const matched = calls.find(call => call.href && new URL(call.href, origin).search === parsed.search);
      assert(matched, 'source call link corresponds to a real call of candidate 23');
      sourceLink ||= { href: link, start: matched.start };
    }
    if (source.category === 'coverage') {
      const id = job.evidence.coverageComparison.comparisonTargetId;
      assert(await evaluate(id => {
        const row = document.querySelector('dialog[open] details[data-source-cause="coverage"]');
        const button = row.querySelector('[data-source-criteria-inspect="' + CSS.escape(id) + '"]');
        if (!button) return false;
        const details = button.closest('details');
        if (!details.open) details.querySelector('summary').click();
        button.click(); return true;
      }, id), 'linked comparison POT button');
      await waitFor(() => evaluate(id => {
        const details = document.querySelector('dialog[open] [data-summary-detail="selected-target"]');
        const panel = details?.querySelector('[data-analysis-source="criteria"]');
        const map = document.querySelector('dialog[open] [data-map-panel]');
        // A and B are measurement roles. Inspecting B retains both map labels.
        return details?.open && panel?.dataset.selectedTarget === id && panel.dataset.selectedPot === '38507_77752' &&
          map?.querySelector('select[aria-label="원본 기준 대상 선택"]')?.value === id &&
          !!map.querySelector('.leaflet-container [data-pot-id="38507_77752"][data-pot-role="comparison"][data-pot-selected="true"][aria-pressed="true"]') &&
          !!map.querySelector('.leaflet-container [data-pot-id="38507_77751"][data-pot-role="primary"][data-pot-selected="false"][aria-pressed="false"]');
      }, id), 'active comparison POT in source detail, map selection and original A/B markers');
      result.checks.push({ name: 'comparison-pot-active-with-stable-map-roles', pot: '38507_77752', targetId: id });
    }
    await evaluate(category => document.querySelector('dialog[open] details[data-source-cause="' + category + '"] > summary').click(), source.category);
    result.checks.push({ name: 'expanded-category', category: source.category, sourceTargetCount: actual.targetIds.length, links: actual.links.length, modelHypotheses: hypotheses.length });
  }
  assert(sourceLink, 'disclosures expose an actual original call');
  return sourceLink;
}
async function prompt() {
  const toggle = () => evaluate(() => {
    const button = [...document.querySelectorAll('dialog[open] button')].find(node => node.textContent.trim() === '프롬프트 수정');
    if (!button) return false;
    button.click(); return true;
  });
  const fields = () => evaluate(() => {
    const panel = document.querySelector('dialog[open] [aria-label="프롬프트 수정·테스트"]');
    return {
      system: panel?.querySelector('textarea[aria-label="system 프롬프트 수정"]')?.value,
      user: panel?.querySelector('textarea[aria-label="user 프롬프트 수정"]')?.value,
      raw: panel?.querySelector('pre[aria-label="모델 실제 응답 원문"]')?.textContent,
    };
  });
  assert(await toggle());
  const source = await waitFor(async () => { const value = await fields(); return value.system && value.user && value.raw && value; }, 'saved raw model response and editable prompt');
  assert.equal(source.raw, diagnostics.response.content);
  const userInput = JSON.parse(source.user);
  assert.equal(userInput.versions.prompt, 'candidate-prompt-v10');
  assert.deepEqual(userInput.causeAssessments.map(row => row.category), categories);
  const modified = source.system + '\n저장 보고서 조회 검증용 미전송 초안';
  await evaluate(value => {
    const node = document.querySelector('dialog[open] textarea[aria-label="system 프롬프트 수정"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, modified);
  await waitFor(() => evaluate(() => document.querySelector('dialog[open] [aria-label="프롬프트 수정·테스트"]')?.innerText.includes('미전송 수정사항')), 'draft remains unsent');
  assert(await toggle()); assert(await toggle());
  const retained = await waitFor(async () => { const v = await fields(); return v.system === modified && v.raw && v; }, 'unsent draft retained after reopen');
  assert.equal(retained.user, source.user);
  assert.equal(retained.raw, diagnostics.response.content);
  result.checks.push({ name: 'retained-unsent-prompt-and-original-qwen-response' });
}
async function main() {
  await attach();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await openReport();
  await layout(1920, 1080); await layout(1366, 768);
  const link = await inspectCategories();
  for (const prior of history.jobs.slice(1)) await selectReport(prior.id);
  await selectReport(job.id);
  result.checks.push({ name: 'all-three-saved-reports-restored', ids: history.jobs.map(row => row.id) });
  await prompt();
  assert(await evaluate(href => {
    const dialog = document.querySelector('dialog[open]');
    const anchor = [...dialog.querySelectorAll('details[data-source-cause] a[href]')].find(node => node.href === href);
    if (!anchor) return false;
    for (let ancestor = anchor.parentElement; ancestor !== dialog; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) ancestor.querySelector('summary').click();
    }
    // Keep navigation in this isolated test tab while exercising the application's link.
    anchor.target = '_self'; anchor.click(); return true;
  }, link.href), 'click original call');
  await waitFor(() => evaluate(start => {
    const selected = document.querySelector('table[aria-label="고객 통화 목록"] tr[aria-selected="true"]');
    return !!selected?.querySelector('button[aria-pressed="true"][aria-label="' + CSS.escape(start + ' 통화 분석') + '"]');
  }, link.start), 'selected original source call');
  result.checks.push({ name: 'original-call-navigation', start: link.start });
  assert.deepEqual(result.blockedRequests, []);
  assert.deepEqual(result.runtimeErrors, []);
  assert.equal(result.interceptionError, undefined);
  result.status = 'passed';
}
main().catch(async error => {
  result.status = 'failed';
  result.error = error.stack;
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(base + '-failure.png', Buffer.from(shot.data, 'base64'));
    } catch {}
  }
  process.exitCode = 1;
}).finally(async () => {
  await cleanup();
  persist();
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, blockedRequests: result.blockedRequests, error: result.error }));
});
