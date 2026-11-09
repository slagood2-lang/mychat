#!/usr/bin/env python3
"""
나만의 차트 - 로컬 데이터 서버

바이낸스에 없는 종목(SI1! 같은 선물, 미국·한국 주식, 지수)을 야후 파이낸스(yfinance)로 받아
브라우저 차트에 넘겨 줍니다. 내 PC(127.0.0.1)에서만 열리고, 주문·로그인 기능은 없습니다.

실행
  pip install yfinance
  python chart_server.py              # http://localhost:8000 자동으로 열림
  홈페이지(GitHub Pages)로 열었을 때도 이 서버를 켜 두면 주식·선물이 보입니다 (⋯ → PC 서버 연결)
  python chart_server.py --port 8080 --no-browser
  python chart_server.py --selftest   # 데이터 받아오기 점검

데이터 이용 조건
  야후 파이낸스 데이터는 개인 용도로만 쓰세요(재배포·판매 불가).
  코인게코 무료 API는 출처 표기가 필요하고 분당 약 5회로 제한됩니다(서버가 10분간 저장해 둡니다).
"""
import argparse
import json
import logging
import math
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
log = logging.getLogger("mychart")

SYM_RE = re.compile(r"^[A-Za-z0-9.\-=^_&]{1,24}$")
DAY_MS = 86_400_000

# tf: (야후 interval, 전체 기간, 최근 기간, 합치기(kind, n))
TF = {
    "1m": ("1m", "7d", "1d", None),
    "3m": ("1m", "7d", "1d", ("min", 3)),
    "5m": ("5m", "60d", "5d", None),
    "15m": ("15m", "60d", "5d", None),
    "30m": ("30m", "60d", "5d", None),
    "1h": ("60m", "730d", "5d", None),
    "2h": ("60m", "730d", "5d", ("hour", 2)),
    "3h": ("60m", "730d", "5d", ("hour", 3)),
    "4h": ("60m", "730d", "5d", ("hour", 4)),
    "6h": ("60m", "730d", "5d", ("hour", 6)),
    "12h": ("60m", "730d", "5d", ("hour", 12)),
    "1d": ("1d", "max", "1mo", None),
    "3d": ("1d", "max", "1mo", ("day", 3)),
    "1w": ("1wk", "max", "3mo", None),
    "1M": ("1mo", "max", "1y", None),
}
TF_MS = {"1m": 60e3, "3m": 180e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "2h": 7200e3, "3h": 10800e3,
         "4h": 14400e3, "6h": 21600e3, "12h": 43200e3, "1d": DAY_MS, "3d": 3 * DAY_MS, "1w": 7 * DAY_MS, "1M": 30 * DAY_MS}
DAILY = {"1d", "1wk", "1mo"}


# ---------------- 캐시 ----------------
class Cache:
    def __init__(self):
        self._d, self._lock = {}, threading.Lock()

    def get(self, key, ttl, fn, stale_ok=True):
        now = time.time()
        with self._lock:
            hit = self._d.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        try:
            val = fn()
        except Exception:
            if hit and stale_ok:  # 실패하면 지난 값이라도 돌려줌
                log.warning("using stale cache for %s", key)
                return hit[1]
            raise
        with self._lock:
            self._d[key] = (now, val)
            if len(self._d) > 2000:  # 오래된 것 정리
                for k in sorted(self._d, key=lambda k: self._d[k][0])[:500]:
                    self._d.pop(k, None)
        return val


cache = Cache()
_yf = None


def yf():
    """yfinance를 처음 쓸 때 불러옴. 없으면 설치 방법을 알려 주는 오류."""
    global _yf
    if _yf is None:
        try:
            import yfinance  # noqa
            _yf = yfinance
        except ImportError:
            raise RuntimeError("yfinance가 설치되어 있지 않습니다. 명령 프롬프트에서 'pip install yfinance' 실행 후 서버를 다시 켜세요.")
    return _yf


def num(x):
    try:
        f = float(x)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# ---------------- 봉 데이터 ----------------
