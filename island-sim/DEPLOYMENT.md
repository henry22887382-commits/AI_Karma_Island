# 部署與本機執行

本文件說明目前程式可重現的本機啟動方式與部署限制。這是維護者操作指南；目前沒有已驗證的公開遊玩服務或容器部署。

## 執行需求與依賴檢查

- Node.js **24.15.0 或更新版本**。伺服器以 Node 內建模組執行，包含 `node:sqlite`，不需要第三方 runtime 套件。
- `package.json` 沒有 `dependencies`；`typescript` 與 `@types/node` 僅列在 `devDependencies`，供型別檢查與開發使用。直接執行伺服器不必先執行 `npm install`，也不需安裝或編譯原生模組。
- Windows 啟動器另外檢查 `node_modules` 資料夾是否存在。若要使用啟動器，先在專案根目錄執行 `npm ci`；這會依鎖定檔安裝開發依賴。若要維持最少安裝，可略過啟動器，直接用 Node 執行伺服器。
- 執行時必須保留 `src/`、`references/tables/` 中伺服器載入的 CSV，以及 `src/ui/observer.css` 等 UI 檔案。不要只複製編譯輸出或移除參考資料目錄。
- Docker／其他容器映像未驗證。以下方式不代表容器化或對外部署已完成。

## Windows 本機啟動

1. 安裝 Node.js 24.15.0 或更新版本，並確認命令列可執行 `node --version`。
2. 將專案放在可寫入的本機資料夾，開啟 PowerShell 並切換到 `island-sim` 專案根目錄。
3. 使用隨附啟動器時，執行 `npm ci` 一次，以符合啟動器對 `node_modules` 目錄的檢查。
4. 執行 `.\start-island.cmd`。選單可啟動、停止或重新啟動服務；等待 5 秒會採用預設的啟動選項。啟動器會在本機 `127.0.0.1:4173` 啟動伺服器。
5. 在同一台電腦的瀏覽器開啟：
   - 觀察台：<http://127.0.0.1:4173/>
   - 內容工房：<http://127.0.0.1:4173/editor>

不使用啟動器時，在專案根目錄執行 `node --experimental-strip-types src/ui/server.ts`；這個方式不要求先安裝 npm 套件。預設只綁定 `127.0.0.1`，連接埠為 `4173`。

## 非 Windows 直接執行

在專案根目錄安裝 Node.js 24.15.0 或更新版本，然後執行：

```sh
node --experimental-strip-types src/ui/server.ts
```

不需執行 `npm install`。預設服務位址是 `http://127.0.0.1:4173/`；內容工房位於 `/editor`。目前沒有已驗證的非 Windows 啟動器或容器設定。

## 玩家教學：第一次看居民在島上生活

### 1. 先替居民選好 AI 大腦

在「建立模型卡」設定供應商、API Base URL、模型 ID 與 API 金鑰，再儲存模型卡。同一張已完成設定的卡可以分配給多位居民。部分供應商要求 API 金鑰，並可能按 API 使用量收費；ChatGPT 訂閱不包含 OpenAI API 或其他第三方 API 的使用額度，請分開查看帳務（[OpenAI 訂閱與 API 的帳務說明](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)）。

如果準備頁提示沒有可用模型卡，按「前往建立模型卡」，完成設定並儲存，再回到新局準備頁分配給每位居民。金鑰不需要放進啟動命令或專案檔案。

### 2. 選好島嶼，開始新局

1. 開啟觀察台。沒有進行中的遊戲時會看到「開始遊戲」準備頁。
2. 在「居民人數」輸入人數並按「儲存人數」。這只影響尚未開始的新局，開始後人數固定。
3. 在「本局居民模型分配」為每位居民選擇已完成設定的模型卡；同一張卡可以重複分配。
4. 展開「地圖選擇」，選擇要使用的地圖；輸入新局名稱，按「開始新局」。

居民開始自行選擇遊戲提供的行動。玩家在觀察台看牠們的生活，不直接替牠們下指令。

### 3. 逛逛觀察台

- **世界地圖**：看島嶼地點、連線與居民分布；點選居民可以查看狀態、裝備和背包。
- **居民觀察**：選一位居民，回看牠最近的想法與行動結果。
- **事件時間線**：依發生順序翻看已結算事件，也可以篩選居民。
- **死亡總結**：回讀已離世居民的一生，看看牠們如何走到最後。
- **暫停／恢復**：使用頁面上方的模擬控制區暫停或繼續觀察。

居民的想法、對話和事件，會在這幾個畫面留下線索；不必從第一條紀錄開始翻，先挑一位居民或最近的事件看看就好。

### 4. 存檔，改天再回島上

在「目前遊戲」區輸入存檔名稱，按「存檔」。要接著玩時，從清單選擇存檔並按「載入存檔」；載入後模擬會自動恢復。**結束當局前請先手動存檔**，因為「結束當局」不會替你建立一份可載入的遊戲存檔。

### 5. 熟悉觀察台後，再動手改造世界

內容工房位於 `/editor`，包含「文本編輯」、「地圖／Node 設定」和「存檔管理」。可以先改寫一段漂流瓶或告示牌，再觀察居民會不會讀到、會不會把它當真。

**漂流瓶小實驗：**在「文本編輯」修改或新增文本卡，按「套用文本卡」把變更放進本頁編輯資料；接著切到「地圖／Node 設定」。若想保留原來的地圖，按「另存新地圖」並輸入名稱來建立副本；接著按「儲存地圖存檔」。只按「套用文本卡」還沒有寫入；完成地圖存檔才會保存已套用的文本和地圖設定。開新局時選取這張地圖，再到事件時間線查看居民是否閱讀、後續做了什麼。

