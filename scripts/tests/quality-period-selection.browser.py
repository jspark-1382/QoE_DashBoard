"""Browser regression for the two entire-period controls and candidate mode retention.

Run against an existing server; this test never starts analysis jobs or exports.
python scripts/tests/quality-period-selection.browser.py --base http://127.0.0.1:3001 --out outputs/period-retention-release/verified
"""
import argparse
import asyncio
import json
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from playwright.async_api import async_playwright


LABEL_ALL = "전체 기간 후보 분석 (기본)"
LABEL_EVAL = "알고리즘 성능 검증 (기간 분리)"
LABEL_TOP = "전체 분석기간 조회"
DATES = [f"2026-10-{day}" for day in range(26, 31)]
SNAPSHOT = """() => {
 const labels=['전체 분석기간 조회','전체 기간 후보 분석 (기본)','알고리즘 성능 검증 (기간 분리)'];
 return {url:location.href,
 fields:Object.fromEntries([...document.querySelectorAll('select,input')].filter(n=>['분석 시작일','분석 종료일','시작 시간','종료 시간'].includes(n.getAttribute('aria-label'))).map(n=>[n.getAttribute('aria-label'),n.value])),
 buttons:[...document.querySelectorAll('button')].filter(n=>labels.includes(n.getAttribute('aria-label'))&&n.getBoundingClientRect().width>0).map(n=>({label:n.getAttribute('aria-label'),pressed:n.getAttribute('aria-pressed'),disabled:n.disabled,style:Object.fromEntries(['backgroundColor','borderColor','color','opacity'].map(k=>[k,getComputedStyle(n)[k]]))})),
 candidateMetrics:document.querySelector('[aria-label="개선 후보 핵심 현황"]')?.innerText};
}"""


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:3001")
    parser.add_argument("--out", default="outputs/period-retention-release/verified")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    states, checks, requests, summaries, blocked, errors = [], [], [], [], [], []
    response_tasks = set()
    failure = None

    def check(name, passed, detail=None):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1707, "height": 1100})

        async def guard(route):
            request = route.request
            if ("/api/analysis/jobs" in request.url and request.method != "GET") or "/api/voice/export" in request.url:
                blocked.append({"url": request.url, "method": request.method})
                await route.abort()
                return
            await route.continue_()

        await context.route("**/*", guard)
        page = await context.new_page()
        page.set_default_timeout(90000)
        page.on("pageerror", lambda error: errors.append(str(error)))

        def on_request(request):
            if "/api/voice/query" in request.url:
                body = request.post_data_json
                requests.append({"url": request.url, "op": body.get("op"), "scope": body.get("scope")})

        async def on_summary(response):
            try:
                body = await response.json()
                summaries.append({"url": response.url, "status": response.status,
                                  **{key: body.get(key) for key in ("scope", "scopeKey", "discoveryDates", "validationDates")}})
            except Exception as error:
                summaries.append({"url": response.url, "status": response.status, "error": str(error)})

        def on_response(response):
            if "/quality-improvement-mixed-" in response.url and response.url.endswith("/summary.json"):
                task = asyncio.create_task(on_summary(response))
                response_tasks.add(task)
                task.add_done_callback(response_tasks.discard)

        page.on("request", on_request)
        page.on("response", on_response)
        all_button = page.get_by_label(LABEL_ALL, exact=True)
        evaluation = page.get_by_label(LABEL_EVAL, exact=True)
        top_all = page.get_by_label(LABEL_TOP, exact=True)

        async def ready_current():
            await page.get_by_label("주요 QoE 품질 지표", exact=True).wait_for()
            await page.wait_for_function("!document.querySelector('[aria-label=\"전체 분석기간 조회\"]').disabled")

        async def ready_candidates():
            await page.get_by_role("region", name="개선 후보 지역 목록", exact=True).wait_for()
            await all_button.wait_for()

        async def capture(name, expected_mode):
            await page.mouse.move(1690, 20)
            await page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            state = await page.evaluate(SNAPSHOT)
            state["name"] = name
            states.append(state)
            buttons = {button["label"]: button for button in state["buttons"]}
            expected_all = expected_mode == "all"
            check(name + ": inner all", buttons[LABEL_ALL]["pressed"] == str(expected_all).lower(), buttons[LABEL_ALL])
            check(name + ": evaluation", buttons[LABEL_EVAL]["pressed"] == str(not expected_all).lower(), buttons[LABEL_EVAL])
            check(name + ": top period remains all", buttons[LABEL_TOP]["pressed"] == "true", buttons[LABEL_TOP])
            check(name + ": date and time fields", list(state["fields"].values()) == [DATES[0], DATES[-1], "00:00", "23:59"], state["fields"])
            query = parse_qs(urlparse(state["url"]).query)
            check(name + ": URL period", [query.get(key, [None])[0] for key in ("dateStart", "dateEnd", "from", "to")] == [DATES[0], DATES[-1], "00:00", "23:59"], state["url"])
            check(name + ": distinct selected appearance", buttons[LABEL_ALL]["style"]["backgroundColor"] != buttons[LABEL_EVAL]["style"]["backgroundColor"], buttons)
            expected_metric = "범위 재검토 지역" if expected_all else "새 고객 재관측 지역"
            check(name + ": candidate content follows mode", expected_metric in (state["candidateMetrics"] or ""), state["candidateMetrics"])
            await page.screenshot(path=str(out / (name + ".png")))
            controls = page.get_by_label("개선 2안 분석 설정", exact=True)
            await controls.screenshot(path=str(out / (name + "-controls.png")))
            print(json.dumps({"stage": name, "expectedMode": expected_mode, "innerAll": buttons[LABEL_ALL]["pressed"], "evaluation": buttons[LABEL_EVAL]["pressed"]}), flush=True)

        async def roundtrip():
            await page.get_by_role("button", name="품질현황", exact=True).click()
            await ready_current()
            await page.get_by_role("button", name="개선후보", exact=True).click()
            await ready_candidates()

        try:
            query = urlencode({"variant": "improvement2", "dateStart": DATES[-1], "dateEnd": DATES[-1], "mapMode": "current"})
            await page.goto(args.base.rstrip("/") + "/qoe/?" + query, wait_until="domcontentloaded")
            await ready_current()
            await top_all.click()
            await page.wait_for_function("document.querySelector('[aria-label=\"분석 시작일\"]').value==='2026-10-26'")
            await page.get_by_role("button", name="개선후보", exact=True).click()
            await ready_candidates()
            await capture("initial-all", "all")
            await evaluation.click()
            await ready_candidates()
            await capture("manual-evaluation", "evaluation")
            await roundtrip()
            await capture("evaluation-roundtrip", "evaluation")
            # Explicitly select evaluation again if the baseline lost it on remount.
            if await evaluation.get_attribute("aria-pressed") != "true":
                await evaluation.click()
                await ready_candidates()
            # Dates already equal the full range; this must still switch analysis mode.
            await top_all.click()
            await ready_candidates()
            await capture("top-all-resets-mode", "all")
            await roundtrip()
            await capture("all-roundtrip", "all")
            if response_tasks:
                await asyncio.gather(*response_tasks)
            for mode, prefix, discovery, validation in [
                ("all", "/quality-improvement-mixed-full/", DATES, []),
                ("evaluation", "/quality-improvement-mixed-evaluation/", DATES[:-1], DATES[-1:]),
            ]:
                matching = [row for row in summaries if prefix in row["url"]]
                check(mode + ": source summary loaded", bool(matching), matching)
                for row in matching:
                    scope = row.get("scope") or {}
                    check(mode + ": source dates and times", [scope.get(key) for key in ("dateStart", "dateEnd", "from", "to")] == [DATES[0], DATES[-1], "00:00", "23:59"], row)
                    check(mode + ": source discovery and validation dates", row.get("discoveryDates") == discovery and row.get("validationDates") == validation, row)
            check("no page errors", not errors, errors)
            check("no attempted jobs or exports", not blocked, blocked)
            failed = [row["name"] for row in checks if not row["passed"]]
            assert not failed, "; ".join(failed)
        except Exception:
            failure = traceback.format_exc()
            (out / "error.txt").write_text(failure, encoding="utf-8")
            await page.screenshot(path=str(out / "failure.png"))
            raise
        finally:
            if response_tasks:
                await asyncio.gather(*response_tasks, return_exceptions=True)
            result = {"passed": failure is None, "checks": checks, "states": states, "sourceSummaries": summaries,
                      "queryRequests": requests, "blockedMutations": blocked, "pageErrors": errors, "failure": failure}
            (out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"passed": result["passed"], "checks": len(checks), "failedChecks": [row["name"] for row in checks if not row["passed"]], "out": str(out)}), flush=True)
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
