"""
미국 전 종목 목록(us_universe.py) 점검 — 인터넷 없이 가짜 나스닥·한투·SEC 파일로
실행: python tests/us_universe_check.py   (yfinance·pandas가 깔려 있으면 거래대금 순위까지 확인)
"""
import io, json, os, sys, tempfile, threading, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

ROWS = [  # 기호, 한글명, 영문명, 거래소(나스닥 코드), ETF, SIC
    ("TSLA", "테슬라", "Tesla, Inc. Common Stock", "Q", "N", "3711"), ("NVDA", "엔비디아", "NVIDIA Corporation Common Stock", "Q", "N", "3674"),
    ("AAPL", "애플", "Apple Inc. Common Stock", "Q", "N", "3571"), ("MSFT", "마이크로소프트", "Microsoft Corporation Common Stock", "Q", "N", "7372"),
    ("UNH", "유나이티드헬스", "UnitedHealth Group Incorporated Common Stock", "N", "N", "6324"), ("O", "리얼티 인컴", "Realty Income Corporation", "N", "N", "6798"),
    ("BRK.B", "버크셔 해서웨이 B", "Berkshire Hathaway Inc. Class B", "N", "N", "6331"),
    ("SPY", "SPDR S&P 500", "SPDR S&P 500 ETF Trust", "P", "Y", ""), ("SQQQ", "울트라프로 숏 QQQ", "ProShares UltraPro Short QQQ", "Q", "Y", ""),
    ("SOXL", "반도체 3X", "Direxion Daily Semiconductor Bull 3X Shares", "P", "Y", ""), ("SCHD", "슈왑 배당", "Schwab US Dividend Equity ETF", "P", "Y", ""),
    ("ABCDW", "", "ABCD Corp Warrants", "Q", "N", ""),
]
CIK = {r[0]: str(1000 + i).zfill(10) for i, r in enumerate(ROWS)}


def files(path):
    if path.endswith("nasdaqlisted.txt"):
        body = "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n"
        body += "".join(f"{r[0]}|{r[2]}|Q|N|N|100|{r[4]}|N\n" for r in ROWS if r[3] == "Q") + "ZZZT|Test|Q|Y|N|100|N|N\nFile Creation Time: x|||||||"
        return body.encode()
    if path.endswith("otherlisted.txt"):
        body = "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\n"
        return (body + "".join(f"{r[0]}|{r[2]}|{r[3]}|{r[0]}|{r[4]}|100|N|{r[0]}\n" for r in ROWS if r[3] != "Q") + "File Creation Time: x|||||||").encode()
    if path.endswith("mst.cod.zip"):
        m = path.split("/")[-1][:3]
        ex = {"nas": ("Q",), "nys": ("N", "P"), "ams": ("A",)}[m]
        lines = ["\t".join(["US", "22", m.upper(), "x", r[0].replace(".", "/"), "D" + r[0], r[1], r[2], "3" if r[4] == "Y" else "2"] + [""] * 15)
                 for r in ROWS if r[3] in ex]
        b = io.BytesIO(); z = zipfile.ZipFile(b, "w"); z.writestr(f"{m}mst.cod", "\n".join(lines).encode("cp949")); z.close()
        return b.getvalue()
    if path.endswith("company_tickers_exchange.json"):
        return json.dumps({"fields": ["cik", "name", "ticker", "exchange"], "data": [[int(CIK[r[0]]), r[2], r[0], "x"] for r in ROWS if r[4] == "N"]}).encode()
    if "/submissions/CIK" in path:
        cik = path.split("CIK")[1][:10]
        r = next(r for r in ROWS if CIK[r[0]] == cik)
        return json.dumps({"sic": r[5], "sicDescription": "x"}).encode()
    return None


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        b = files(self.path)
        self.send_response(200 if b is not None else 404); self.end_headers(); self.wfile.write(b or b"")


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    os.environ.update(MYCHART_NASDAQ=base + "/nasdaq", MYCHART_KIS=base + "/kis", MYCHART_SEC_WWW=base + "/sec", MYCHART_SEC_DATA=base + "/secdata")
    import us_universe as U
    U.DATA = tempfile.mkdtemp()
    bad = 0

    def ok(c, msg):
        nonlocal bad
        print(("ok   " if c else "FAIL ") + msg)
        bad += not c

    uni = U.Universe(); uni.build(); uni.fill_sic()
    p = uni.payload(); by = {r[0]: r for r in p["rows"]}
    ok(len(p["rows"]) == len(ROWS), f"테스트 종목 제외하고 {len(ROWS)}개: {len(p['rows'])}")
    ok(by["TSLA"][1] == "테슬라" and by["SPY"][4] == "etf", "한글명·ETF 구분")
    ok("BRK-B" in by and by["BRK-B"][1].startswith("버크셔"), "BRK.B, BRK/B → 야후 표기 BRK-B, 한글명 연결")
    ok(by["ABCDW"][4] == "wrt", "워런트 구분")
    g = {x["id"]: x["syms"] for k in ("theme", "sector", "etf") for x in p["groups"][k]}
    ok(g["s-semi"] == ["NVDA"] and "TSLA" in g["s-indu"] and "UNH" in g["s-fin"] and "O" in g["s-realty"], "SIC 섹터 (반도체·산업재·금융·부동산)")
    ok(g["e-inv"] == ["SQQQ"] and g["e-lev"] == ["SOXL"] and g["e-div"] == ["SCHD"] and g["e-idx"] == ["SPY"], "ETF 분류 (인버스·레버리지·배당·지수)")
    ok(g["t-big7"] == ["NVDA", "AAPL", "MSFT", "TSLA"], "테마는 있는 종목만: " + ",".join(g["t-big7"]))
    ok(p["sic"]["done"] == p["sic"]["total"] and not p["sic"]["running"], "SEC 업종코드 다 받음")
    uni2 = U.Universe(); ok(uni2.u and len(uni2.u["rows"]) == len(ROWS) and uni2.sic, "data 폴더 저장본으로 다시 시작")

    try:
        import numpy as np, pandas as pd
        import chart_server as cs
        cs.UNI = uni
        import chart_server
        chart_server.UNI.groups = uni.groups; chart_server.UNI.u = uni.u

        def fake(symbols, period):
            idx = pd.date_range("2026-11-18", periods=5, freq="B")
            cols = pd.MultiIndex.from_product([symbols, ["Open", "High", "Low", "Close", "Adj Close", "Volume"]])
            d = np.zeros((5, len(cols)))
            for i, _ in enumerate(symbols):
                for j in range(6):
                    d[:, i * 6 + j] = (np.arange(5) + 10 + i) if j < 5 else 1000 * (i + 1)
            return pd.DataFrame(d, index=idx, columns=cols)
        cs.download = fake
        r = cs.us_group("t-big7", 10)
        ok([x["symbol"] for x in r["rows"]] == ["TSLA", "MSFT", "AAPL", "NVDA"] and r["rows"][0]["name"] == "테슬라", "분류 안 거래대금 순위 + 한글명")
    except ImportError as e:
        print("skip 거래대금 순위 (", e, ")")
    srv.shutdown()
    print("통과" if not bad else f"실패 {bad}개")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
