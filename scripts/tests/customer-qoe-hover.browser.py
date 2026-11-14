"""Check hover performance without changing chart values or starting analysis jobs.

Run against an existing preview with --base and save evidence with --out.
"""
import argparse
import asyncio
import hashlib
import json
import traceback
from pathlib import Path
from playwright.async_api import async_playwright


SERIES = """() => {
 const chart=document.querySelector('[aria-label="선택 고객 통화별 QoE 추이"]');
 return {viewBox:chart.getAttribute('viewBox'),connectors:[...chart.querySelectorAll('polyline')].map(n=>({points:n.getAttribute('points'),stroke:n.getAttribute('stroke')})),points:[...chart.querySelectorAll('[data-call-id]')].map(n=>({id:n.dataset.callId,qoe:n.dataset.qoe,drop:n.dataset.drop,unscored:n.dataset.unscored,shapes:[...n.querySelectorAll('circle,path')].map(c=>({tag:c.tagName,cx:c.getAttribute('cx'),cy:c.getAttribute('cy'),d:c.getAttribute('d'),fill:c.getAttribute('fill')}))}))};
}"""


async def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base',default='http://127.0.0.1:3001')
    parser.add_argument('--out',default='outputs/cleanup-audit/customer-hover')
    args=parser.parse_args()
    out=Path(args.out).resolve()
    out.mkdir(parents=True,exist_ok=True)
    errors=[]
    blocked=[]
    result={'passed':False}
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='chrome',headless=True)
        page=await browser.new_page(viewport={'width':1707,'height':1100})
        page.set_default_timeout(90000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        async def guard(route):
            request=route.request
            if ('/api/analysis/jobs' in request.url and request.method!='GET') or '/api/voice/export' in request.url:
                blocked.append(request.url)
                await route.abort()
            else:
                await route.continue_()
        await page.route('**/*',guard)
        try:
            await page.goto(args.base.rstrip('/')+'/qoe/customer-screening',wait_until='domcontentloaded')
            await page.wait_for_function("document.querySelector('[data-timeline-customer]')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('[data-call-id]').length>10")
            before=await page.evaluate(SERIES)
            await page.evaluate("""() => {
              window.__qoeHoverParseCount=0;
              window.__qoeOriginalDateParse=Date.parse;
              Date.parse=function(...args){window.__qoeHoverParseCount++;return window.__qoeOriginalDateParse.apply(Date,args);};
            }""")
            tooltips=[]
            point_count=len(before['points'])
            for index in range(10):
                point=page.locator('[data-call-id]').nth(index*(point_count-1)//10)
                await point.evaluate("n=>n.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}))")
                await page.evaluate("() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
                tooltips.append(await page.locator('[data-timeline-customer] [aria-live="polite"]').inner_text())
                await point.evaluate("n=>n.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:null}))")
                await page.evaluate("() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
            parse_count=await page.evaluate("() => {const count=window.__qoeHoverParseCount;Date.parse=window.__qoeOriginalDateParse;return count;}")
            after=await page.evaluate(SERIES)
            digest=lambda value:hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
            result={'passed':False,'url':page.url,'hoverEvents':10,'chartPoints':point_count,'dateParseCalls':parse_count,
                    'beforeSeriesSha256':digest(before),'afterSeriesSha256':digest(after),'uniqueTooltipCount':len(set(tooltips)),
                    'tooltips':tooltips,'pageErrors':errors,'blockedMutations':blocked}
            assert len(set(tooltips))==10,'Hover tooltip did not follow all ten points'
            assert before==after,'Hover changed chart data, geometry or colors'
            assert not errors,errors
            assert not blocked,blocked
            # Geometry should be reused during hover-only renders. Permit two
            # unrelated parse calls without tying the test to React hook syntax.
            assert parse_count<=2,f'Hover-only rendering reparsed chart dates {parse_count} times'
            result['passed']=True
        except Exception:
            result['failure']=traceback.format_exc()
            raise
        finally:
            await page.evaluate("() => {if(window.__qoeOriginalDateParse)Date.parse=window.__qoeOriginalDateParse;}")
            (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({key:result.get(key) for key in ('passed','chartPoints','dateParseCalls','uniqueTooltipCount','beforeSeriesSha256','afterSeriesSha256')}),flush=True)
            await browser.close()


if __name__=='__main__':
    asyncio.run(main())
