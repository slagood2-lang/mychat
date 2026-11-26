"""
미국 전 종목 목록 (chart_server.py가 불러 씀)

- 나스닥 심볼 디렉토리(공식, 무료): 상장 종목 · 거래소 · ETF 여부 · 테스트 종목 제외
- 한국투자증권 해외종목 마스터(공개 파일): 한글 종목명
- SEC EDGAR(무료, 키 없음): 회사별 SIC 업종코드 → 섹터 (처음 한 번 15분쯤, 이후 저장본 사용)

결과: data/us_universe.json (하루 1회 갱신), data/us_sic.json (업종코드 누적 저장)
표준 라이브러리만 씁니다.
"""
import io
import json
import logging
import os
import ssl
import threading
import time
import urllib.request
import zipfile

log = logging.getLogger("mychart.us")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

NASDAQ = os.environ.get("MYCHART_NASDAQ", "https://www.nasdaqtrader.com/dynamic/SymDir")
KIS = os.environ.get("MYCHART_KIS", "https://new.real.download.dws.co.kr/common/master")
SEC_WWW = os.environ.get("MYCHART_SEC_WWW", "https://www.sec.gov")
SEC_DATA = os.environ.get("MYCHART_SEC_DATA", "https://data.sec.gov")
EXCH = {"Q": "NASDAQ", "N": "NYSE", "A": "NYSE American", "P": "NYSE Arca", "Z": "Cboe BZX", "V": "IEX"}

SECTORS = [("s-tech", "기술"), ("s-semi", "반도체"), ("s-fin", "금융"), ("s-health", "헬스케어"), ("s-cons", "소비"), ("s-energy", "에너지"),
           ("s-indu", "산업재"), ("s-comm", "통신"), ("s-util", "유틸리티"), ("s-realty", "부동산"), ("s-mat", "소재")]
ETFS = [("e-idx", "지수"), ("e-lev", "레버리지"), ("e-inv", "인버스"), ("e-sector", "섹터·테마"), ("e-div", "배당·커버드콜"),
        ("e-bond", "채권"), ("e-alt", "코인·원자재"), ("e-etc", "기타")]
# 테마는 직접 관리 (없는 종목은 자동 제외). 자유롭게 고치세요.
THEMES = [
    ("t-big7", "빅테크 7", "NVDA AAPL MSFT AMZN GOOGL META TSLA"),
    ("t-aichip", "AI 반도체", "NVDA AMD AVGO TSM MU ARM MRVL QCOM INTC ASML AMAT LRCX KLAC SMCI ALAB"),
    ("t-aisw", "AI 소프트웨어", "PLTR MSFT ORCL NOW CRM SNOW AI PATH SOUN BBAI DDOG MDB"),
    ("t-space", "우주항공", "RKLB ASTS LUNR PL RDW BA LMT NOC RTX IRDM KTOS"),
    ("t-quantum", "양자컴퓨터", "IONQ RGTI QBTS QUBT IBM GOOGL ARQQ"),
    ("t-nuke", "원자력·SMR", "CEG VST OKLO SMR NNE CCJ LEU BWXT GEV TLN UEC"),
    ("t-btc", "비트코인 관련주", "MSTR COIN MARA RIOT CLSK HOOD IBIT BITX HUT CIFR GLXY"),
    ("t-ev", "전기차·자율주행", "TSLA RIVN LCID NIO XPEV LI GM F UBER MBLY"),
    ("t-power", "AI 전력·인프라", "VRT ETN GEV PWR NRG VST CEG ANET DELL EQIX DLR"),
    ("t-lev", "인기 레버리지 ETF", "TQQQ SOXL UPRO NVDL TSLL FNGU TECL LABU CONL MSTU"),
    ("t-inv", "인기 인버스 ETF", "SQQQ SOXS SPXU SH PSQ TSLQ NVD LABD"),
    ("t-div", "배당 ETF", "SCHD JEPI JEPQ VYM DGRO DIVO QYLD SPYD HDV NOBL"),
]


def norm(s):
    """나스닥·한투 표기 → 야후 표기 (BRK.B, BRK/B → BRK-B)"""
    s = (s or "").strip().upper().replace("/", ".").replace(" ", ".")
    return s.replace(".", "-") if s.count(".") == 1 and len(s.split(".")[1]) <= 2 else s


def _ua():
    email = os.environ.get("MYCHART_SEC_EMAIL") or "mychart@users.noreply.github.com"
    return f"mychart personal research {email}"


