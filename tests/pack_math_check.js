const fs = require('fs'), vm = require('vm');
const TI = require('technicalindicators');
// index.html 안의 PACK(지표 팩 계산부)만 잘라 실행 · 준비: npm i technicalindicators
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const a0 = html.indexOf('const PACK = (() => {'), a1 = html.indexOf('// FibScan — ');
const code = html.slice(a0, html.lastIndexOf('// ====', a1)) + '\nglobalThis.PACK = PACK;';
vm.runInThisContext(code);
// 랜덤 워크 봉
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const N = 600, d = { T: [], O: [], H: [], L: [], C: [], V: [], N, tfSec: 3600 };
let px = 100;
for (let i = 0; i < N; i++) { const o = px, c = o * (1 + (rnd() - 0.5) * 0.04), h = Math.max(o, c) * (1 + rnd() * 0.01), l = Math.min(o, c) * (1 - rnd() * 0.01);
  d.T.push(1700000000 + i * 3600); d.O.push(o); d.H.push(h); d.L.push(l); d.C.push(c); d.V.push(100 + rnd() * 900); px = c; }
const defs = s => Object.fromEntries(s.in.map(([k, , v]) => [k, v]));
let bad = 0;
for (const [k, s] of Object.entries(PACK.S)) {
  try {
    const out = s.calc(d, defs(s));
    for (const pl of s.plots) { const a = out[pl[0]]; if (!Array.isArray(a) || a.length !== N) { console.log('LEN', k, pl[0]); bad++; continue; }
      const f = a.filter(Number.isFinite).length, inf = a.some(x => x === Infinity || x === -Infinity);
      const sparse = ['zigzag', 'fractals', 'psar', 'supertrend'].includes(k) || (k === 'vwap' && pl[0] !== 'v');
      if (inf || (!sparse && f < N * 0.7) || (sparse && f === 0 && k !== 'vwap')) { console.log('BAD', k, pl[0], 'finite', f, 'inf', inf); bad++; } }
    // 빈 데이터 · 짧은 데이터에서도 죽지 않아야 함
    for (const n of [0, 1, 3]) { const e = { T: d.T.slice(0, n), O: d.O.slice(0, n), H: d.H.slice(0, n), L: d.L.slice(0, n), C: d.C.slice(0, n), V: d.V.slice(0, n), N: n, tfSec: 3600 }; s.calc(e, defs(s)); }
  } catch (e) { console.log('THROW', k, e.message); bad++; }
}
console.log('indicators', Object.keys(PACK.S).length, 'problems', bad);
// 기준 라이브러리와 마지막 값 비교
const lastF = a => { for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return a[i]; };
const cmp = (name, mine, ref, tol = 1e-6) => { const a = lastF(mine), b = ref[ref.length - 1]; const ok = Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)); console.log(ok ? 'ok  ' : 'DIFF', name, a, b); if (!ok) bad++; };
const run = (k, p = {}) => PACK.S[k].calc(d, { ...defs(PACK.S[k]), ...p });
const hlc = { high: d.H, low: d.L, close: d.C, volume: d.V, open: d.O };
cmp('wma', run('wma').v, TI.WMA.calculate({ period: 9, values: d.C }));
cmp('atr', run('atr').v, TI.ATR.calculate({ period: 14, ...hlc }), 1e-4);
cmp('cci', run('cci').v, TI.CCI.calculate({ period: 20, ...hlc }));
cmp('willr', run('willr').v, TI.WilliamsR.calculate({ period: 14, ...hlc }));
cmp('mfi', run('mfi').v, TI.MFI.calculate({ period: 14, ...hlc }), 2e-3);
cmp('roc', run('roc').v, TI.ROC.calculate({ period: 9, values: d.C }));
cmp('obv', run('obv').v, TI.OBV.calculate({ close: d.C, volume: d.V }));
cmp('adl', run('adl').v, TI.ADL.calculate(hlc));
const st = TI.Stochastic.calculate({ period: 14, signalPeriod: 3, ...hlc }); cmp('stoch k', run('stoch').k, st.map(x => x.k)); cmp('stoch d', run('stoch').d, st.map(x => x.d));
const sr = TI.StochasticRSI.calculate({ values: d.C, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }); cmp('stochrsi k', run('stochrsi').k, sr.map(x => x.k), 1e-4);
const adx = TI.ADX.calculate({ period: 14, ...hlc }); cmp('adx', run('adx').adx, adx.map(x => x.adx), 1e-3); cmp('+di', run('adx').p, adx.map(x => x.pdi), 1e-3);
cmp('trix', run('trix').v.map(x => x / 100), TI.TRIX.calculate({ period: 18, values: d.C.map(Math.log) }).map(x => x), 5e-2);
cmp('ao', run('ao').v, TI.AwesomeOscillator.calculate({ fastPeriod: 5, slowPeriod: 34, ...hlc }));
cmp('psar', run('psar').v, TI.PSAR.calculate({ step: 0.02, max: 0.2, high: d.H, low: d.L }), 1e-6);
const kc = TI.KeltnerChannels.calculate({ maPeriod: 20, atrPeriod: 10, useSMA: false, multiplier: 2, ...hlc }); cmp('keltner up', run('keltner').up, kc.map(x => x.upper), 1e-3);
const ich = TI.IchimokuCloud.calculate({ high: d.H, low: d.L, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 }); cmp('ichimoku base', run('ichimoku').base, ich.map(x => x.base)); cmp('ichimoku spanB', run('ichimoku').b, ich.map(x => x.spanB));
cmp('fi', run('efi').v, TI.ForceIndex.calculate({ period: 13, close: d.C, volume: d.V }), 1e-3);
cmp('vwap(all)', (() => { const e = { ...d, T: d.T.map(() => 0) }; return PACK.S.vwap.calc(e, { anchor: 'D', band: 0 }).v; })(), TI.VWAP.calculate(hlc));
process.exit(bad ? 1 : 0);
