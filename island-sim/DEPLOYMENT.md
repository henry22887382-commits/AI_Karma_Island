# 部署與本機執行

本文件說明目前程式可重現的本機啟動方式與部署限制。這是維護者操作指南；目前沒有已驗證的公開遊玩服務或容器部署。

## 執行需求與依賴檢查

- Node.js **24.15.0 或更新版本**。伺服器以 Node 內建模組執行，包含 `node:sqlite`，不需要第三方 runtime 套件。
- `package.json` 沒有 `dependencies`；`typescript` 與 `@types/node` 僅列在 `devDependencies`，供型別檢查與開發使用。直接執行伺服器不必先執行 `npm install`。
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

啟動後開啟內容工房，在模型設定中建立模型卡並填入供應商、API Base URL、模型與 API 金鑰。設定與金鑰保存在 `ISLAND_SETTINGS_DB_PATH` 指向的 SQLite 資料庫。不要把金鑰寫進命令列範例、版控檔案或公開 issue；變更資料庫路徑時，也要一併保留或遷移這個資料庫。

## 停止與重新啟動

Windows 使用 `start-island.cmd`：選 **2** 停止由本啟動器確認管理的服務，選 **3** 重新啟動。直接執行 Node 時，請在執行伺服器的終端機按 `Ctrl+C` 停止，再重新執行啟動命令。

## 網路暴露與尚未驗證事項

目前觀察台、內容工房及相關寫入、控制、設定 API 路由沒有認證。預設綁定 `127.0.0.1`，只供本機使用。**不要把服務直接暴露到網際網路，也不要把 `ISLAND_HOST` 設為 `0.0.0.0` 後放在不受控網路上。** 受控內網使用仍須由管理者評估網路隔離與存取範圍；公開服務前，必須先加入並驗證認證、權限控管、CSRF 防護等安全措施。

Docker／容器化尚未測試。本環境的完整 `npm test` 未通過：有 loopback 權限錯誤（`EACCES`）及其他斷言失敗；因此不能據此宣稱完整測試、容器部署或對外部署成功。此文件僅記錄本機執行路徑與目前已知限制。
