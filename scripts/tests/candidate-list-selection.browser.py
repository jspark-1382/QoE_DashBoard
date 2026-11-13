"""Verify selection, repeat selection, and scoped scrolling on the real improvement candidates page."""
import os
from playwright.sync_api import expect, sync_playwright


def check_selection(page, display):
    rows = page.locator(f'[data-candidate-list="{display}"]')
    buttons = rows.locator('button[data-candidate-id]')
    expect(buttons.first).to_be_visible()
    chosen = buttons.last
    candidate_id = chosen.get_attribute('data-candidate-id')
    marker = page.locator(f'path[data-candidate-id="{candidate_id}"]')
    expect(marker).to_be_visible()
    # A previous run through this workspace may have panned away. Normalize
    # the test's camera using the list before testing selection in the map.
    chosen.click()
    expect(marker).to_have_attribute('aria-pressed','true')
    page.wait_for_function("""id=>{
        const m=document.querySelector('path[data-candidate-id="'+id+'"]');
        const p=m.getBoundingClientRect(),b=m.closest('.leaflet-container').getBoundingClientRect();
        return p.width>0 && p.left>=b.left && p.right<=b.right && p.top>=b.top && p.bottom<=b.bottom;
    }""",arg=candidate_id)
    assert rows.evaluate('list => list.scrollHeight > list.clientHeight')
    scroll = page.evaluate('window.scrollY')
    rows.evaluate('list => {list.scrollTop = 0}')
    for event in ('Enter', 'Space'):
        marker.evaluate('el => el.focus({preventScroll:true})')
        page.keyboard.press(event)
        expect(chosen).to_have_attribute('aria-pressed','true')
        page.wait_for_function("""display => {
            const list = document.querySelector('[data-candidate-list="' + display + '"]');
            const selected = list.querySelector('button[aria-pressed="true"]');
            const bounds = selected.getBoundingClientRect(), top = list.getBoundingClientRect().top + list.clientTop;
            return list.scrollTop > 0 && bounds.top >= top - 1 && bounds.bottom <= top + list.clientHeight + 1;
        }""",arg=display)
        assert abs(page.evaluate('window.scrollY') - scroll) <= 1
        expect(marker).to_be_focused()
        rows.evaluate('list => {list.scrollTop=0}')
    buttons.first.click()
    first_id = buttons.first.get_attribute('data-candidate-id')
    first_marker = page.locator(f'path[data-candidate-id="{first_id}"]')
    expect(first_marker).to_have_attribute('aria-pressed','true')
    # Pan away and then click the same list row. The candidate should return
    # inside the map without a zoom reset or a second selection.
    map_view = page.locator('.leaflet-container').first
    map_view.scroll_into_view_if_needed()
    map_bounds = map_view.bounding_box()
    origin = first_marker.bounding_box()
    start_y = map_bounds['y'] + map_bounds['height'] * .6
    a,b = [.24,.85] if origin['x'] > map_bounds['x']+map_bounds['width']/2 else [.80,.15]
    tile_level = map_view.locator('.leaflet-tile-pane .leaflet-tile-container').last
    zoom = tile_level.evaluate('el => el.style.zIndex')
    for _ in range(4):
        page.mouse.move(map_bounds['x']+map_bounds['width']*a,start_y)
        page.mouse.down()
        page.mouse.move(map_bounds['x']+map_bounds['width']*b,start_y,steps=10)
        page.mouse.up()
        page.wait_for_timeout(430)
        outside = first_marker.evaluate("""el => {
            const p=el.getBoundingClientRect(), m=el.closest('.leaflet-container').getBoundingClientRect();
            return p.right < m.left || p.left > m.right;
        }""")
        if outside:
            break
    assert outside, 'map pan did not place selected marker outside its viewport'
    buttons.first.click()
    page.wait_for_function("""id => {
        const el = Array.from(document.querySelectorAll('path[data-candidate-id]')).find(p=>p.dataset.candidateId===id);
        const p=el.getBoundingClientRect(), m=el.closest('.leaflet-container').getBoundingClientRect();
        return p.width>0 && p.left>=m.left && p.right<=m.right && p.top>=m.top && p.bottom<=m.bottom;
    }""",arg=first_id)
    # Leaflet tile z-index / active level is stable even though visible tile URLs changed.
    assert zoom and tile_level.evaluate('el => el.style.zIndex') == zoom


def main():
    origin = os.environ.get('QOE_QA_ORIGIN','http://127.0.0.1:3001')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome',headless=True)
        page = browser.new_page(viewport={'width':1440,'height':900})
        page.goto(origin + '/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&distributionMode=mos&evidence=all&mapMode=improvement',wait_until='domcontentloaded')
        model = page.get_by_role('combobox',name='개선 후보 알고리즘',exact=True)
        expect(model).to_be_visible(timeout=60000)
        for algorithm in ('dbscan','hdbscan'):
            model.select_option(algorithm)
            if algorithm != 'dbscan':
                expect(page.get_by_role('region',name='선택 모델 개선 후보 목록')).to_be_visible()
            check_selection(page,'normal')
            page.get_by_role('button',name='지도 전체 화면',exact=True).click()
            expect(page.locator('.leaflet-tooltip.quality-candidate-label-active')).to_be_visible()
            check_selection(page,'fullscreen')
            page.get_by_role('button',name='전체 화면 닫기',exact=True).click()
        browser.close()


if __name__ == '__main__':
    main()
