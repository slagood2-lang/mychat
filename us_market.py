"""
미국 주식 시세판 (chart_server.py가 불러 씀) — 웨돔 종목 찾기 창처럼 전 종목 가격·변동·거래대금

두 가지 방식 (자동 선택)
- Alpaca 무료 키가 있으면: 화면에 보이는 종목 2.5초, 전 종목 20초마다 IEX 실시간 가격
  + 전 종목 전일 공식 종가·거래대금(전체 거래소, 15분 지연) 1분마다. 무료 한도 분당 200회 → 170회까지만 씀
- 키가 없으면: 야후 5일 일봉으로 전 종목 거래대금 순위(30분마다), 보이는 종목은 야후 시세(15초마다)

키: 홈페이지 ⋯ → 「미국 주식 전 종목 시세 (Alpaca)」에서 입력 → 이 PC의 data/us_keys.json에만 저장
"""
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from datetime import timedelta

log = logging.getLogger("mychart.board")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
ALPACA = os.environ.get("MYCHART_ALPACA", "https://data.alpaca.markets")
try:
    from zoneinfo import ZoneInfo
    NY = ZoneInfo("America/New_York")
except Exception:   # 윈도우 파이썬에 시간대 자료(tzdata)가 없을 때: 미국 서머타임 규칙으로 직접 계산
    from datetime import tzinfo

    def _ny_off(u):
        """u = UTC 시각 → 뉴욕 시차 (3월 둘째 일요일 ~ 11월 첫 일요일 서머타임)"""
        mar = datetime(u.year, 3, 8, tzinfo=timezone.utc)
        nov = datetime(u.year, 11, 1, tzinfo=timezone.utc)
        start = mar + timedelta(days=(6 - mar.weekday()) % 7, hours=7)
        end = nov + timedelta(days=(6 - nov.weekday()) % 7, hours=6)
        return timedelta(hours=-4 if start <= u < end else -5)

    class _NYTZ(tzinfo):
        def fromutc(self, d):
            return d + _ny_off(d.replace(tzinfo=timezone.utc))

        def utcoffset(self, d):
            return _ny_off(d.replace(tzinfo=timezone.utc) + timedelta(hours=5))

        def dst(self, d):
            return timedelta(0)

        def tzname(self, d):
            return "ET"
    NY = _NYTZ()

