"""us_market.py 점검 — 가짜 Alpaca 서버로 시세판을 돌려 봄 (인터넷·진짜 키 필요 없음)
실행: python tests/us_market_check.py
"""
import json
import os
import sys
import tempfile
import threading
import urllib.parse
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
fails = 0


def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    fails += 0 if c else 1


NOW = datetime.now(timezone.utc)
NYD = (NOW - timedelta(hours=5)).date()                # 뉴욕 날짜 (12시 UTC는 뉴욕 같은 날 아침)
if NOW.hour < 5 and (NOW - timedelta(hours=4)).date() != NYD:
    NYD = (NOW - timedelta(hours=4)).date()
TODAY = NYD.strftime("%Y-%m-%dT12:00:00Z")
YDAY = (NYD - timedelta(days=1)).strftime("%Y-%m-%dT12:00:00Z")
CALLS = []
DELAYED_403 = {"on": False}


def snap(p, pc, v, vw, today=True):
    return {"latestTrade": {"p": p, "t": NOW.strftime("%Y-%m-%dT%H:%M:%SZ")},
            "dailyBar": {"t": TODAY if today else YDAY, "c": p, "v": v, "vw": vw, "h": p * 1.01, "l": p * 0.98},
            "prevDailyBar": {"t": YDAY, "c": pc}}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        CALLS.append((u.path, q.get("feed"), q.get("symbols")))
        if self.headers.get("APCA-API-KEY-ID") != "PKGOOD" or self.headers.get("APCA-API-SECRET-KEY") != "S":
            return self.send(401, {"message": "unauthorized"})
        syms = (q.get("symbols") or "").split(",")
        if u.path == "/v2/stocks/snapshots":
            if q.get("feed") == "delayed_sip" and DELAYED_403["on"]:
                return self.send(403, {"message": "subscription does not permit querying recent SIP data"})
            iex = q.get("feed") == "iex"
            data = {"SPY": snap(668.5 if iex else 668.0, 660, 1000, 667), "NVDA": snap(182.2 if iex else 182.0, 180, 2000, 181),
                    "BRK.B": snap(480.0, 478, 300, 479), "OLD": snap(10.0, 9.5, 50, 10, today=False)}
            return self.send(200, {s: data[s] for s in syms if s in data})
        if u.path == "/v2/stocks/bars":
            bars = {}
            for s in syms:
                bars[s] = [{"t": YDAY.replace("12:00", "15:00"), "c": 1.0}] + [{"t": TODAY.replace("12:00", f"{14 + i}:00"), "c": 2.0 + i} for i in range(5)]
            return self.send(200, {"bars": bars})
        self.send(404, {})

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["MYCHART_ALPACA"] = f"http://127.0.0.1:{srv.server_port}"
os.environ.pop("ALPACA_KEY", None)

import us_market as um  # noqa: E402

um.DATA = tempfile.mkdtemp()


class Uni:
    u = {"rows": [["SPY", "", "", "", "etf"], ["NVDA", "", "", "", "cs"], ["BRK-B", "", "", "", "cs"], ["OLD", "", "", "", "cs"], ["WARR", "", "", "", "w"]]}


# ---- 1. 장 상태 (뉴욕 시각) ----
T = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
cases = [("2026-11-25T14:00", "pre"), ("2026-11-25T14:30", "regular"), ("2026-11-25T21:00", "after"), ("2026-11-26T01:01", "closed"),
         ("2026-11-26T15:00", "closed"), ("2026-11-27T18:00", "after"), ("2026-11-28T15:00", "closed"), ("2026-07-06T13:30", "regular"),
         ("2026-03-09T13:30", "regular"), ("2026-03-06T14:30", "regular"), ("2026-03-06T14:00", "pre")]
got = [um.session(T(t)) for t, _ in cases]
ok(got == [w for _, w in cases], "장 상태 (프리·정규·애프터·추수감사절·조기폐장·서머타임 전후): " + " ".join(got))

