// 그리기 도구 오른쪽 클릭 점검: 도구를 고른 뒤 오른쪽 클릭하면 도구가 풀리고(Esc와 같음) 메뉴는 안 뜸
// 가짜 바이낸스로 돌려 봄 · 준비: npm i playwright lightweight-charts@5.2.1 · 실행: node tests/e2e_tools.js
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'), path = require('path');
const HTML = path.join(__dirname, '..', 'index.html');
const LWC = fs.readFileSync(path.join(path.dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.standalone.production.js'), 'utf8');
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const NOW = Date.parse('2026-11-26T07:27:00Z'), H4 = 144e5;
const LISTS = [{ name: '내 관심목록', items: ['BINANCE:BTCUSDT', '###새 구역', 'YAHOO:NVDA', 'YAHOO:PLTR'] }];

(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.routeWebSocket(/.*/, () => {});
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.host === 'app.test') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(HTML) });
    if (u.href.includes('lightweight-charts')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LWC });
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/exchangeInfo')) return json({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', underlyingType: 'COIN', pricePrecision: 1, onboardDate: Date.parse('2019-09-09'), filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] });
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/klines')) {
      const lim = Math.min(+u.searchParams.get('limit') || 500, 1500), end = Math.floor(Math.min(+u.searchParams.get('endTime') || NOW, NOW) / H4) * H4, out = [];
      for (let t = end - (lim - 1) * H4; t <= end; t += H4) { const o = 60000 + 3000 * Math.sin(t / H4 / 40), c = o + 400 * Math.sin(t / H4 / 3); out.push([t, o.toFixed(1), (Math.max(o, c) + 300).toFixed(1), (Math.min(o, c) - 300).toFixed(1), c.toFixed(1), '100', t + H4 - 1, '1', 10, '0', '0', '0']); }
      return json(out);
    }
    return json({}, 404);
  });
  await page.addInitScript(([lists]) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('mc.v1', JSON.stringify({ lists, active: 0, tf: '4h', key: 'BINANCE:BTCUSDT', sideTab: 'wl', view: 'chart' }));
  }, [LISTS]);
  await page.goto('http://app.test/index.html');
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 100, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const listsStart = await page.evaluate(() => JSON.parse(localStorage.getItem('mc.v1')).lists);

  const r = await page.evaluate(() => { const b = document.getElementById('chart').getBoundingClientRect(); return { x: b.left + b.width * 0.45, y: b.top + b.height * 0.3 }; });
  const st = () => page.evaluate(() => ({ tool: CH.state.tool, creating: !!CH.drawings.creating, n: CH.drawings.list.length, menu: !!document.querySelector('.menu.ctx'), cursorOn: !!document.querySelector('#tools [data-tool="cursor"].on') }));
  const closeMenu = () => page.evaluate(() => document.querySelectorAll('.menu').forEach(m => m.remove()));

  // 1) 도구만 고르고 오른쪽 클릭 → 도구 풀림, 메뉴 없음
  await page.evaluate(() => CH.setTool('trend'));
  ok((await st()).tool === 'trend', '추세선 도구 고름');
  await page.mouse.click(r.x, r.y, { button: 'right' }); await page.waitForTimeout(150);
  let s = await st();
  ok(s.tool === 'cursor' && !s.menu && s.cursorOn, `도구 고른 뒤 오른쪽 클릭 → 도구 풀림 (tool=${s.tool}, 메뉴 ${s.menu ? '뜸' : '안 뜸'}, 왼쪽 막대 화살표 ${s.cursorOn ? '켜짐' : '꺼짐'})`);

  // 2) 그리는 중(첫 점만 찍음) 오른쪽 클릭 → 그리던 것 취소 + 도구 풀림, 그림 안 늘어남
  const n0 = s.n;
  await page.evaluate(() => CH.setTool('trend'));
  await page.mouse.click(r.x, r.y); await page.mouse.move(r.x + 120, r.y + 40); await page.waitForTimeout(100);
  const mid = await st();
  await page.mouse.click(r.x + 120, r.y + 40, { button: 'right' }); await page.waitForTimeout(150);
  s = await st();
  ok(mid.creating && !s.creating && s.tool === 'cursor' && s.n === n0 && !s.menu, `그리는 중 오른쪽 클릭 → 취소 + 도구 풀림 (그리는 중 ${mid.creating} → ${s.creating}, 그림 ${n0} → ${s.n})`);

  // 3) 다시 고르면 정상으로 그려짐 (두 번 클릭)
  await page.evaluate(() => CH.setTool('trend'));
  await page.mouse.click(r.x, r.y); await page.mouse.click(r.x + 150, r.y + 60); await page.waitForTimeout(150);
  s = await st();
  ok(s.n === n0 + 1 && s.tool === 'cursor', `오른쪽 클릭 뒤에도 다시 그리기 정상 (그림 ${s.n}, 다 그리면 도구 자동 풀림)`);

  // 4) 형광펜(계속 그리는 도구): 한 획 그은 뒤 오른쪽 클릭 → 획은 남고 도구 풀림
  await page.evaluate(() => CH.setTool('highlighter'));
  await page.mouse.move(r.x, r.y + 100); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(r.x + i * 15, r.y + 100 + (i % 2) * 8); await page.mouse.up(); await page.waitForTimeout(150);
  const hl = await st();
  await page.mouse.click(r.x + 60, r.y + 160, { button: 'right' }); await page.waitForTimeout(150);
  s = await st();
  ok(hl.tool === 'highlighter' && hl.n === n0 + 2 && s.tool === 'cursor' && s.n === n0 + 2 && !s.menu, `형광펜: 획 그린 뒤에도 도구 유지(${hl.tool}) → 오른쪽 클릭으로 풀림, 획은 남음 (그림 ${s.n})`);

  // 5) 지우개도 오른쪽 클릭으로 풀림
  await page.evaluate(() => CH.setTool('eraser'));
  await page.mouse.click(r.x - 200, r.y + 200, { button: 'right' }); await page.waitForTimeout(150);
  s = await st();
  ok(s.tool === 'cursor' && !s.menu, '지우개도 오른쪽 클릭으로 풀림');

  // 6) 도구 없을 때 오른쪽 클릭 → 원래 메뉴 그대로
  await page.mouse.click(r.x - 200, r.y + 200, { button: 'right' }); await page.waitForTimeout(150);
  s = await st();
  ok(s.menu && s.tool === 'cursor', '도구 없을 때 오른쪽 클릭 → 차트 메뉴 뜸 (원래대로)');
  await closeMenu();

  // 7) Esc도 그대로 됨
  await page.evaluate(() => CH.setTool('rect'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok((await st()).tool === 'cursor', 'Esc로 도구 풀기도 그대로');

  const lists1 = await page.evaluate(() => JSON.parse(localStorage.getItem('mc.v1')).lists);
  ok(JSON.stringify(lists1) === JSON.stringify(listsStart), '관심목록 그대로 (' + lists1[0].items.length + '개)');
  ok(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  await browser.close().catch(() => {});
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
