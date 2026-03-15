#!/bin/bash
# fetch-kline: Fetch OHLCV candlestick data from OKX
# Usage: fetch-kline <symbol> <interval> [limit]
# Example: fetch-kline BTCUSDT 1D 30

set -e

SYMBOL="${1:-BTCUSDT}"
INTERVAL="${2:-1D}"
LIMIT="${3:-100}"

# Convert common symbol formats: BTCUSDT -> BTC-USDT
INST_ID=$(echo "$SYMBOL" | sed 's/USDT$/-USDT/' | sed 's/BTC$/-BTC/' | sed 's/ETH$/-ETH/')
# If already has hyphen, leave it
if echo "$SYMBOL" | grep -q '-'; then
  INST_ID="$SYMBOL"
fi

URL="https://www.okx.com/api/v5/market/candles?instId=${INST_ID}&bar=${INTERVAL}&limit=${LIMIT}"

curl -sf "$URL" | python3 -c "
import sys, json

raw = json.load(sys.stdin)
if raw.get('code') != '0':
    print(json.dumps({'error': raw.get('msg', 'unknown error')}))
    sys.exit(1)

candles = []
for k in reversed(raw['data']):  # OKX returns newest first, reverse to chronological
    candles.append({
        'time':   int(k[0]),
        'open':   float(k[1]),
        'high':   float(k[2]),
        'low':    float(k[3]),
        'close':  float(k[4]),
        'volume': float(k[5]),
    })

print(json.dumps({
    'symbol':   '${INST_ID}',
    'interval': '${INTERVAL}',
    'count':    len(candles),
    'candles':  candles
}, indent=2))
"
