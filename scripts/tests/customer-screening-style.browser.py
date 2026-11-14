"""Customer dashboard visual/behavioral QA against an already running server.

No AI analysis jobs or exports are permitted by this check.
python scripts/tests/customer-screening-style.browser.py --base http://127.0.0.1:3017 --out outputs/customer-style-release/verified
"""
import argparse
import asyncio
import hashlib
import json
import traceback
from pathlib import Path

from playwright.async_api import async_playwright

SCOPE = {"dateStart": "2026-10-26", "dateEnd": "2026-10-30", "from": "00:00", "to": "23:59"}
STATE = """() => {
 const box=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,overflow:getComputedStyle(n).overflow}};
 const panel=(text)=>[...document.querySelectorAll('h2,h3')].find(n=>n.textContent===text)?.closest('section');
 const preview=document.querySelector('[data-preview-customer]');
 const timeline=document.querySelector('[data-timeline-customer]');
 const visible=n=>n.getClientRects().length&&!n.closest('[hidden]');
 const allButtons=[...document.querySelectorAll('button,input,select,a')].filter(visible);
 return {viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},scroll:{x:scrollX,y:scrollY},
 boxes:{distribution:box(panel('고객군 분포')),ranking:box(panel('저품질 통화 집중 고객 TOP 10')),rankingLastRow:box(panel('저품질 통화 집중 고객 TOP 10')?.querySelector('tbody tr:last-child')),rankingScroll:box(panel('저품질 통화 집중 고객 TOP 10')?.querySelector('table')?.parentElement),criteria:box(panel('선별 기준 요약')),map:box(document.querySelector('[aria-label="문제 고객 분석 지도"]')),timeline:box(timeline),preview:box(preview?.closest('section')),previewBody:box(preview),daily:box(preview?.querySelector('svg[aria-label^="일별 전체"]')),dailyCaption:box(preview?.querySelector('figure>figcaption')),metrics:box(preview?.querySelector('dl'))},
 preview:{id:preview?.dataset.previewCustomer,text:preview?.innerText,dailyLabels:[...preview?.querySelectorAll('svg [data-day]')||[]].map(n=>({date:n.dataset.day,text:n.textContent})),metrics:[...preview?.querySelectorAll('dl>div')||[]].map(n=>n.innerText)},
 timeline:{id:timeline?.dataset.timelineCustomer,total:timeline?.querySelector('[data-timeline-total]')?.dataset.timelineTotal,points:timeline?.querySelectorAll('[data-call-id]').length,labels:[...timeline?.querySelectorAll('svg text')||[]].map(n=>({text:n.textContent,height:n.getBoundingClientRect().height}))},
 colors:{blue:timeline?.querySelector('polyline')?.getAttribute('stroke'),poor:timeline?.querySelector('[data-poor-region]')?.getAttribute('fill'),threshold:timeline?.querySelector('[data-threshold]')?.getAttribute('stroke'),daily:[...preview?.querySelectorAll('[data-segment]')||[]].map(n=>n.getAttribute('fill'))},
 buttons:allButtons.filter(n=>/AI 분석|고객·통화 상세/.test(n.textContent)).map(n=>({text:n.textContent,box:box(n)}))};
}"""
CHART = """() => {
 const chart=document.querySelector('[aria-label="선택 고객 통화별 QoE 추이"]');
 return chart?{viewBox:chart.getAttribute('viewBox'),connectors:[...chart.querySelectorAll('polyline')].map(n=>({points:n.getAttribute('points'),stroke:n.getAttribute('stroke')})),points:[...chart.querySelectorAll('[data-call-id]')].map(n=>({id:n.dataset.callId,qoe:n.dataset.qoe,drop:n.dataset.drop,unscored:n.dataset.unscored,circle:[...n.querySelectorAll('circle')].map(c=>({cx:c.getAttribute('cx'),cy:c.getAttribute('cy'),fill:c.getAttribute('fill')})),path:[...n.querySelectorAll('path')].map(c=>({d:c.getAttribute('d'),fill:c.getAttribute('fill')}))}))}:null;
}"""


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:3001")
    parser.add_argument("--out", default="outputs/customer-style-release/verified")
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--layout-only", action="store_true")
    parser.add_argument("--baseline-json")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    checks, states, errors, blocked, screening_requests = [], [], [], [], []
    failure = None

    def check(name, passed, detail=None):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1707, "height": 1100}, device_scale_factor=1)

        async def guard(route):
            request = route.request
            if ("/api/analysis/jobs" in request.url and request.method != "GET") or "/api/voice/export" in request.url:
                blocked.append({"url": request.url, "method": request.method})
                await route.abort()
                return
            if "/api/voice/query" in request.url:
                data = request.post_data_json
                if isinstance(data, dict) and data.get("op") == "screening":
                    screening_requests.append(data)
            await route.continue_()

        await context.route("**/*", guard)
        page = await context.new_page()
        page.set_default_timeout(90000)
        page.on("pageerror", lambda error: errors.append(str(error)))

        async def ready():
            await page.locator('[data-preview-customer]').wait_for()
            await page.wait_for_function("document.querySelector('[data-timeline-customer]')?.getAttribute('aria-busy')==='false'&&!!document.querySelector('[data-call-id]')")
            await page.wait_for_function("!!document.querySelector('.leaflet-container')")
            await page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")

        async def capture(name, desktop=True, screenshot=True):
            await page.evaluate("scrollTo(0,0)")
            await page.mouse.move(1, 1)
            state = await page.evaluate(STATE)
            state["name"] = name
            states.append(state)
            boxes = state["boxes"]
            check(name + ": no page horizontal overflow", state["document"]["width"] <= state["viewport"]["width"] + 1, state["document"])
            if desktop:
                check(name + ": original upper three columns", boxes["distribution"]["x"] < boxes["ranking"]["x"] < boxes["criteria"]["x"] and max(boxes[k]["y"] for k in ("distribution", "ranking", "criteria")) - min(boxes[k]["y"] for k in ("distribution", "ranking", "criteria")) < 3, boxes)
                check(name + ": original map-left right-stack", boxes["map"]["x"] < boxes["timeline"]["x"] and boxes["preview"]["y"] >= boxes["timeline"]["bottom"] - 2, boxes)
                check(name + ": entire preview fits viewport", boxes["preview"]["bottom"] <= state["viewport"]["height"] + 1 and boxes["metrics"]["bottom"] <= state["viewport"]["height"] + 1 and boxes["daily"]["bottom"] <= state["viewport"]["height"] + 1, boxes)
                check(name + ": daily chart and caption inside preview", boxes["daily"]["bottom"] <= boxes["preview"]["bottom"] + 1 and boxes["dailyCaption"]["bottom"] <= boxes["preview"]["bottom"] + 1, boxes)
                check(name + ": tenth ranking row visible", boxes["rankingLastRow"]["bottom"] <= boxes["rankingScroll"]["bottom"] + 1, boxes)
                check(name + ": preview body not clipped", boxes["previewBody"]["scrollHeight"] <= boxes["previewBody"]["clientHeight"] + 2, boxes["previewBody"])
                check(name + ": readable plot labels", bool(state["timeline"]["labels"]) and all(label["height"] >= 9 for label in state["timeline"]["labels"]), state["timeline"]["labels"])
                for action in state["buttons"]:
                    check(name + ": preview action in viewport", action["box"]["bottom"] <= state["viewport"]["height"] + 1, action)
            else:
                check(name + ": readable stacked preview", boxes["previewBody"]["width"] >= state["viewport"]["width"] - 65, boxes)
            if screenshot:
                await page.screenshot(path=str(out / (name + ".png")), full_page=args.baseline or not desktop)
            print(json.dumps({"stage": name, "previewBottom": boxes["preview"]["bottom"], "height": state["viewport"]["height"]}), flush=True)
            return state

        try:
            response = await context.request.post(args.base.rstrip("/") + "/qoe/api/voice/query", data={"op": "screening", "scope": SCOPE, "query": "", "filter": "all", "sort": "poor", "page": 0, "pageSize": 25, "selectedId": "", "areaId": "", "cellId": ""})
            assert response.ok, await response.text()
            source = await response.json()
            selected = source["selected"]
            first, second = source["topRows"][:2]
            await page.goto(args.base.rstrip("/") + "/qoe/customer-screening", wait_until="domcontentloaded")
            await ready()
            initial = await capture("desktop-1707")
            chart = await page.evaluate(CHART)
            chart_hash = hashlib.sha256(json.dumps(chart, sort_keys=True).encode()).hexdigest()
            check("initial source customer", initial["preview"]["id"] == selected["id"], initial["preview"])
            check("initial source timeline count", int(initial["timeline"]["total"]) == selected["total"], initial["timeline"])
            check("original semantic chart colors", initial["colors"]["blue"] == "#408dde" and initial["colors"]["poor"] == "#fff0f3" and set(initial["colors"]["daily"]) == {"#3d8fe1", "#ee5262"}, initial["colors"])
            expected_metrics = [("평균 QoE", "미평가" if selected["mean"] is None else f'{selected["mean"]:.2f}'), ("QoE 평가 통화", str(selected["eligible"])), ("Drop 통화", str(selected["drop"])), ("저품질 발생 일수", str(selected["repeatedDays"]))]
            metrics = ["".join(value.split()).replace(",", "") for value in initial["preview"]["metrics"]]
            for label, value in expected_metrics:
                check("source preview metric " + label, any("".join(label.split()) + value in metric for metric in metrics), metrics)
            for index, day in enumerate(initial["preview"]["dailyLabels"]):
                check("source daily values " + day["date"], str(selected["dailyPoor"][index]) + "/" + str(selected["dailyTotal"][index]) in day["text"], day)
            if args.baseline_json:
                old = json.loads(Path(args.baseline_json).read_text(encoding="utf-8"))
                check("source report unchanged", old["source"]["report"] == source["report"], source["report"])
                check("source selected customer unchanged", old["source"]["selected"] == selected, selected)
                check("timeline values geometry and semantic colors unchanged", old["chartHash"] == chart_hash, {"before": old["chartHash"], "after": chart_hash})
            for width, height in [(1920, 1080), (1366, 900)]:
                await page.set_viewport_size({"width": width, "height": height})
                await capture("desktop-" + str(width))
            if not args.baseline:
                await page.set_viewport_size({"width": 1366, "height": 850})
                await page.evaluate("scrollTo(0,0)")
                short = await page.evaluate(STATE)
                short["name"] = "short-850-before-scroll"
                states.append(short)
                boxes = short["boxes"]
                check("short 850: no horizontal page overflow", short["document"]["width"] <= 1367, short["document"])
                check("short 850: preview body not clipped", boxes["previewBody"]["scrollHeight"] <= boxes["previewBody"]["clientHeight"] + 2, boxes["previewBody"])
                check("short 850: daily caption and metrics inside preview", max(boxes["dailyCaption"]["bottom"], boxes["metrics"]["bottom"]) <= boxes["preview"]["bottom"] + 1, boxes)
                await page.locator('[data-preview-customer]').locator('xpath=ancestor::section[1]').scroll_into_view_if_needed()
                # A normal page wheel also exposes the outer card border; the
                # browser's nearest-alignment helper can stop a fractional pixel early.
                await page.mouse.move(1353, 840)
                await page.mouse.wheel(0, 500)
                await page.wait_for_function("document.querySelector('[data-preview-customer]').closest('section').getBoundingClientRect().bottom <= innerHeight + 1")
                reachable = await page.evaluate(STATE)
                reachable["name"] = "short-850-after-scroll"
                states.append(reachable)
                check("short 850: complete preview reachable by normal page scroll", reachable["boxes"]["preview"]["y"] >= -1 and reachable["boxes"]["preview"]["bottom"] <= 851, reachable["boxes"])
                for action in reachable["buttons"]:
                    check("short 850: preview action reachable", action["box"]["y"] >= -1 and action["box"]["bottom"] <= 851, action)
                await page.screenshot(path=str(out / "short-850-reachable.png"))
            if not args.baseline and not args.layout_only:
                await page.set_viewport_size({"width": 1707, "height": 1100})
                await page.get_by_role("button", name=second["number"], exact=True).first.click()
                await ready()
                check("table selects second customer in preview and timeline", await page.locator('[data-preview-customer]').get_attribute("data-preview-customer") == second["id"] and await page.locator('[data-timeline-customer]').get_attribute("data-timeline-customer") == second["id"], second["number"])
                check("table selects customer route map", await page.get_by_label("선택 고객 위치흐름", exact=True).get_attribute("aria-pressed") == "true")
                await page.get_by_role("button", name=first["number"], exact=True).first.click()
                await ready()
                timeline = page.get_by_role("region", name="선택 고객 통화 품질 추이", exact=True)
                await timeline.get_by_role("button", name="하루 확대", exact=True).click()
                await page.get_by_label("통화 품질 추이 날짜", exact=True).select_option("2026-10-30")
                await page.wait_for_function("count => document.querySelectorAll('[data-call-id]').length === count", arg=selected["dailyTotal"][-1])
                check("day view actual call count", await page.locator('[data-call-id]').count() == selected["dailyTotal"][-1])
                await timeline.get_by_role("button", name="기간 전체", exact=True).click()
                await page.wait_for_function("count => document.querySelectorAll('[data-call-id]').length === count", arg=selected["total"])
                point = page.locator('[data-call-id]').first
                await point.focus()
                await point.press("ArrowRight")
                check("timeline point keyboard selection exposes detail link", await page.get_by_role("link", name="통화 상세 →", exact=True).is_visible())
                criteria = page.locator('[data-timeline-criteria]')
                await criteria.locator('summary').click()
                check("timeline criteria disclosure opens", await criteria.get_attribute("open") is not None and await criteria.locator('p').is_visible())
                check("expanded timeline criteria is not clipped", await criteria.evaluate("n=>n.scrollHeight<=n.clientHeight+2"))
                await criteria.locator('summary').click()
                source_note = page.locator('[data-customer-screening] main>details')
                await source_note.locator('summary').click()
                check("source criteria disclosure opens", await source_note.get_attribute("open") is not None and await source_note.locator('p').is_visible())
                check("expanded source note is not clipped", await source_note.evaluate("n=>n.scrollHeight<=n.clientHeight+2"))
                await source_note.locator('summary').click()
                await page.get_by_role("button", name="Drop 기준", exact=True).click()
                await ready()
                check("Drop ranking sort query", screening_requests[-1]["sort"] == "drop")
                await page.get_by_role("button", name="반복 기준", exact=True).click()
                await ready()
                check("repeat ranking sort query", screening_requests[-1]["sort"] == "repeat")
                await page.get_by_title("필터 초기화", exact=True).click()
                await ready()
                await page.get_by_label("고객현황 조건", exact=True).select_option("repeat")
                await ready()
                check("customer filter query", screening_requests[-1]["filter"] == "repeat")
                await page.get_by_title("필터 초기화", exact=True).click()
                await ready()
                await page.get_by_role("button", name="고객 목록", exact=True).click()
                dialog = page.get_by_role("dialog", name="고객 목록에서 선택", exact=True)
                await dialog.wait_for()
                await page.get_by_label("목록 내 서비스계약번호 검색", exact=True).fill(first["number"])
                await dialog.get_by_role("button", name=first["number"], exact=True).wait_for()
                await dialog.get_by_role("button", name=first["number"], exact=True).click()
                await ready()
                check("customer search list selection", not await dialog.is_visible() and await page.locator('[data-preview-customer]').get_attribute("data-preview-customer") == first["id"])
                await page.get_by_role("tab", name="AI 분석", exact=True).click()
                check("preview AI tab opens without starting analysis", await page.get_by_role("tabpanel", name="AI 분석", exact=True).is_visible())
                await page.get_by_role("tab", name="고객 현황", exact=True).click()
                check("preview overview tab restores all metrics", await page.locator('[data-preview-customer] dl>div').count() == 4)
                await page.get_by_role("button", name="전체 지도", exact=True).click()
                await page.get_by_role("dialog", name="문제 고객 분석 지도", exact=True).wait_for()
                await page.keyboard.press("Escape")
                check("map fullscreen Escape closes", await page.get_by_role("dialog", name="문제 고객 분석 지도", exact=True).count() == 0)
                await page.get_by_title("필터 초기화", exact=True).click()
                await ready()
                for width, height in [(680, 1000), (390, 844)]:
                    await page.set_viewport_size({"width": width, "height": height})
                    await capture("mobile-" + str(width), desktop=False)
                    await page.locator('[data-preview-customer]').scroll_into_view_if_needed()
                    check("mobile " + str(width) + ": metrics remain reachable", await page.locator('[data-preview-customer] dl').is_visible())
            check("no browser errors", not errors, errors)
            check("no attempted analysis jobs or exports", not blocked, blocked)
            if not args.baseline:
                failed = [row["name"] for row in checks if not row["passed"]]
                assert not failed, "; ".join(failed)
        except Exception:
            failure = traceback.format_exc()
            (out / "error.txt").write_text(failure, encoding="utf-8")
            await page.screenshot(path=str(out / "failure.png"))
            raise
        finally:
            result = {"passed": failure is None and (args.baseline or all(row["passed"] for row in checks)), "baseline": args.baseline, "checks": checks, "states": states, "source": locals().get("source"), "chartHash": locals().get("chart_hash"), "errors": errors, "blockedMutations": blocked, "screeningRequests": screening_requests, "failure": failure}
            (out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"passed": result["passed"], "baseline": args.baseline, "checks": len(checks), "failedChecks": [row["name"] for row in checks if not row["passed"]], "out": str(out)}), flush=True)
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