def df_rows(df, daily):
    """DataFrame → [(t_ms, 날짜, o, h, l, c, v)]  (일봉 이상은 그 날짜의 UTC 0시)"""
    rows = []
    if df is None or len(df) == 0:
        return rows
    cols = {c.lower(): c for c in df.columns}
    O, H, L, C = (cols.get(k) for k in ("open", "high", "low", "close"))
    V = cols.get("volume")
    if not all((O, H, L, C)):
        return rows
    for ts, r in df.iterrows():
        o, h, l, c = num(r[O]), num(r[H]), num(r[L]), num(r[C])
        if c is None or o is None or h is None or l is None:
            continue
        v = num(r[V]) if V else 0.0
        d = ts.date()
        if daily:
            t = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)
        else:
            t = int(ts.timestamp() * 1000)
        rows.append((t, d.isoformat(), o, h, l, c, v or 0.0))
    rows.sort(key=lambda x: x[0])
    out = []
    for r in rows:  # 같은 시각 중복 제거 (마지막 값 사용)
        if out and out[-1][0] == r[0]:
            out[-1] = r
        else:
            out.append(r)
    return out


def regroup(rows, kind, n):
    """봉 합치기: min = n분, hour = 하루 안에서 n개씩, day = n일씩"""
    groups, order = {}, []
    if kind == "hour":
        cnt, prev = 0, None
    for r in rows:
        if kind == "min":
            key = r[0] // int(n * 60_000)
        elif kind == "day":
            key = (r[0] // DAY_MS) // n
        else:
            if r[1] != prev:
                cnt, prev = 0, r[1]
            key = (r[1], cnt // n)
            cnt += 1
        g = groups.get(key)
        if g is None:
            groups[key] = [r[0], r[1], r[2], r[3], r[4], r[5], r[6]]
            order.append(key)
        else:
            g[3] = max(g[3], r[3]); g[4] = min(g[4], r[4]); g[5] = r[5]; g[6] += r[6]
    return [tuple(groups[k]) for k in order]


def to_klines(rows, tf):
    step = TF_MS[tf]
    out = []
    for i, r in enumerate(rows):
        t_close = (rows[i + 1][0] - 1) if i + 1 < len(rows) else int(r[0] + step - 1)
        out.append([r[0], r[2], r[3], r[4], r[5], r[6], t_close, r[5] * r[6]])
    return out


def yahoo_klines(symbol, tf, recent=False):
    if tf not in TF:
        raise ValueError("지원하지 않는 타임프레임: " + tf)
    interval, full, short, grp = TF[tf]
    period = short if recent else full

    def load():
        t = yf().Ticker(symbol)
        df = t.history(period=period, interval=interval, auto_adjust=False, actions=False, prepost=False)
        rows = df_rows(df, interval in DAILY)
        if grp:
            rows = regroup(rows, *grp)
            if recent and len(rows) > 1:
                rows = rows[1:]  # 최근 구간의 첫 묶음은 잘려 있을 수 있음
        meta = {}
        try:
            m = t.history_metadata or {}
            meta = {k: m.get(k) for k in ("currency", "exchangeName", "fullExchangeName", "instrumentType",
                                          "exchangeTimezoneName", "priceHint", "longName", "shortName")}
        except Exception:
            pass
        if not rows:
            raise LookupError(f"{symbol}: 데이터가 없습니다 (종목 코드 확인)")
        return {"symbol": symbol, "tf": tf, "meta": meta, "bars": to_klines(rows, tf)}

    ttl = 20 if recent else (120 if tf in ("1m", "3m", "5m", "15m", "30m") else 900)
    return cache.get(("k", symbol, tf, recent), ttl, load, stale_ok=True)


# ---------------- 여러 종목 한 번에 ----------------
def frame_for(df, sym):
    import pandas as pd
    if df is None or len(df) == 0:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        for lvl in (0, 1):
            if sym in df.columns.get_level_values(lvl):
                return df.xs(sym, axis=1, level=lvl)
        return None
    return df


def download(symbols, period):
    return yf().download(symbols, period=period, interval="1d", group_by="ticker", auto_adjust=False,
                         progress=False, threads=True)


def quotes(symbols):
    def load():
        df = download(symbols, "5d")
        out = {}
        for s in symbols:
            f = frame_for(df, s)
            if f is None:
                continue
            c = [num(x) for x in f["Close"].tolist()] if "Close" in f else []
            c = [x for x in c if x is not None]
            if not c:
                continue
            prev = c[-2] if len(c) > 1 else None
            out[s] = {"price": c[-1], "prev": prev, "chgPct": (c[-1] / prev - 1) * 100 if prev else None}
        return out
    return cache.get(("q", tuple(symbols)), 45, load)


def trend_stats(closes, vols, ann=252):
    """꾸준한 상승 지표 (브라우저 IND.trendStats와 같은 정의)
    로그 가격의 최근 120봉 선형회귀: 기울기 → 연환산 %, R² = 얼마나 일직선인지
    trend = 회귀선 기준 최근 w봉 동안 수익률(%), steady = R² × 그 기간 로그수익률(%) → 크고 매끄럽게 오를수록 큼"""
    c = [x for x in closes if x and x > 0]
    n = len(c)
    if n < 30:
        return None
    last = c[-1]
    ret = lambda k: (last / c[-1 - k] - 1) * 100 if n > k else None
    w = min(120, n)
    ys = [math.log(x) for x in c[-w:]]
    mx, my = (w - 1) / 2, sum(ys) / w
    sxx = sum((i - mx) ** 2 for i in range(w))
    sxy = sum((i - mx) * (y - my) for i, y in enumerate(ys))
    b = sxy / sxx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (my + b * (i - mx))) ** 2 for i, y in enumerate(ys))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
    peak, dd = 0, 0
    for x in c[-w:]:
        peak = max(peak, x)
        dd = min(dd, (x / peak - 1) * 100)
    v = [x or 0 for x in vols]
    base = v[-21:-1]
    vol_ratio = (v[-1] / (sum(base) / len(base))) if len(base) >= 10 and sum(base) > 0 else None
    ma200 = sum(c[-200:]) / 200 if n >= 200 else None
    tail = c[-90:]
    stepn = max(1, len(tail) // 45)
    return {"price": last, "chgPct": ret(1), "ret1m": ret(21 if ann == 252 else 30), "ret3m": ret(63 if ann == 252 else 90),
            "ret6m": ret(126 if ann == 252 else 180), "ret1y": ret(min(n - 1, 251 if ann == 252 else 364)),
            "slopeAnn": (math.exp(b * ann) - 1) * 100, "trend": (math.exp(b * (w - 1)) - 1) * 100, "win": w,
            "r2": r2, "steady": r2 * b * (w - 1) * 100,
            "maxDD": dd, "volRatio": vol_ratio, "above200": (last > ma200) if ma200 else None,
            "spark": [round(x, 6) for x in tail[::stepn]], "bars": n}


def trend(symbols):
    def load():
        df = download(symbols, "1y")
        out = {}
        for s in symbols:
            f = frame_for(df, s)
            if f is None or "Close" not in f:
                continue
            f = f.dropna(subset=["Close"])
            st = trend_stats([num(x) for x in f["Close"].tolist()], [num(x) for x in f["Volume"].tolist()] if "Volume" in f else [])
            if st:
                st["turnover"] = st["price"] * (num(f["Volume"].iloc[-1]) or 0) if "Volume" in f and len(f) else None
                out[s] = st
        return out
    return cache.get(("t", tuple(symbols)), 900, load)


# ---------------- 스크리너 ----------------
FALLBACK = {
    "us": "AAPL MSFT NVDA AMZN GOOGL META AVGO TSLA BRK-B LLY JPM V UNH XOM MA COST HD PG JNJ NFLX ABBV WMT BAC CRM ORCL "
          "AMD KO CVX MRK PEP ADBE TMO LIN ACN MCD CSCO ABT WFC IBM GE QCOM DHR INTU TXN AMGN CAT PM VZ ISRG NOW GS MS "
          "UBER AMAT SPGI PFE RTX BKNG HON UNP LOW T NEE BLK PLTR MU LRCX PANW ANET KLAC SBUX ADI DE BA MDT GILD SCHW "
          "C LMT TJX MMC VRTX REGN BX CB PGR ELV ADP SNPS CDNS MELI ABNB COIN MSTR SMCI ARM SHOP CRWD SNOW DELL".split(),
    "kr": "005930.KS 000660.KS 373220.KS 207940.KS 005380.KS 005935.KS 068270.KS 000270.KS 105560.KS 055550.KS "
          "035420.KS 012450.KS 028260.KS 006400.KS 012330.KS 329180.KS 035720.KS 051910.KS 086790.KS 032830.KS "
          "138040.KS 015760.KS 003670.KS 034020.KS 010130.KS 066570.KS 042660.KS 009540.KS 064350.KS 011200.KS "
          "033780.KS 096770.KS 323410.KS 259960.KS 017670.KS 316140.KS 010140.KS 003550.KS 024110.KS 352820.KS "
          "247540.KQ 086520.KQ 196170.KQ 028300.KQ 277810.KQ 141080.KQ 058470.KQ 214150.KQ 145020.KQ 403870.KQ".split(),
}
KR_NAMES = {
    "005930": "삼성전자", "000660": "SK하이닉스", "373220": "LG에너지솔루션", "207940": "삼성바이오로직스", "005380": "현대차",
    "005935": "삼성전자우", "068270": "셀트리온", "000270": "기아", "105560": "KB금융", "055550": "신한지주", "035420": "NAVER",
    "012450": "한화에어로스페이스", "028260": "삼성물산", "006400": "삼성SDI", "012330": "현대모비스", "329180": "HD현대중공업",
    "035720": "카카오", "051910": "LG화학", "086790": "하나금융지주", "032830": "삼성생명", "138040": "메리츠금융지주",
    "015760": "한국전력", "003670": "포스코퓨처엠", "034020": "두산에너빌리티", "010130": "고려아연", "066570": "LG전자",
    "042660": "한화오션", "009540": "HD한국조선해양", "064350": "현대로템", "011200": "HMM", "033780": "KT&G",
    "096770": "SK이노베이션", "323410": "카카오뱅크", "259960": "크래프톤", "017670": "SK텔레콤", "316140": "우리금융지주",
    "010140": "삼성중공업", "003550": "LG", "024110": "기업은행", "352820": "하이브", "247540": "에코프로비엠",
    "086520": "에코프로", "196170": "알테오젠", "028300": "HLB", "277810": "레인보우로보틱스", "141080": "리가켐바이오",
    "058470": "리노공업", "214150": "클래시스", "145020": "휴젤", "403870": "HPSP",
}
SORT_FIELD = {"mcap": "intradaymarketcap", "volume": "dayvolume", "gainers": "percentchange", "losers": "percentchange"}


def quote_row(q):
    sym = q.get("symbol")
    code = sym.split(".")[0] if sym else ""
    return {"symbol": sym, "name": KR_NAMES.get(code) or q.get("shortName") or q.get("longName") or sym,
            "price": num(q.get("regularMarketPrice")), "chgPct": num(q.get("regularMarketChangePercent")),
            "mcap": num(q.get("marketCap")), "volume": num(q.get("regularMarketVolume")),
            "avgVol3m": num(q.get("averageDailyVolume3Month")), "currency": q.get("currency"),
            "exchange": q.get("fullExchangeName") or q.get("exchange"), "ret1y": num(q.get("fiftyTwoWeekChangePercent"))}


def screen(market, sort, size, min_cap):
    market = "kr" if market == "kr" else "us"
    size = max(10, min(250, size))

    def load():
        try:
            Y = yf()
            EQ = Y.EquityQuery
            parts = [EQ("eq", ["region", market])]
            parts.append(EQ("gt", ["intradaymarketcap", min_cap or (2e9 if market == "us" else 3e11)]))
            if sort == "gainers":
                parts.append(EQ("gt", ["percentchange", 0]))
            if sort == "losers":
                parts.append(EQ("lt", ["percentchange", 0]))
            res = Y.screen(EQ("and", parts), size=size, sortField=SORT_FIELD.get(sort, "intradaymarketcap"),
                           sortAsc=(sort == "losers"))
            rows = [quote_row(q) for q in (res or {}).get("quotes", []) if q.get("symbol")]
            if rows:
                return {"rows": rows, "source": "screener"}
            raise LookupError("빈 결과")
        except Exception as e:
            log.warning("yahoo screener failed (%s), using built-in list", e)
            syms = FALLBACK[market]
            st = trend(syms)
            rows = [{"symbol": s, "name": KR_NAMES.get(s.split(".")[0], s), "price": st[s]["price"],
                     "chgPct": st[s]["chgPct"], "mcap": None, "volume": None, "avgVol3m": None,
                     "currency": "KRW" if market == "kr" else "USD", "exchange": None} for s in syms if s in st]
            return {"rows": rows, "source": "fallback", "note": f"야후 스크리너 실패로 기본 대형주 목록 사용 ({e})"}
    return cache.get(("s", market, sort, size, min_cap), 600, load)


def trending(region):
    region = "KR" if region.upper() == "KR" else "US"

    def load():
        url = f"https://query1.finance.yahoo.com/v1/finance/trending/{region}"
        data = None
        try:
            from yfinance.data import YfData  # yfinance 세션(쿠키·crumb) 재사용
            data = YfData().get_raw_json(url, params={"count": 30})
        except Exception as e:
            log.info("trending via yfinance session failed: %s", e)
            data = http_json(url + "?count=30")
        res = (data.get("finance", {}).get("result") or [{}])[0]
        syms = [q["symbol"] for q in res.get("quotes", []) if q.get("symbol")]
        if not syms:
            raise LookupError("트렌딩 결과 없음")
        return {"symbols": syms[:30]}
    return cache.get(("tr", region), 600, load)


def search(q):
    def load():
        try:
            res = yf().Search(q, max_results=12, news_count=0, lists_count=0, include_cb=False, raise_errors=False)
        except TypeError:  # 옛 버전 yfinance
            res = yf().Search(q, max_results=12, news_count=0)
        out = []
        for x in res.quotes or []:
            sym = x.get("symbol")
            if not sym:
                continue
            code = sym.split(".")[0]
            out.append({"symbol": sym, "name": KR_NAMES.get(code) or x.get("shortname") or x.get("longname") or sym,
                        "exchange": x.get("exchDisp") or x.get("exchange"), "type": x.get("typeDisp") or x.get("quoteType")})
        return {"quotes": out}
    return cache.get(("se", q.lower()), 3600, load)


# ---------------- 코인게코 ----------------
def http_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (mychart local)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def cg_markets(page):
    url = ("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250"
           f"&page={page}&price_change_percentage=24h,7d,30d&sparkline=false")
    return cache.get(("cg", page), 600, lambda: http_json(url))


def cg_trending():
    return cache.get(("cgt",), 600, lambda: http_json("https://api.coingecko.com/api/v3/search/trending"))


# ---------------- HTTP ----------------
def symbols_param(qs, key="symbols", limit=250):
    raw = (qs.get(key) or [""])[0]
    syms = [s.strip() for s in raw.split(",") if s.strip()]
    bad = [s for s in syms if not SYM_RE.match(s)]
    if bad:
        raise ValueError("잘못된 종목 코드: " + ", ".join(bad[:5]))
    return syms[:limit]


class Handler(BaseHTTPRequestHandler):
    server_version = "mychart/1.0"

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")  # 파일·홈페이지(GitHub Pages)에서 연 페이지도 접근
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        # 홈페이지(https)에서 내 PC 서버로 오는 요청 허용 (예전 크롬의 Private Network Access 사전 확인 포함)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        p = u.path
        try:
            if p in ("/", "/index.html"):
                path = os.path.join(HERE, "index.html")
                with open(path, "rb") as f:
                    return self.send(200, f.read(), "text/html; charset=utf-8")
            if not p.startswith("/api/"):
                return self.send(404, {"error": "not found"})
            arg = lambda k, d="": (qs.get(k) or [d])[0]
            if p == "/api/ping":
                ver = None
                try:
                    ver = yf().__version__
                except Exception as e:
                    return self.send(200, {"ok": True, "yfinance": None, "warn": str(e)})
                return self.send(200, {"ok": True, "yfinance": ver})
            if p == "/api/open-tv":
                # 트레이딩뷰 링크를 운영체제로 열기 → 윈도우에서 트레이딩뷰 데스크톱 앱이 tradingview.com 링크를 맡고 있으면 앱으로 열림
                url = arg("url")
                if not re.match(r"^https://([a-z]{2,3}\.)?tradingview\.com/[\w\-./?=&%:!^]*$", url):
                    raise ValueError("트레이딩뷰 링크만 열 수 있습니다")
                if hasattr(os, "startfile"):
                    os.startfile(url)
                else:
                    webbrowser.open(url)
                return self.send(200, {"ok": True})
            if p == "/api/yf/klines":
                sym = arg("symbol")
                if not SYM_RE.match(sym):
                    raise ValueError("잘못된 종목 코드")
                return self.send(200, yahoo_klines(sym, arg("tf", "1d"), arg("recent") == "1"))
            if p == "/api/yf/quotes":
                return self.send(200, quotes(symbols_param(qs)))
            if p == "/api/yf/trend":
                return self.send(200, trend(symbols_param(qs)))
            if p == "/api/yf/search":
                q = arg("q").strip()[:40]
                return self.send(200, search(q) if q else {"quotes": []})
            if p == "/api/yf/screen":
                return self.send(200, screen(arg("market", "us"), arg("sort", "mcap"), int(arg("size", "100")),
                                             num(arg("minCap")) or 0))
            if p == "/api/yf/trending":
                return self.send(200, trending(arg("region", "US")))
            if p == "/api/cg/markets":
                return self.send(200, cg_markets(max(1, min(4, int(arg("page", "1"))))))
            if p == "/api/cg/trending":
                return self.send(200, cg_trending())
            return self.send(404, {"error": "unknown api"})
        except (ValueError, LookupError) as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:
            log.error("%s failed: %s", p, e)
            log.debug(traceback.format_exc())
            msg = str(e)
            if "Rate" in type(e).__name__ or "Too Many" in msg:
                msg = "야후 요청 한도에 걸렸습니다. 1~2분 뒤 다시 시도하세요. (" + msg + ")"
            return self.send(502, {"error": msg})


def selftest():
    tests = [
        ("은 선물 SI=F 주봉", lambda: f"{len(yahoo_klines('SI=F', '1w')['bars'])}봉"),
        ("애플 4시간봉", lambda: f"{len(yahoo_klines('AAPL', '4h')['bars'])}봉"),
        ("삼성전자 일봉", lambda: f"{len(yahoo_klines('005930.KS', '1d')['bars'])}봉"),
        ("검색 'samsung'", lambda: ", ".join(q["symbol"] for q in search("samsung")["quotes"][:4])),
        ("관심종목 시세", lambda: json.dumps(quotes(["AAPL", "SI=F", "005930.KS"]), ensure_ascii=False)[:120]),
        ("미국 시총 상위", lambda: (lambda r: f"{r['source']} {len(r['rows'])}개 첫 {r['rows'][0]['symbol']}")(screen("us", "mcap", 50, 0))),
        ("한국 시총 상위", lambda: (lambda r: f"{r['source']} {len(r['rows'])}개 첫 {r['rows'][0]['symbol']}")(screen("kr", "mcap", 50, 0))),
        ("미국 트렌딩", lambda: ", ".join(trending("US")["symbols"][:6])),
        ("추세 지표", lambda: json.dumps({k: round(v["steady"], 1) for k, v in trend(["AAPL", "MSFT", "NVDA"]).items()})),
        ("코인게코 시총", lambda: f"{len(cg_markets(1))}개 첫 {cg_markets(1)[0]['symbol']}"),
    ]
    ok = 0
    for name, fn in tests:
        try:
            print(f"[통과] {name}: {fn()}")
            ok += 1
        except Exception as e:
            print(f"[실패] {name}: {type(e).__name__}: {e}")
    print(f"\n{ok}/{len(tests)} 통과")
    return ok == len(tests)


def main(argv=None):
    ap = argparse.ArgumentParser(description="나만의 차트 로컬 서버")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--selftest", action="store_true", help="야후·코인게코 데이터 받아오기 점검")
    ap.add_argument("-v", "--verbose", action="store_true")
    o = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if o.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if o.selftest:
        sys.exit(0 if selftest() else 1)
    try:
        print("yfinance", yf().__version__)
    except RuntimeError as e:
        print("경고:", e, "\n(바이낸스 종목 차트는 그대로 됩니다)")
    srv = ThreadingHTTPServer(("127.0.0.1", o.port), Handler)
    url = f"http://localhost:{o.port}/"
    print(f"나만의 차트: {url}  (끄려면 Ctrl+C)")
    if not o.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")


if __name__ == "__main__":
    main()
