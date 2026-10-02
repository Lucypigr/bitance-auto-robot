# QuantLab — 幣安量化回測平台

使用 JavaScript / Node.js 24 建立的繁體中文研究平台，支援幣安現貨與 USDⓈ-M 永續合約。包含公開行情、技術指標、自訂規則、多幣種回測、樣本外策略比較及詳細報告。**不會下單。**

## 啟動

```bash
npm ci --cache .cache/npm
npm start
```

預設連接埠 `3000`，`HOST=0.0.0.0`。可用 `PORT=3001 npm start` 更換。`npm run dev` 提供 Node 檔案監看。原生 ES modules，無前端建置步驟、無執行期套件依賴；`@playwright/test` 僅供開發測試。

## GitHub Pages 靜態版

```bash
npm run build:pages
npm run test:pages
```

`docs/` 是可由 GitHub Pages 託管的完整靜態網站。`.github/workflows/pages.yml` 在 `main` 分支更新時重新建置、執行測試並部署。Pages 啟用來源為 GitHub Actions；正式頁面以該工作流程的 deployment URL 為準。靜態版使用相對路徑，可在儲存庫子路徑運作，並從瀏覽器直接向幣安公開 API 與 WebSocket 讀取資料；不會呼叫此儲存庫的 Node API。無法連線時清楚顯示錯誤，示範資料仍可離線使用。真實行情是否可用，取決於訪客所在地與瀏覽器對幣安網域的存取。GitHub Pages 不支援 Node 後端、伺服器 SSE 轉送或自動交易；此版本沒有下單功能。

先使用明確標示的「合成示範資料」操作，再於資料來源選擇「幣安公開行情」。示範序列可重現，不代表真實幣價或可投資績效。UTC 日期的結束日不包含當日，且只採已收盤 K 線。

## 已提供的功能

- **行情**：現貨目前所有 `TRADING` 交易對；USDⓈ-M 中 USDT／USDC 永續合約。搜尋交易對、報價幣篩選、分頁、最新價、24h 漲跌、高低與成交額。伺服器共用 WebSocket 經 SSE 逐次轉送至瀏覽器，失敗時每 15 秒 REST 輪詢。幣種清單為 API 即時載入，沒有硬編碼限制真實清單。
- **歷史資料**：K 線自動分頁、額外 220 根暖機、時間缺口檢查、僅保留已收盤資料、有限快取、全域請求排隊、429／5xx 有限重試。API 失敗時明確報錯，不會偷偷換成示範資料。
- **指標**：SMA、EMA、Wilder RSI、MACD / Signal / Histogram、Bollinger Bands / Width、ATR、ADX / ±DI、Stochastic K/D、CCI、Williams %R、ROC、OBV / MA、UTC 日內 VWAP、MFI、Volume / MA、Donchian、Keltner、Supertrend。共 37 個可引用的數值輸出（包含價格和成交量）。預設週期列於介面與 `src/indicators.js`。
- **策略**：趨勢共振、RSI 回歸、布林反轉、Donchian 突破、MACD 動能、Stochastic 反轉、Supertrend、Keltner 突破、VWAP 量價、CCI / MFI 反轉。可比較 24 組策略／門檻參數；不是窮舉全部可能參數。
- **自訂規則**：做多進出場與做空進出場四組；每組至多 8 條 AND 規則。比較 `>`、`<`、上穿、下穿，右側可用常數或指標代碼。不執行使用者輸入的程式碼。
- **執行模型**：收盤訊號、下一根開盤成交，雙邊手續費、雙邊不利滑價、投入比例、停損、停利、移動停損、期末平倉。
- **合約模型**：做多／做空、1–10 倍槓桿、逐倉、歷史資金費率、標記價格淨值與清算估計。**不包含 COIN-M、交割合約、全倉、ADL 或交易所精確分級維持保證金。**
- **多幣種**：最多 6 個相同報價幣的交易對；資金等額分配至獨立帳戶，保留共同完整期間，不再平衡。提供每幣種與整體結果。
- **驗證**：70% 訓練／30% 保留；排名只使用訓練結果。另有固定 50% 訓練窗、三折滾動驗證，每折重新選擇策略和參數。
- **報表**：淨值及買入持有基準、回撤圖、淨利、CAGR、Sharpe、Sortino、Calmar、勝率、獲利因子、期望值、平均盈虧、連敗、持倉時間、曝險、費用、資金費率、清算次數、逐筆交易、月度報酬、指標快照。
- **研究保存**：瀏覽器本機設定、交易 CSV、完整 JSON 報告（含原始 K 線與資金費率），可離線重播。計算使用 Web Worker，可以取消。

## 真實行情的網路需求

公開資料不需要 Binance API key，也不需要交易帳戶。

| 網域 | 用途 |
| --- | --- |
| `data-api.binance.vision` | 現貨 exchangeInfo、ticker、klines |
| `data-stream.binance.vision` | 現貨 WebSocket miniTicker |
| `fapi.binance.com` | USDⓈ-M exchangeInfo、ticker、klines、markPriceKlines、fundingRate |
| `fstream.binance.com` | USDⓈ-M WebSocket miniTicker |

Node 啟動使用 `--use-env-proxy`，遵循環境已有 HTTPS 代理及憑證設定，不關閉 TLS 驗證。如果雲端政策阻擋這些網域，請在環境設定套用允許網域。平台無法繞過幣安所在地服務限制。設定草稿儲存不代表執行中網路已更新。

