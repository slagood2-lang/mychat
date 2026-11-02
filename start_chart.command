#!/bin/bash
# 맥: 이 파일을 더블클릭 (처음에 막히면 우클릭 → 열기)
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3가 없습니다. https://www.python.org/downloads/ 에서 설치하세요."
  read -r -p "엔터를 누르면 닫힙니다"; exit 1
fi
python3 -c "import yfinance" 2>/dev/null || { echo "yfinance 설치 중 (처음 한 번만)"; python3 -m pip install --user --upgrade yfinance; }
[ "$1" = "update" ] && python3 -m pip install --user --upgrade yfinance
echo "브라우저가 열리지 않으면 http://localhost:8000 을 여세요. 이 창을 닫으면 서버가 꺼집니다."
python3 chart_server.py
