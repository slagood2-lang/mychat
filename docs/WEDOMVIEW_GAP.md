# wedomview.com 대조표 — 나만의 차트에 있는 것 · 없는 것

조사일 2026-11-25. 로그인 없이 보이는 화면만 확인했습니다 (스크리너·알림·스크립트·웨돔 지표는 로그인 뒤에만 열림).

## 먼저 알아둘 것

wedomview의 차트·지표 창·그리기 도구는 직접 만든 것이 아니라 **TradingView Advanced Charts(Charting Library) v32** 를 그대로 올린 것입니다
(`/charting_library/charting_library.standalone.js`, 화면 아래 「차트 제공 TradingView」). 기본 지표 107종과 그리기 도구 80여 종이 거기서 나옵니다.

- 이 라이브러리는 소스 비공개·독점 라이선스입니다. 트레이딩뷰에 신청해 승인받아야 받고, 공개 웹사이트에서 트레이딩뷰 표기를 유지하는 조건입니다. 개인·비공개 용도는 대상이 아닙니다.
- 그래서 이 프로젝트는 계속 Lightweight Charts(Apache-2.0) 위에 지표·도구를 직접 구현합니다. 공식은 공개된 표준 공식입니다.
- 웨돔 자체 지표(아트로포스·다이아·헥사곤·구름대·클러스터)는 그쪽 유료 자산이고 계산식이 공개되어 있지 않아 가져오지 않습니다.

## 이번에 넣은 것 (1차)

| 기능 | 내용 |
|---|---|
| 지표 66종 추가 (14 → 80종) | 이동평균 13 · 추세 9 · 밴드/채널 3 · 모멘텀 21 · 변동성 9 · 거래량 11. 지표 창에 분류 칩 |
| 종목 아이콘 | 관심목록·검색·상단 심볼 버튼. 로고가 없으면 글자 동그라미 |
| 호가 · 체결 | 오른쪽 「호가」 탭. 호가 묶음(틱 ×1·10·100·1000), 코인/USDT 단위, 누적 막대, 매수·매도 잔량 비율, 체결 목록, 대량 체결만 보기 |

## 아직 없는 것

### 지표 (트레이딩뷰 기본 107종 기준, 남은 약 27종)
- 다른 종목이 필요한 것: Ratio, Spread, Correlation Coefficient, Correlation-Log, Advance/Decline
- 그리기 엔진이 더 필요한 것: Volume Profile (Fixed Range · Visible Range), Pivot Points Standard, 일목 구름 색칠
- 단순 변형: MA Cross, EMA Cross, MA Double/Triple/Multiple/Hamming/Channel, Price Channel, Median/Typical/Average Price, 52주 고가·저가, Standard Error · Standard Error Bands, Linear Regression Slope, Majority Rule, Chop Zone, Rank Correlation Index, Trend Strength Index, Accumulative Swing Index, Volatility 3종(Close-to-Close, Zero Trend, O-H-L-C)

### 그리기 도구 (있는 것 약 35 · 남은 약 45)
- 채널: Flat Top/Bottom, Disjoint Channel · 피치포크: Schiff, Modified Schiff, Inside, Pitchfan
- 피보: Speed Resistance Fan, Trend-Based Fib Time, Circles, Spiral, Speed Resistance Arcs, Wedge
- 갠: Gann Box, Gann Square, Gann Square Fixed, Gann Fan
- 패턴: Cypher, Triangle Pattern, Three Drives, 엘리엇 Triangle(ABCDE) · Double Combo(WXY) · Triple Combo(WXYXZ)
- 사이클: Time Cycles, Sine Line · 예측: Forecast, Bars Pattern, Ghost Feed, Projection
- 거래량: Fixed Range Volume Profile, Anchored Volume Profile
- 도형: Rotated Rectangle, Polyline, Arc, Curve, Double Curve, Highlighter, Arrow Marker, Arrow Mark Up/Down
- 주석: Anchored Text, Note, Price Note, Pin, Table, Comment, Signpost, Flag Mark, 이모지·스티커
- 오브젝트 트리 (그림·지표 목록, 순서·숨김·잠금), 데이터 창

### 화면 · 데이터
| wedomview | 나만의 차트 | 메모 |
|---|---|---|
| 거래소 전환 (바이비트·바이낸스·OKX·게이트) | 바이낸스 고정 | 공개 API로 가능. 거래소별 심볼 매핑 필요 |
| 상단 시세 줄 (24시간 범위·거래대금·미결제약정·펀딩 카운트다운·김프·환율) | 오른쪽 상세 패널에 일부 | 김프·환율은 업비트/환율 공개 API 필요 |
| 하단 시세 띠 (원화·USDT 주요 코인) | 없음 | 업비트 공개 API |
| 화면 분할 1~16칸 + 저장 레이아웃 + 차트 연동 | 분할 있음 | 저장 레이아웃·연동 옵션 비교 필요 |
| 워크스페이스 탭 | 없음 | |
| 관심목록 분류(레이어1·밈·AI…), 고정·주의·ST 배지 | 목록·구분선 | 분류는 코인게코 카테고리로 가능 |
| 종목 찾기 창의 미니 차트·거래소 배지 | 없음 | |
| 대량 체결 30분 타임라인 + 「5분 뒤 수익」 통계 | 대량 체결 걸러 보기만 | 다음 단계 |
| 알림 (가격·지표, 텔레그램 전송) | 없음 | 브라우저 알림은 서버 없이 가능. 텔레그램은 봇 토큰·서버 필요 |
| 뉴스 (속보 + 관련 코인 등락) | 없음 | 뉴스 출처 이용 조건 확인 필요 |
| 경제 이벤트 (예상치·확률·과거 반응 통계) | 없음 | 일정 데이터 출처 필요. 과거 반응 통계는 자체 계산 가능 |
| 스크리너 (조건 알림) | 로그 피보 스캐너 · 종목 찾기 | 방향이 다름. 새 지표 66종을 조건으로 쓰게 확장 가능 |
| 스크립트 (내 지표 작성) | 없음 | |
| 화면 테마 6종 · 오르는 색 바꾸기 · 글자 크기 | 밝게/어둡게 | |
| 차트 공유 링크 | 사진 저장 | |
| 텔레그램 로그인 · 기기 동기화 | 백업 파일 | 서버 필요 |
| 단축키 설정 창 | 고정 단축키 | |

## 권하는 순서
1. 그리기 도구 남은 45종 (피보·갠·피치포크 계열부터) + 오브젝트 트리
2. 상단 시세 줄 + 하단 시세 띠 + 김프
3. 브라우저 가격 알림 → 이후 텔레그램
4. Volume Profile, Pivot Points, 두 종목 비교 지표
5. 거래소 전환 (바이비트 → OKX)
