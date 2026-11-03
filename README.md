# 나만의 차트

트레이딩뷰처럼 쓰는 개인용 차트·스캐너입니다. 바이낸스 USDT-M 선물(크립토·TradFi), 바이낸스 현물, 달러 장기 시세(CRYPTO:BTCUSD, Bitstamp 2011년~)는 홈페이지에서 바로 보고, SI1!·미국·한국 주식·지수는 내 PC에서 작은 서버(`chart_server.py`)를 켜 두면 함께 볼 수 있습니다.

- **차트**: 1분~12달, 로그 스케일, 지표(거래량, MA·EMA, 볼린저, Nadaraya-Watson Envelope, TD Sequential, WaveTrend, RSI, MACD, 자동 로그 피보, 겹침 구간), 그리기 20여 종(추세선·평행 채널·로그 피보 되돌림·피보 확장·피보 채널·피보 타임존·피치포크·롱/숏 포지션·날짜/가격 범위·붓 등, 아래 지표 패널에도), 오른쪽 클릭 메뉴, 되돌리기, 관심목록(트레이딩뷰 목록 가져오기)
- **스캐너**: 로그 피보 레벨 × 장기 이평 × NWE × TD × WaveTrend 겹침
- **종목 찾기**: 시가총액, 거래대금, 거래량 급증, 꾸준한 상승, 인기·트렌딩, 상승률

## 쓰는 법

1. 홈페이지를 엽니다. 코인은 설치 없이 됩니다.
2. 주식·선물이 필요하면 이 저장소를 zip으로 받아 압축을 풀고 `start_chart.bat`(맥: `start_chart.command`)을 실행합니다. 파이썬이 필요합니다.
3. 홈페이지 상단 ⋯ → 「PC 서버 연결」 → 「연결」. 크롬이 접근 허용을 물으면 허용합니다.

자세한 내용은 `README.txt`를 보세요.

## 데이터와 이용 조건

- 바이낸스 공개 API: 브라우저에서 직접 요청합니다. API 키를 쓰지 않으며 주문 기능은 없습니다.
- Bitstamp·Bybit 공개 API: 달러 장기 시세(2011년~)와 4시간봉 이상 OI 과거(2020년~). 키 없이 브라우저에서 직접 요청합니다.
- 「TV 원본」 탭: 트레이딩뷰 무료 Advanced Chart 위젯을 그대로 띄웁니다.
- 야후 파이낸스(yfinance): 내 PC 서버가 받아 옵니다. 개인 용도로만 쓰세요.
- 코인게코 무료 API: 크립토 시가총액·트렌딩 (Data provided by [CoinGecko](https://www.coingecko.com/)).
- 차트 엔진: [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0).
- Nadaraya-Watson Envelope 계산은 LuxAlgo의 원본 스크립트(CC BY-NC-SA 4.0)를 옮긴 것으로, 이 부분은 같은 조건(비상업, 출처 표시, 동일 조건 변경 허락)을 따릅니다.
- WaveTrend 계산은 LazyBear의 WT_CROSS_LB 공식을 따릅니다.

투자 판단을 돕는 개인 도구이며 수익을 보장하지 않습니다.