「新局出生點」和「新局初始營火」等地圖設定，只會用於選取該地圖 Profile 開的新局，不會改動正在進行或已保存的舊遊戲。地圖 Profile 保存地形、位置、連線和告示綁定；文本卡內容存在所有地圖共用的文本庫，因此改動一張已在其他地圖使用的卡，也會改變那些地圖讀到的文字。想保留原文時，先新增一張文本卡再編輯。套用後再次按「儲存地圖存檔」，才會寫入變更。

## 介面導覽

觀察台主要分頁如下：

| 分頁 | 用途 |
| --- | --- |
| 世界地圖 | 觀察島嶼地圖、居民位置與島上現況 |
| 居民觀察 | 搜尋居民並查看狀態、意圖及個人行動紀錄 |
| 事件時間線 | 依時間回看已結算事件，可切換事件範圍及翻頁 |
| 建立模型卡 | 管理供居民使用的模型連線與模型卡設定 |
| 死亡總結 | 閱讀已死亡居民的 AI 生命總結 |
| 錯誤紀錄 | 查看模擬或模型呼叫過程留下的錯誤資訊 |

內容工房可建立模型卡、設定死亡總結模型卡、編輯共用文本和地圖 Profile，也能在「存檔管理」查看或刪除指定存檔。模型卡設定完成並儲存後，才會出現在新局分配清單。

## 網址與環境變數

伺服器支援以下環境變數：

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `ISLAND_HOST` | `127.0.0.1` | 綁定的網路介面 |
| `ISLAND_PORT` | `4173` | HTTP 連接埠 |
| `ISLAND_DB_PATH` | `./data/island.sqlite` | 世界、遊戲局與存檔資料庫 |
| `ISLAND_SETTINGS_DB_PATH` | `./data/model-settings.sqlite` | 模型設定與 API 金鑰資料庫 |

資料庫相對路徑以啟動時的工作目錄為準。正式維護時可為兩個資料庫指定明確路徑，並將其所在資料夾掛載到持久磁碟。定期備份兩個資料庫；模型設定資料庫包含 API 金鑰，備份應限制存取並妥善保護。備份前建議先停止服務，避免備份期間資料仍在寫入。

PowerShell 範例（路徑請換成實際的持久資料位置）：

```powershell
$env:ISLAND_HOST = '127.0.0.1'
$env:ISLAND_PORT = '4173'
$env:ISLAND_DB_PATH = 'D:\IslandData\island.sqlite'
$env:ISLAND_SETTINGS_DB_PATH = 'D:\IslandData\model-settings.sqlite'
node --experimental-strip-types src/ui/server.ts
```

Linux／macOS shell 範例：

```sh
ISLAND_HOST=127.0.0.1 ISLAND_PORT=4173 \
ISLAND_DB_PATH=/var/lib/island-sim/island.sqlite \
ISLAND_SETTINGS_DB_PATH=/var/lib/island-sim/model-settings.sqlite \
node --experimental-strip-types src/ui/server.ts
```

## API 金鑰設定

啟動後在「建立模型卡」中新增模型卡，填入所選供應商、API Base URL、模型 ID 和 API 金鑰，然後按「儲存槽位」。模型設定與金鑰保存在 `ISLAND_SETTINGS_DB_PATH` 指向的 SQLite 資料庫；頁面不會回顯已保存的金鑰。不要把金鑰寫進命令列範例、版控檔案或公開 issue；變更資料庫路徑時，也要一併保留或遷移這個資料庫。

模型供應商可能依 API 使用量計費，實際費率、免費額度與帳單由供應商決定。ChatGPT 訂閱與 OpenAI API、OpenRouter 或其他第三方 API 的額度和帳單彼此分開；開始模擬前，先確認模型供應商的收費方式與用量限制。使用 OpenAI API 可由[官方 API Keys 頁面](https://platform.openai.com/api-keys)建立金鑰；OpenRouter 使用者可參考[官方 Quickstart 教學](https://openrouter.ai/docs/quickstart)及[API Keys 頁面](https://openrouter.ai/settings/keys)。這裡不提供跨供應商的固定價格估算。

OpenRouter 使用者可參考[官方 Quickstart 教學](https://openrouter.ai/docs/quickstart)建立 API 金鑰、查詢模型 ID 並確認 API 用法；建立金鑰請到 [OpenRouter API Keys](https://openrouter.ai/settings/keys)。在本專案模型卡中，OpenRouter 的 API Base URL 填 `https://openrouter.ai/api/v1`。請將金鑰直接填入內容工房，不要貼到公開貼文或版控檔案。

## 停止與重新啟動

停止服務前，先在觀察台使用存檔功能保存目前遊戲。Windows 使用同一個 `start-island.cmd` 啟動與停止：重新開啟它，在選單出現時按 `2` 停止服務。選單 5 秒後預設啟動，因此請在倒數結束前按下 `2`。成功後視窗會等待按鍵再關閉。

若你需要在 PowerShell 手動停止，也可在 `island-sim` 專案目錄執行：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\island-launcher.ps1 -Action Stop
```

同一選單的 `3` 是重新啟動。啟動器會核對專案管理紀錄或伺服器程序身分；若無法確認連接埠上的程序屬於本專案，會拒絕終止並回報錯誤。直接執行 Node 時，請在執行伺服器的終端機按 `Ctrl+C` 停止，再重新執行啟動命令。
