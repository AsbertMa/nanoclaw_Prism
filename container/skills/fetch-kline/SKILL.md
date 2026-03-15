---
name: fetch-kline
description: Fetch OHLCV candlestick (K-line) data from OKX. Use whenever you need price history for technical analysis, trend identification, or market structure review.
allowed-tools: Bash(fetch-kline)
---

# K-Line Data (OKX)

## Usage

```bash
fetch-kline <symbol> <interval> [limit]
```

- `symbol`: Trading pair — `BTCUSDT` or `BTC-USDT` (both work)
- `interval`: `1m` `5m` `15m` `1H` `4H` `1D` `1W` `1M`
- `limit`: Number of candles (default 100, max 300)

## Examples

```bash
fetch-kline BTCUSDT 1D 30      # BTC daily, last 30 days
fetch-kline BTCUSDT 4H 100     # BTC 4h, last 100 bars
fetch-kline ETHUSDT 1W 52      # ETH weekly, last year
fetch-kline BTC-USDT 1D 90     # BTC daily, last 90 days
```

## Output

Returns JSON in chronological order (oldest first):

```json
{
  "symbol": "BTC-USDT",
  "interval": "1D",
  "count": 30,
  "candles": [
    {
      "time": 1700000000000,
      "open": 37000.0,
      "high": 38500.0,
      "low": 36800.0,
      "close": 38200.0,
      "volume": 12345.6
    }
  ]
}
```

## Tips

- For daily analysis, fetch 60-90 days minimum
- For weekly analysis, fetch 52+ weeks
- For multi-timeframe analysis, call multiple times with different intervals
- The last candle in the array is the most recent
