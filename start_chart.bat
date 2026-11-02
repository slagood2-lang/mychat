@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 나만의 차트 서버
set PY=
python --version >nul 2>nul && set PY=python
if not defined PY py --version >nul 2>nul && set PY=py
if not defined PY (
  echo.
  echo [안내] 파이썬이 설치되어 있지 않습니다.
  echo https://www.python.org/downloads/ 에서 설치하세요.
  echo 설치 첫 화면에서 "Add python.exe to PATH" 를 꼭 체크하세요.
  echo 바이낸스 종목만 볼 거라면 index.html 을 크롬으로 바로 열어도 됩니다.
  pause
  exit /b 1
)
%PY% -c "import yfinance" 2>nul || (
  echo yfinance 설치 중... 처음 한 번만 1~2분 걸립니다.
  %PY% -m pip install --upgrade yfinance
)
if /i "%1"=="update" %PY% -m pip install --upgrade yfinance
echo.
echo 브라우저가 열리지 않으면 주소창에 http://localhost:8000 을 입력하세요.
echo 이 창을 닫으면 서버가 꺼집니다.
echo.
%PY% chart_server.py
pause