# ---- 2. 키 없음 → 야후 방식 ----
b = um.Board(Uni(), lambda syms: {s: {"price": 5.0, "prev": 4.0, "day": "2000-01-01"} for s in syms}, None, None, None)
ok(b.mode() == "yahoo" and b.check()["ok"] is False, "키 없으면 야후 방식")
ok(b.syms() == ["SPY", "NVDA", "BRK-B", "OLD"], "시세판 대상: 보통주·ETF만 (워런트 제외)")
b._yahoo_hot(["SPY"])
ok(b.rows["SPY"][:2] == [5.0, 5.0], "야후: 오늘 거래 없는 날은 전일 종가 = 현재가 (변동 0%)")

# ---- 3. 키 저장 → 틀린 키 / 맞는 키 ----
r = b.set_keys("PKBAD", "S")
ok(r["ok"] is False and "401" in r["msg"], "틀린 키 거절: " + r["msg"][:40])
r = b.set_keys("PKGOOD", "S")
ok(r["ok"] is True and "668.5" in r["msg"] and b.mode() == "alpaca", "맞는 키 연결: " + r["msg"])
saved = json.load(open(os.path.join(um.DATA, "us_keys.json")))
ok(saved == {"alpacaKey": "PKGOOD", "alpacaSecret": "S"} and um.Keys().ok, "키는 이 PC data/us_keys.json에만 저장")

# ---- 4. 15분 지연 전 거래소 + IEX 실시간 ----
b.rows.clear()
CALLS.clear()
b._snaps(b.syms(), "delayed_sip")
b._snaps(b.syms(), "iex")
spy, nv, brk, old = b.rows["SPY"], b.rows["NVDA"], b.rows["BRK-B"], b.rows["OLD"]
ok(spy[0] == 668.5 and spy[1] == 660 and spy[2] == round(1000 * 667), f"SPY 가격(IEX)·전일종가·거래대금(지연): {spy[:3]}")
ok(nv[0] == 182.2 and nv[1] == 180, "NVDA 가격·전일 종가")
ok(brk[0] == 480.0 and "BRK.B" in (CALLS[0][2] or ""), "BRK-B ↔ BRK.B 이름 바꿔 요청")
ok(old[1] == 10.0 and old[2] == 0, "오늘 거래 없는 종목: 전일 종가 = 마지막 종가, 거래대금 0")
ok({c[1] for c in CALLS} == {"delayed_sip", "iex"}, "두 가지 피드 사용")

# ---- 5. payload: 바뀐 것만 · 보이는 종목 ----
v0 = b.payload()["v"]
b.put("NVDA", p=183.0)
p = b.payload(since=v0)
ok([r[0] for r in p["rows"]] == ["NVDA"] and p["rows"][0][1] == 183.0 and p["mode"] == "alpaca", "since 이후 바뀐 종목만 보냄")
p = b.payload(symbols=["SPY", "ZZZ"])
ok([r[0] for r in p["rows"]] == ["SPY"] and "ZZZ" in b.hot and b.wake.is_set(), "보이는 종목 요청 → 빠른 갱신 대상 등록·즉시 깨움")

# ---- 6. 지연 시세 권한 없음 ----
DELAYED_403["on"] = True
b._snaps(b.syms(), "delayed_sip")
ok(b.stat["delayedOk"] is False and b.stat["err"] == "", "지연 시세 403 → 그 피드만 끔 (오류 아님)")

# ---- 7. 미니 차트: 마지막 거래일 30분봉만 ----
sp = b.spark(["SPY", "BRK-B"])
ok(sp["SPY"] == [2.0, 3.0, 4.0, 5.0, 6.0] and sp["BRK-B"] == [2.0, 3.0, 4.0, 5.0, 6.0], "미니 차트 오늘 봉만: " + str(sp["SPY"]))
n = len(CALLS)
b.spark(["SPY"])
ok(len(CALLS) == n, "미니 차트 10분 저장 (다시 안 부름)")

# ---- 8. 분당 한도 ----
b.tokens, b.refill = 10.0, __import__("time").time()
t0 = __import__("time").time()
b._take(True)
ok(b.tokens < 10 and __import__("time").time() - t0 < 0.2, "급한 요청은 남은 토큰 30 미만이어도 바로")

srv.shutdown()
print("\n" + ("모두 통과" if not fails else f"{fails}개 실패"))
sys.exit(1 if fails else 0)