# 미국 휴장일 · 조기폐장(13:00) — NYSE 발표 기준
HOLIDAYS = {"2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
            "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}
EARLY = {"2026-11-27", "2026-12-24", "2027-11-26"}


def session(now=None):
    """pre | regular | after | closed"""
    d = (now or datetime.now(timezone.utc)).astimezone(NY)
    day, m = d.strftime("%Y-%m-%d"), d.hour * 60 + d.minute
    if d.weekday() >= 5 or day in HOLIDAYS:
        return "closed"
    close = 780 if day in EARLY else 960
    if 240 <= m < 570:
        return "pre"
    if 570 <= m < close:
        return "regular"
    if close <= m < (1020 if day in EARLY else 1200):
        return "after"
    return "closed"


def ny_day(ts_ms):
    return datetime.fromtimestamp(ts_ms / 1000, NY).strftime("%Y-%m-%d")


class Keys:
    FILE = "us_keys.json"

    def __init__(self):
        self.k = {}
        try:
            with open(os.path.join(DATA, self.FILE), encoding="utf-8") as f:
                self.k = json.load(f)
        except (OSError, ValueError):
            pass
        if os.environ.get("ALPACA_KEY"):
            self.k = {"alpacaKey": os.environ["ALPACA_KEY"], "alpacaSecret": os.environ.get("ALPACA_SECRET", "")}

    @property
    def ok(self):
        return bool(self.k.get("alpacaKey") and self.k.get("alpacaSecret"))

    def set(self, key, secret):
        self.k = {"alpacaKey": (key or "").strip(), "alpacaSecret": (secret or "").strip()} if key else {}
        os.makedirs(DATA, exist_ok=True)
        p = os.path.join(DATA, self.FILE)
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(self.k, f)
        os.replace(p + ".tmp", p)


class Board:
    """sym → [가격, 전일종가, 거래대금$, 거래량, 체결시각ms, 고가, 저가, 버전]"""

    def __init__(self, universe, yahoo_quotes, yahoo_download, frame_for, df_rows):
        self.uni = universe
        self.yq, self.ydl, self.frame_for, self.df_rows = yahoo_quotes, yahoo_download, frame_for, df_rows
        self.keys = Keys()
        self.rows = {}
        self.ver = 0
        self.lock = threading.Lock()
        self.hot = {}                 # sym → 마지막 요청 시각 (화면에 보이는 종목)
        self.tokens, self.refill = 170.0, time.time()
        self.stat = {"mode": "", "calls": 0, "err": "", "full": 0, "delayed": 0, "rank": 0, "delayedOk": True}
        self.spark_cache = {}
        self.wake = threading.Event()        # 보이는 종목 바로 다시
        self.wake_full = threading.Event()   # 키 저장 직후 전 종목 바로

    # ---------- 공통 ----------
    def mode(self):
        return "alpaca" if self.keys.ok else "yahoo"

    def put(self, s, **kw):
        with self.lock:
            r = self.rows.get(s) or [None, None, None, None, None, None, None, 0]
            for i, k in enumerate(("p", "pc", "dv", "v", "t", "h", "l")):
                if k in kw and kw[k] is not None:
                    r[i] = kw[k]
            self.ver += 1
            r[7] = self.ver
            self.rows[s] = r

    def syms(self):
        u = self.uni.u or {}
        return [r[0] for r in u.get("rows", []) if r[4] in ("cs", "etf")]

    def start(self):
        threading.Thread(target=self._hot_loop, daemon=True, name="board-hot").start()
        threading.Thread(target=self._full_loop, daemon=True, name="board-full").start()

    def set_keys(self, key, secret):
        self.keys.set(key, secret)
        self.stat.update(err="", delayedOk=True, delayed=0, rank=0 if not key else self.stat["rank"])
        self.wake.set()
        self.wake_full.set()
        return self.check()

    # ---------- Alpaca ----------
    def _take(self, prio):
        while True:
            now = time.time()
            self.tokens = min(170.0, self.tokens + (now - self.refill) * 170 / 60)
            self.refill = now
            if self.tokens >= (1 if prio else 30):
                self.tokens -= 1
                return
            time.sleep(0.1 if prio else 0.5)

    def _alpaca(self, path, params, prio=False):
        self._take(prio)
        url = f"{ALPACA}{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": self.keys.k.get("alpacaKey", ""),
                                                   "APCA-API-SECRET-KEY": self.keys.k.get("alpacaSecret", ""), "User-Agent": "mychart"})
        self.stat["calls"] += 1
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf-8", "replace")
            if e.code == 429:
                time.sleep(5)
            raise RuntimeError(f"Alpaca {e.code} {body}")

    def check(self):
        """키 확인: SPY 스냅샷 한 번"""
        if not self.keys.ok:
            return {"ok": False, "msg": "키 없음"}
        try:
            j = self._alpaca("/v2/stocks/snapshots", {"symbols": "SPY", "feed": "iex"}, True)
            p = (j.get("SPY") or {}).get("latestTrade", {}).get("p")
            return {"ok": True, "msg": f"연결됨 · SPY {p}"}
        except Exception as e:
            self.stat["err"] = str(e)
            return {"ok": False, "msg": str(e)[:160]}

    def _apply_snap(self, s, x, feed):
        if not x:
            return
        today = datetime.now(NY).strftime("%Y-%m-%d")
        db, pb, lt = x.get("dailyBar") or {}, x.get("prevDailyBar") or {}, x.get("latestTrade") or {}
        db_today = bool(db.get("t")) and ny_day(_iso_ms(db["t"])) == today
        if feed == "iex":
            kw = {}
            if lt.get("p"):
                kw.update(p=lt["p"], t=_iso_ms(lt["t"]))
            r = self.rows.get(s)
            if not r or r[1] is None:
                kw["pc"] = (pb if db_today else db).get("c")
            self.put(s, **kw)
        else:
            ref = pb if db_today else db
            kw = {"pc": ref.get("c")}
            if db_today:
                kw.update(dv=round(db.get("v", 0) * (db.get("vw") or db.get("c") or 0)), v=db.get("v"), h=db.get("h"), l=db.get("l"))
            else:
                kw.update(dv=0, v=0)
            r = self.rows.get(s)
            if (not r or r[0] is None) and lt.get("p"):
                kw.update(p=lt["p"], t=_iso_ms(lt["t"]))
            self.put(s, **kw)

    def _snaps(self, syms, feed, prio=False):
        for i in range(0, len(syms), 400):
            part = syms[i:i + 400]
            try:
                j = self._alpaca("/v2/stocks/snapshots", {"symbols": ",".join(s.replace("-", ".") for s in part), "feed": feed}, prio)
                for s in part:
                    self._apply_snap(s, j.get(s.replace("-", ".")), feed)
            except Exception as e:
                msg = str(e)
                if feed == "delayed_sip" and " 403 " in msg:
                    self.stat["delayedOk"] = False
                    return
                self.stat["err"] = msg[:200]
                if " 401 " in msg or " 403 " in msg:
                    return
                log.warning("Alpaca %s: %s", feed, msg[:120])

    # ---------- 야후 ----------
    def _yahoo_rank(self):
        syms = self.syms()
        for i in range(0, len(syms), 200):
            part = syms[i:i + 200]
            try:
                df = self.ydl(part, "5d")
            except Exception as e:
                log.warning("야후 순위 %s", e)
                continue
            for s in part:
                f = self.frame_for(df, s)
                rows = self.df_rows(f, True) if f is not None else []
                if not rows:
                    continue
                last, prev = rows[-1], rows[-2] if len(rows) > 1 else None
                self.put(s, p=last[5], pc=prev[5] if prev else None, dv=round(last[5] * last[6]), v=last[6], h=last[3], l=last[4])
            if self.mode() == "alpaca":
                return
        self.stat["rank"] = time.time()

    def _yahoo_hot(self, syms):
        try:
            q = self.yq(syms)
        except Exception as e:
            log.warning("야후 시세 %s", e)
            return
        for s, v in q.items():
            self.put(s, p=v.get("price"), pc=v.get("prev") if v.get("day") == datetime.now(NY).strftime("%Y-%m-%d") else v.get("price"))

    # ---------- 루프 ----------
    def _hot_syms(self):
        now = time.time()
        for s in [s for s, t in self.hot.items() if now - t > 15]:
            self.hot.pop(s, None)
        return list(self.hot)[:300]

    def _hot_loop(self):
        while True:
            t0 = time.time()
            syms = self._hot_syms()
            try:
                if syms and self.mode() == "alpaca":
                    self._snaps(syms, "iex", True)
                elif syms:
                    self._yahoo_hot(syms)
            except Exception as e:
                log.warning("hot %s", e)
            ses = session()
            wait = (2.5 if ses != "closed" else 30) if self.mode() == "alpaca" else 15
            self.wake.wait(max(0.3, wait - (time.time() - t0)))
            self.wake.clear()

    def _full_loop(self):
        while True:
            t0 = time.time()
            self.stat["mode"] = self.mode()
            try:
                if self.mode() == "alpaca" and self.syms():
                    now = time.time()
                    if self.stat["delayedOk"] and now - self.stat["delayed"] > (60 if session() != "closed" else 600):
                        self._snaps(self.syms(), "delayed_sip")
                        self.stat["delayed"] = now
                    self._snaps(self.syms(), "iex")
                    self.stat["full"] = time.time()
                elif self.syms() and time.time() - self.stat["rank"] > 1800:
                    self._yahoo_rank()
            except Exception as e:
                log.warning("board %s", e)
            wait = (20 if session() != "closed" else 300) if self.mode() == "alpaca" else 60
            if not self.syms():
                wait = 5          # 종목 목록이 아직 없으면 곧 다시
            self.wake_full.wait(max(1, wait - (time.time() - t0)))
            self.wake_full.clear()

    # ---------- API ----------
    def payload(self, since=0, symbols=None):
        if symbols:
            now = time.time()
            for s in symbols[:300]:
                self.hot[s] = now
            if any(s not in self.rows for s in symbols):
                self.wake.set()
        with self.lock:
            if symbols:
                rows = [[s] + self.rows[s][:7] for s in symbols if s in self.rows]
            else:
                rows = [[s] + r[:7] for s, r in self.rows.items() if r[7] > since]
            return {"v": self.ver, "mode": self.mode(), "session": session(), "rows": rows,
                    "stat": {k: self.stat[k] for k in ("calls", "err", "delayedOk")}, "count": len(self.rows)}

    def spark(self, symbols):
        """최근 거래일 30분봉 종가 (미니 차트), 10분 저장"""
        now = time.time()
        need = [s for s in symbols if now - self.spark_cache.get(s, (0, None))[0] > 600]
        if need:
            got = {}
            try:
                if self.mode() == "alpaca":
                    end = datetime.now(timezone.utc).timestamp() - 16 * 60
                    p = {"symbols": ",".join(s.replace("-", ".") for s in need), "timeframe": "30Min",
                         "start": datetime.fromtimestamp(end - 5 * 86400, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                         "end": datetime.fromtimestamp(end, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "limit": 10000, "feed": "sip", "sort": "asc"}
                    j = self._alpaca("/v2/stocks/bars", p, True)
                    for s, arr in (j.get("bars") or {}).items():
                        got[s.replace(".", "-")] = [(b["t"], b["c"]) for b in arr]
                    for s in got:
                        last = ny_day(_iso_ms(got[s][-1][0])) if got[s] else None
                        got[s] = [c for t, c in got[s] if ny_day(_iso_ms(t)) == last]
                else:
                    import yfinance as yf
                    df = yf.download(need, period="5d", interval="30m", group_by="ticker", progress=False, threads=True, auto_adjust=False)
                    for s in need:
                        f = self.frame_for(df, s)
                        if f is None or f.empty:
                            continue
                        f = f.dropna(subset=["Close"])
                        last = f.index[-1].date()
                        got[s] = [round(float(c), 4) for t, c in zip(f.index, f["Close"]) if t.date() == last]
            except Exception as e:
                log.warning("spark %s", e)
            for s in need:
                self.spark_cache[s] = (now, got.get(s, self.spark_cache.get(s, (0, []))[1] or []))
        return {s: self.spark_cache.get(s, (0, []))[1] for s in symbols}


def _iso_ms(s):
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return 0