def http_get(url, timeout=40, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": _ua(), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.URLError as e:
        # 윈도우 파이썬은 인증서 묶음이 빠진 경우가 있음 → certifi(yfinance와 함께 설치됨)로 한 번 더 (검증은 유지)
        if isinstance(getattr(e, "reason", None), ssl.SSLError):
            try:
                import certifi
                ctx = ssl.create_default_context(cafile=certifi.where())
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                    return r.read()
            except ImportError:
                pass
        raise


def _read(name, default):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(name, obj):
    os.makedirs(DATA, exist_ok=True)
    p = os.path.join(DATA, name)
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(p + ".tmp", p)   # 중간에 꺼져도 파일이 깨지지 않게


# ---------------- 분류 ----------------
import re  # noqa: E402

_RX = {k: re.compile(v, re.I) for k, v in {
    "inv": r"inverse|\bshort\b|\bbear\b|ultrashort|-1x|-2x|-3x|\bdecliner",
    "lev": r"\b(1\.5|2|3)x\b|\bultra\b|ultrapro|\bbull\b|leveraged|2x long",
    "div": r"covered call|option income|premium income|buywrite|yieldmax|dividend|income etf",
    "bond": r"treasury|bond|t-bill|aggregate|fixed income|municipal|\bmuni\b|corporate|credit|floating rate|mortgage|\btips\b|duration",
    "alt": r"bitcoin|ether|crypto|solana|\bxrp\b|gold|silver|commodity|oil fund|natural gas|uranium",
    "sector": r"semiconductor|technology|\btech\b|financial|health|biotech|energy|utilities|real estate|reit|industrial|materials|consumer|"
              r"communication|bank|insurance|\boil\b|\bgas\b|miners|homebuilder|software|cyber|cloud|robot|artificial intelligence|\bai\b|"
              r"clean|solar|aerospace|defense|internet|innovation|sector|infrastructure|pharma|cannabis|space|quantum|nuclear",
    "idx": r"s&p|500|nasdaq|qqq|\bdow\b|russell|total (stock )?market|msci|ftse|index|large.?cap|mid.?cap|small.?cap|equal weight|"
           r"\bvalue\b|growth|momentum|quality|world|international|emerging|developed",
}.items()}


def etf_cat(name):
    for k in ("inv", "lev", "div", "bond", "alt", "sector", "idx"):
        if _RX[k].search(name or ""):
            return "e-" + k
    return "e-etc"


def sec_type(en, etf, kis_type):
    n = (en or "").lower()
    if etf or kis_type == "3":
        return "etf"
    if re.search(r"\bwarrants?\b|\bwts?\b", n) or kis_type == "4":
        return "wrt"
    if re.search(r"\bunits?\b", n):
        return "unit"
    if re.search(r"\brights?\b", n):
        return "rt"
    if re.search(r"preferred|\bpfd\b|depositary shares|% (series|notes)|notes due|senior notes|debentures", n):
        return "pfd"
    return "cs"


def sic_sector(sic):
    try:
        s = int(sic)
    except (TypeError, ValueError):
        return None
    r = lambda a, b: a <= s <= b  # noqa: E731
    if s == 3674: return "s-semi"
    if r(6500, 6553) or s == 6798: return "s-realty"
    if r(6000, 6799): return "s-fin"
    if r(2830, 2836) or r(3841, 3851) or r(8000, 8099) or s in (8731, 5047, 5122): return "s-health"
    if r(1300, 1399) or r(2900, 2999) or r(4610, 4619) or r(5170, 5172): return "s-energy"
    if r(4900, 4999): return "s-util"
    if r(4800, 4899) or r(7810, 7849) or r(2710, 2799): return "s-comm"
    if r(3570, 3579) or r(3660, 3679) or r(3810, 3829) or r(7370, 7379) or s == 3695: return "s-tech"
    if r(1000, 1299) or r(1400, 1499) or r(2600, 2699) or r(2800, 2829) or r(2840, 2899) or r(3200, 3399): return "s-mat"
    if (r(2000, 2399) or r(2500, 2599) or r(3000, 3199) or r(3630, 3639) or r(3940, 3949) or r(5000, 5999) or r(7000, 7299)
            or r(7900, 7999) or r(8200, 8299)): return "s-cons"
    return "s-indu"


# ---------------- 불러오기 ----------------
def load_nasdaq():
    rows = {}

    def lines(f):
        txt = http_get(f"{NASDAQ}/{f}").decode("utf-8", "replace")
        return [ln.split("|") for ln in txt.splitlines()[1:] if ln and not ln.startswith("File Creation Time")]
    # Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
    for c in lines("nasdaqlisted.txt"):
        if len(c) > 6 and c[3] != "Y":
            s = norm(c[0]); rows[s] = (s, c[1], "NASDAQ", c[6] == "Y")
    # ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
    for c in lines("otherlisted.txt"):
        if len(c) > 6 and c[6] != "Y":
            s = norm(c[3] or c[0]); rows[s] = (s, c[1], EXCH.get(c[2], c[2]), c[4] == "Y")
    return rows


def load_kis():
    out = {}
    for m in ("nas", "nys", "ams"):
        try:
            z = zipfile.ZipFile(io.BytesIO(http_get(f"{KIS}/{m}mst.cod.zip", timeout=60)))
            name = next(n for n in z.namelist() if n.endswith(".cod"))
            for line in z.read(name).decode("cp949", "replace").splitlines():
                c = line.split("\t")
                # [4]Symbol [6]한글명 [7]영문명 [8]종류(1지수 2주식 3ETP 4워런트)
                if len(c) > 8 and c[4]:
                    out[norm(c[4])] = ((c[6] or "").strip(), c[8])
        except Exception as e:
            log.warning("한투 종목 마스터(%s) 실패: %s — 한글명 없이 진행", m, e)
    return out


class Universe:
    def __init__(self):
        self.u = _read("us_universe.json", None)   # {builtAt, rows, cik}
        self.sic = _read("us_sic.json", {})
        self.groups, self.version = None, 0
        self.progress = {"done": 0, "total": 0, "running": False}
        self.lock = threading.Lock()
        self.building = False

    def start(self):
        threading.Thread(target=self._loop, daemon=True, name="us-universe").start()

    def _loop(self):
        while True:
            try:
                if not self.u or time.time() - self.u.get("builtAt", 0) > 20 * 3600:
                    self.build()
                else:
                    self._group()
                self.fill_sic()
            except Exception as e:
                log.warning("미국 종목 목록 갱신 실패: %s", e)
            time.sleep(3600)

    def build(self):
        self.building = True
        try:
            log.info("미국 종목 목록 만드는 중…")
            nas, kis = load_nasdaq(), load_kis()
            cik = {}
            try:
                j = json.loads(http_get(f"{SEC_WWW}/files/company_tickers_exchange.json"))
                fi = {f: i for i, f in enumerate(j["fields"])}
                for d in j["data"]:
                    cik[norm(d[fi["ticker"]])] = str(d[fi["cik"]]).zfill(10)
            except Exception as e:
                log.warning("SEC 티커 목록 실패: %s", e)
                cik = (self.u or {}).get("cik", {})
            rows = []
            for s, en, ex, etf in nas.values():
                ko, kt = kis.get(s, ("", ""))
                t = sec_type(en, etf, kt)
                rows.append([s, ko, en, ex, t, etf_cat(en) if t == "etf" else ""])
            rows.sort(key=lambda r: r[0])
            with self.lock:
                self.u = {"builtAt": time.time(), "rows": rows, "cik": cik}
            _write("us_universe.json", self.u)
            log.info("미국 종목 %d개 (한글명 %d개)", len(rows), sum(1 for r in rows if r[1]))
            self._group()
        finally:
            self.building = False

    def _group(self):
        if not self.u:
            return
        rows, cik = self.u["rows"], self.u["cik"]
        have = {r[0] for r in rows}
        sec = {k: [] for k, _ in SECTORS}
        etf = {k: [] for k, _ in ETFS}
        for r in rows:
            if r[4] == "etf":
                etf.setdefault(r[5], []).append(r[0])
            elif r[4] == "cs":
                c = cik.get(r[0])
                s = c and self.sic.get(c) and sic_sector(self.sic[c][0])
                if s:
                    sec[s].append(r[0])
        g = {"theme": [{"id": i, "name": n, "syms": [s for s in syms.split() if s in have]} for i, n, syms in THEMES],
             "sector": [{"id": i, "name": n, "syms": sec[i]} for i, n in SECTORS],
             "etf": [{"id": i, "name": n, "syms": etf.get(i, [])} for i, n in ETFS if etf.get(i)]}
        with self.lock:
            self.groups = g
            self.version += 1

    def fill_sic(self):
        """SEC 업종코드: 초당 8회 이하(SEC 규정 10회), 이미 받은 회사는 건너뜀"""
        if self.progress["running"] or not self.u:
            return
        ciks = sorted({self.u["cik"][r[0]] for r in self.u["rows"] if r[4] == "cs" and r[0] in self.u["cik"]})
        todo = [c for c in ciks if c not in self.sic]
        self.progress = {"done": len(ciks) - len(todo), "total": len(ciks), "running": True}
        if todo:
            log.info("섹터 분류용 SEC 업종코드 %d개 받는 중 (약 %d분, 한 번만)", len(todo), len(todo) // 480 + 1)
        try:
            for n, c in enumerate(todo, 1):
                try:
                    j = json.loads(http_get(f"{SEC_DATA}/submissions/CIK{c}.json", timeout=20))
                    self.sic[c] = [j.get("sic") or "", j.get("sicDescription") or ""]
                except Exception:
                    self.sic[c] = ["", ""]
                self.progress["done"] += 1
                if n % 300 == 0:
                    _write("us_sic.json", self.sic); self._group()
                time.sleep(0.125)
        finally:
            if todo:
                _write("us_sic.json", self.sic)
                log.info("SEC 업종코드 완료")
            self.progress["running"] = False
            self._group()

    def payload(self):
        with self.lock:
            return {"v": f"{int((self.u or {}).get('builtAt', 0))}-{self.version}", "rows": (self.u or {}).get("rows", []),
                    "groups": self.groups, "sic": dict(self.progress), "building": self.building}

    def group_syms(self, gid):
        g = self.groups or {}
        for kind in ("theme", "sector", "etf"):
            for x in g.get(kind, []):
                if x["id"] == gid:
                    return x["name"], list(x["syms"])
        raise LookupError("없는 분류: " + gid)

    def names(self):
        with self.lock:
            return {r[0]: (r[1] or r[2]) for r in (self.u or {}).get("rows", [])}


UNI = Universe()
