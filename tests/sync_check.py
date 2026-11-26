# PC 서버 「브라우저 맞춤」 점검: 읽기·쓰기 권한, 칸 단위 저장, since, 백업, 크기 제한, 깨진 파일
# 실행: python tests/sync_check.py   (인터넷 필요 없음)
import json, os, sys, tempfile, threading, urllib.request, urllib.error
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import chart_server as cs
from http.server import ThreadingHTTPServer

fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c:
        fails += 1

tmp = tempfile.mkdtemp()
cs.SYNC = cs.SyncStore(tmp)
srv = ThreadingHTTPServer(("127.0.0.1", 0), cs.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % srv.server_address[1]
HOME = "https://slagood2-lang.github.io"

def req(method, path, body=None, origin=HOME, hdr=True):
    h = {"Content-Type": "application/json"}
    if origin: h["Origin"] = origin
    if hdr: h["X-MC-Sync"] = "1"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=10) as x:
            return x.status, json.loads(x.read() or b"{}"), dict(x.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), dict(e.headers)

st, j, _ = req("GET", "/api/ping", hdr=False)
ok(st == 200 and j.get("version") == cs.SERVER_VERSION and j.get("sync") is True, "ping: 버전 %s · 맞춤 지원 표시" % j.get("version"))
ok(req("GET", "/api/sync", hdr=False)[0] == 403, "맞춤 머리글 없는 읽기 → 막음 (다른 사이트가 <script>로 못 읽게)")
ok(req("GET", "/api/sync", origin="https://evil.example")[0] == 403, "다른 사이트에서 읽기 → 막음")
ok(req("POST", "/api/sync", {"changes": {"st.lists": "[]"}}, origin="https://evil.example")[0] == 403, "다른 사이트에서 쓰기 → 막음")
st, j, _ = req("GET", "/api/sync?since=0")
ok(st == 200 and j["rev"] == 0 and j["sec"] == {}, "처음: 비어 있음 (rev 0)")

lists = json.dumps([{"name": "내 관심목록", "items": ["BINANCE:BTCUSDT", "YAHOO:PLTR"]}], ensure_ascii=False)
st, j, _ = req("POST", "/api/sync", {"by": "크롬", "changes": {"st.lists": lists, "st.chartCfg": "{\"up\":\"#089981\"}", "d.BINANCE:BTCUSDT": "[{\"id\":\"a\"}]", "tfs": "{\"fav\":[\"1h\"]}"}})
ok(st == 200 and j["rev"] == 1, "크롬에서 올림 → rev 1")
st, j, _ = req("GET", "/api/sync?since=0", origin="http://localhost:8000")
ok(st == 200 and j["rev"] == 1 and json.loads(j["sec"]["st.lists"]["v"])[0]["items"][1] == "YAHOO:PLTR" and j["sec"]["st.lists"]["by"] == "크롬", "이 PC 화면(localhost)에서 읽기 → 관심목록·누가 올렸는지 그대로")
ok(req("GET", "/api/sync?since=1")[1]["sec"] == {}, "since=1 → 새로 바뀐 것 없음")
st, j, _ = req("POST", "/api/sync", {"by": "Claude 앱", "changes": {"d.BINANCE:BTCUSDT": None, "st.toolStyle": "{\"trend\":{\"w\":4}}"}})
st2, j2, _ = req("GET", "/api/sync?since=1")
ok(st == 200 and j["rev"] == 2 and set(j2["sec"]) == {"d.BINANCE:BTCUSDT", "st.toolStyle"} and j2["sec"]["d.BINANCE:BTCUSDT"]["v"] is None, "칸 단위: 바뀐 칸만 since 뒤로 옴 · 지운 그림은 null")
ok(req("GET", "/api/sync?since=99")[1].get("since") == 0, "서버보다 앞선 since → 전부 다시 (서버 새로 시작한 경우)")
ok(req("POST", "/api/sync", {"changes": {"key": "x"}})[0] == 400, "맞춤 대상 아닌 칸 → 거절 (400)")
ok(req("POST", "/api/sync", {"changes": {"st.lists": 5}})[0] == 400, "문자열 아닌 값 → 거절")
ok(req("POST", "/api/sync", {"changes": {}})[0] == 400, "빈 변경 → 거절")
old = cs.SYNC_MAX; cs.SYNC_MAX = 500
ok(req("POST", "/api/sync", {"changes": {"st.big": "x" * 2000}})[0] == 413, "너무 큰 요청 → 413")
cs.SYNC_MAX = old
big = "y" * 3_000_000
ok(req("POST", "/api/sync", {"changes": {"d.YAHOO:NVDA": big}})[0] == 200, "붙여 넣은 그림 등 큰 그림(3MB)도 저장")
bk = os.listdir(os.path.join(tmp, "sync_backup"))
ok(len(bk) == 1 and bk[0].startswith("sync_"), "하루 한 개 백업 파일 (%s)" % bk)
s2 = cs.SyncStore(tmp)
ok(s2.get(0)["rev"] == cs.SYNC.get(0)["rev"] >= 3, "서버를 다시 켜도 그대로 (rev %d)" % s2.get(0)["rev"])
with open(os.path.join(tmp, "sync_state.json"), "w") as f:
    f.write("{깨짐")
s3 = cs.SyncStore(tmp)
ok(s3.get(0)["rev"] == 0 and os.path.exists(os.path.join(tmp, "sync_state.json.broken")), "깨진 파일 → 옆에 남기고 새로 시작")
r = urllib.request.Request(BASE + "/api/sync", method="OPTIONS", headers={"Origin": HOME, "Access-Control-Request-Headers": "x-mc-sync,content-type"})
with urllib.request.urlopen(r, timeout=5) as x:
    ok("X-MC-Sync" in x.headers.get("Access-Control-Allow-Headers", ""), "사전 확인(OPTIONS)에 맞춤 머리글 허용")
srv.shutdown()
print("모두 통과" if not fails else "실패 %d" % fails)
sys.exit(1 if fails else 0)