當前雲端實測：現貨 API 已取得 1,372 個可交易交易對，現貨 WebSocket → SSE → 瀏覽器即時報價已驗證，並完成 BTCUSDT 最近 90 天、1 小時 K 線（2,380 根，含暖機）、24 組候選、三折滾動回測與離線重播。合約 API 回傳 HTTP 451，受服務地區限制，真實合約資料尚未驗證。合約標記價格、資金費率與多空模型有固定資料和瀏覽器測試；需要在幣安支援的環境驗證真實合約連線。交易對數量會隨幣安清單變動。

## 回測模型細節

1. 所有指標僅讀取目前或更早資料。至少 200 根暖機後才交易。Donchian 通道排除當根，避免突破邏輯偷看本根高低。
2. 每個交易對最多一個部位，現貨只做多；合約可以做空。訊號出場當根不反手；多空進場同時成立則不開倉。每段驗證由空倉與指定起始資金開始。
3. 投入比例以每個獨立帳戶資金計算，預留入場費。合約名目部位由保證金 × 槓桿決定。損益、費用與資金費率逐筆入帳。
4. 跳空停損使用開盤價。當根同時碰停損與停利時採停損。合約同時觸及清算與其他門檻時保守地先清算。OHLC 無法確認根內真實事件順序。
5. 移動停損只用已完成收盤更新，下一根生效。回測最後一根收盤強制平倉，並扣除成本。
6. 合約資金費率按持有至該事件 K 線開盤前的部位計算，正值由多方支付、空方收取，使用事件提供的標記價格。毫秒級時間差歸於該根開盤。為減少事件順序歧義，合約限 `5m / 15m / 1h`，不提供大週期合約回測。
7. 固定維持保證金率與預估平倉費決定清算門檻；清算時保守地沒收剩餘逐倉保證金，不動用未配置資金。這是研究估算，並非完整複製幣安強平引擎。清算沒收金額計入損益，非一般交易手續費。
8. 現貨支援 `5m / 15m / 1h / 4h / 1d`。每個交易對上限 50,000 根研究 K 線，多幣種合計上限 100,000 根（另加暖機），最低共同研究期間 100 根。新上市或歷史較短的資產會縮短共同有效期間，介面會提示。
9. 策略排名分數為 `train.sharpe - abs(train.maxDrawdown) / 25 + min(train.trades, 30) / 100`。少於 3 筆、無有效 Sharpe 或發生清算的候選降級。候選只在訓練期比較，最高分不等於最高未來報酬。
10. 三折滾動驗證採固定 50% 的訓練窗，每折向前移動約六分之一總期間，獨立測試下一段，各折重新配置起始資金。不可將各折百分比直接相加；它們和 70/30 保留期間有重疊。
11. Sharpe 使用 UTC 日末淨值日報酬樣本標準差，Sortino 使用負日報酬平方均值之平方根，無風險利率設零，一年 365 天；不足 7 個日樣本顯示無資料。首末日可能不完整。CAGR 不足 30 天不計算。
12. 基準是相同成本的 1 倍買入持有價格報酬；合約模式下基準仍不含槓桿或資金費率，避免混淆風險。

**限制**：目前交易對清單有倖存者偏誤；未包含下架資產宇宙、逐筆／委託簿成交、成交量限制、交易所最小下單量和精度、稅費。重複研究同一樣本外資料會造成資料探勘偏誤。合成資料績效不能作為投資建議，真實歷史績效也不保證未來獲利。

## 測試與重播

```bash
npm test
npm run test:e2e
npm run replay -- /path/to/quantlab-report.json
```

瀏覽器測試優先使用 `/usr/bin/chromium`，可設定 `CHROMIUM_PATH`。本機未安裝 Chromium 時，可執行 `npx playwright install chromium` 使用 Playwright 瀏覽器。雲端現有 Chromium 已實測可用。

測試涵蓋：參考 RSI 數值、指標因果性、通道不偷看、VWAP 日切、下一根開盤成交、雙邊成本、跳空、停損停利優先順序、合約做空、資金費率、標記價格清算、投資組合對帳、保留資料不影響訓練、歷史資料分頁、HTTP 輸入驗證、瀏覽器現貨／合約／自訂／多幣種、行情失敗呈現、CSV／JSON 匯出與手機版。

離線重播使用報告內原始資料和設定，輸出策略、樣本外報酬與是否符合已存結果；不需要網路。成功相符退出碼 0，不相符 2，格式錯誤 1。

## 程式結構

```text
src/server.js        原生 Node HTTP、靜態資源、安全標頭、API
src/stream.js        共用 WebSocket 連線、SSE 轉送與斷線重連
src/binance.js       公開行情、分頁、限速、重試、資料驗證
src/indicators.js    指標公式與可引用代碼
src/strategies.js    策略目錄、規則引擎、候選參數
src/backtest.js      現貨／合約執行模型、風控、績效、樣本外／滾動驗證
src/demo.js          明確標示的可重現合成資料
public/              繁體中文介面、SVG 圖表、Web Worker
scripts/replay.js    離線報告重播
tests/              單元、API 和 Playwright 瀏覽器測試
```

新增指標：在 `computeIndicators` 與 `indicatorCatalog` 註冊同長度序列；暖機不足輸出 `null`。新增策略：於 `strategyCatalog` 和 `signalAt` 註冊；務必保留下一根成交及樣本外選擇的隔離。

API：`GET /api/health`、`GET /api/stream?market=spot|futures`（SSE）、`GET /api/markets?market=spot|futures&demo=0|1`、`GET /api/history?market=spot&symbol=BTCUSDT&interval=1h&start=<UTC毫秒>&end=<UTC毫秒>&demo=0|1`。`end` 為排他界線。API 只接受公開市場查詢，沒有下單或帳戶端點。
