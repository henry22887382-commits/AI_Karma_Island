# Cookie Execution Log｜輪迴島

## 授權與範圍

- **使用者原文：** 「執行cookie」
- **日期：** 2026-10-20（Asia/Taipei）
- **記錄位置：** `DESIGN_DECISIONS.md` D-001；`PROJECT_BRANDING.md` 狀態欄已反映執行授權。
- **授權範圍：** 依現有 `PROJECT_BRANDING.md` 執行 7 Bags／17 Cookies；不因此核准 D-002–D-012、Reference 中的 TBD 或新增產品規則。
- **執行原則：** 依依賴啟動工作；明確來源值可實作。未知值只限制其最小受影響 Crumb/Cookie。每個 Bag 開始前須有 Bag Review。工程代理聲稱不等同 DONE；DONE 需逐條 Crumb 對應可查的實作與驗證證據。

## 執行前 Review 與依賴

- Bag Review 見 [BAG_REVIEWS.md](BAG_REVIEWS.md)。本輪審查 Bag 1、2、3、5；Bag 4、6、7 須在實際開始前依其依賴另做 Bag Review。
- 依賴圖存在 Bag 1–5 循環；執行時以純 domain handler/reducer/store adapter 分層，避免跨包直接互相依賴。工程介面草案見 `BAG_REVIEWS.md`，仍須以實際程式及呼叫路徑證實。
- D-002 繼續待正式外部 schema 決策；內部可逆 versioned 存取結構只作執行細節，不升格成正式契約。
- 目前需使用者決定的時鐘問題限於 Bag 1.1 的 WAIT 可選時長。夜間風險條件／錨點／3T間隔與睡眠僅夜間至天亮均已裁定；沒有獨立全域固定8次風險。
- **夜間風險裁定（2026-10-20）：** 使用者更正原文「我講錯 我是指常規觸發外 只在不安全區域稅著觸發 3T一次 參考進入區域判定時點 美人判定分開」，再補充「沒有這項 8來自24/3 指的是睡著時會有共8次判定」，並明示「安全處睡眠不觸發」。現行沒有獨立全域固定8次；安全區睡眠不觸發額外睡眠風險；不安全區睡眠額外風險只對該處睡眠居民逐人每3T判定，以各人進入區域判定時點為錨，睡滿24T共8次；一般進區／探索觸發保留。此前由 ZIP／計畫解讀出的global 8 routine已撤回，不以舊判讀反駁使用者最新決定。
- **睡眠裁定（2026-10-20）：** 使用者原文「晚上才能睡覺 睡到天亮」。SLEEP 僅夜間可用並持續至天亮；睡眠遭攻擊時先結算傷害及死亡，存活才驚醒；此項不決定一般 WAIT 時長，C-10仍待核。
- **D-013 同SPD（2026-10-20）：** 使用者原文「同速度比生命 食物 睡眠 攻擊 防禦 空格子 最後抽速」，答覆「1 空格子按多(消歧異)」；正式順序HP、飽食、睡眠資源、攻擊、防禦、背包空格數依序降序，全同才按記錄seed抽籤。
- **D-014/C-15（2026-10-20）：** 使用者答「1 要」；正數 `.5` 四捨五入進位。語義已定，跨語言實作與測試待驗。
- **D-015出生點（2026-10-20）：** 使用者授權「2請自訂義 共三個 不相鄰 隨機 不沿用」；依此選來源沙灘 Node 1/8/13，居民／新世代依記錄seed重抽、不沿用前代。這是出生點設定，與D-020使用者採用的椰子Node 1/8/13（初始0、每日+1、上限3）分開；後者不宣稱由地圖直接標定。
- **D-016模型設定（2026-10-20）：** 使用者「留可用空位 操作設定在前台」；記錄前台10個可留空provider/model/fallback/價格/API key槽，不預選live AI；key僅server記憶體，不進WorldState。
- **D-017 UI（2026-10-20）：** 使用者「作成切換式頁面 藉此將資訊壓縮在單一視窗 格子和字體動態調整試試看」；記錄單窗切換頁面及動態格子／字體原型，UI與browser驗收待證。
- **D-018 屍體搬運成本（2026-10-20）：** 使用者採用每拿一件屍體物品1T、搬起1T、放下1T；攜屍跨Node仍以原移動3T處理，不另加搬運時間。工程整合與逐Crumb驗收仍待證。
- **D-019 森林進區事件（2026-10-20）：** 使用者給定白天進區事件15%、負面占35%（總負面5.25%）；夜晚事件25%、負面占70%（總負面17.5%）。僅進入原本沒有其他島民的Node時判定；夜間調整同一事件池的負面比例，不額外roll。主動野莓採集90/10另成一池，Reference早期80/20保留為歷史差異。
- **D-020 互動點位置核對（2026-10-20）：** 使用者明確採用魚站2/10/14、椰子1/8/13（初始0、每日+1、上限3）、森林9/17/23、岩石6/19/22、河流24作執行設定。原圖crosswalk確認28 Node／51邊、火山／營地／港口；森林／石堆／河流Node來自Reference分組序列對應，CSV標記提醒不可說成原圖逐點文字標名；釣魚與椰子Node是使用者採用設定，不偽稱為地圖直接標定。按既有使用者授權執行，並在來源欄保留此區別。
- **非野外區域夜間睡眠風險（2026-10-20）：** 使用者早前要求非野外負面總觸發比例依森林基準相等。以森林夜間總負面率17.5%為基準，非野外夜間睡眠保留各負面結果相對權重`w_i`，並按`P_i=0.175*w_i/sum(w_negative)`等比例正規化；僅用於非野外睡眠場景，不更改一般進區事件表。睡眠負面項或效果值無有效來源時，該場景維持待處理，不補假值。
- **最新工程驗證（implement_foundation，2026-10-20；時間未提供）：** 工作目錄 `D:\Henry\Documents\AI-land\island-sim`。代理直接回報：`npm run check` exit 0，typecheck通過、141/141 tests通過；`npm run typecheck -- --pretty false` exit 0；定向命令 `node --experimental-strip-types --test src/engine/night-risk.test.ts src/engine/simulation.test.ts` 為26/26。睡眠相關覆蓋包括unsafe entry-anchor、每3T／每夜最多8次、共用風險表、安全區不觸發、效果與死亡結算、缺表gate並讓排程繼續。本記錄代理未重跑，且此為該程式版本snapshot，不視為後續程式或Cookie整合持續通過；原先80/80報告保留為更早歷史。Bag 3 runtime dispatcher及surface/dungeon/social dispatcher、完整AI行動閉環、死亡／世代生命週期仍未完成，測試通過不等於完整Cookie DONE。
- **較早工程證據摘要（implement_foundation，2026-10-20；80-test快照）：** 在 `D:\Henry\Documents\AI-land\island-sim` 執行 `npm run check`，回報 exit 0；`tsc --noEmit` pass，`node --experimental-strip-types --test src/**/*.test.ts` 為80 tests / 80 pass / 0 fail。列明 `src/engine/clock.ts`／`clock.test.ts`（72T日、48白+24夜）、`src/domain/combat.ts`／`combat.test.ts`（C-15使用`Math.round(HP/10 + equipment modifier)`，5/15/25半數測例）、`src/engine/tie-break.ts`／`tie-break.test.ts`（六欄降序、完全同值seed抽籤）、`simulation.ts`、`world.ts`／`world.test.ts`（Node1/8/13 beach點、seeded draws）、`simulation.test.ts`（磁碟SQLite關閉重開後snapshot seq/RNG、event draws與replay一致）。該快照曾記sleep逐人3T entry-anchor、T48–72含T72最後一次且無global timer，並稱risk outcome因來源機率欄空而unresolved；此風險狀態已由後續使用者規則和141-test工程報告更新。Bag 3 monsters/dungeon仍是純helper且runtime dispatcher integration pending；death/next-generation lifecycle亦未完成。此為工程代理歷史報告，未由本記錄代理重跑；80/80不代表完整17 Cookie DONE。
- **執行環境邊界（root，2026-10-20）：** host `127.0.0.1:4173` 與 API 200 為DB端回報；browser驗收及完整runtime尚未證明。除非另附瀏覽器／runtime證據，不把HTTP成功當作UI Crumb通過。

## Cookie 狀態與證據

狀態只採用 skill 定義的 DONE、BLOCKED、ROTTEN、FAILED。尚未完成驗證的 Cookie 不標 DONE；若尚未遇到必要缺失資源/資訊而無法繼續，不以 BLOCKED 代替一般待辦。


| Cookie | 執行概況（非結果狀態） | 已取得的完成證據 | 未完成／待核 |
|---|---|---|---|
| 1.1 | 未宣告 DONE | 工程代理直接回報 `npm run check` exit 0、typecheck通過、141/141；`npm run typecheck -- --pretty false` exit 0；定向 `node --experimental-strip-types --test src/engine/night-risk.test.ts src/engine/simulation.test.ts` 26/26，含entry-anchor、3T/max8、安全區零觸發及缺表gate | WAIT時長未決；沒有完整Cookie Crumb／跨包runtime驗收；sleep未定項仍按缺表gate，不補來源缺值；本記錄代理未重跑命令 |
| 1.2 | 未宣告 DONE | Bag Review界定原子結算；`simulation.test.ts`報告真磁碟close/reopen及snapshot/event/RNG replay測例通過 | Cookie完整原子結算與各領域dispatcher整合仍未驗收 |
| 2.1 | 未宣告 DONE | ZIP圖文crosswalk回報28 Node／51邊；森林9/17/23、石堆6/19/22、河流24為分組順序對應；使用者採用魚站2/10/14、椰子1/8/13執行設定 | 未逐點文字標名需保留來源層級；魚站與椰子座標依使用者採用設定，不稱Reference地圖直標；無完成工程／Cookie驗收 |
| 2.2 | 未宣告 DONE | Bag Review 分離已知生命週期與待決欄位 | C-11/C-16 待核；無程式／驗收證據 |
| 2.3 | 未宣告 DONE | 使用者指定森林進區事件：日15%×負面35%=5.25%；夜25%×負面70%=17.5%；主動野莓90/10另池；屍體成本D-018與D-020互動點來源狀態有紀錄 | 缺失睡眠負面事件項／效果仍按gate；尚無逐Crumb程式／Cookie驗收證據 |
| 3.1 | 未宣告 DONE | 工程代理先前報告 `src/domain/combat.ts`／`combat.test.ts` 有C-15 `Math.round(HP/10 + equipment modifier)`及半數案例5/15/25；屬較早80/80測試快照 | Cookie全Crumb與跨語言驗收未完成；D-009細節缺值 |
| 3.2 | 未宣告 DONE | 工程代理報告 monsters helper純函數已實作並有coverage | runtime dispatcher整合pending；D-009部分缺值；Cookie全Crumb驗收未提供 |
| 3.3 | 未宣告 DONE | 工程代理報告 dungeon helper純函數已實作並有coverage | runtime dispatcher整合pending；D-005–D-007未決；Cookie全Crumb驗收未提供 |
| 4.1 | 可開發獨立模組；尚無 Cookie 結果 | — | Bag 1–3 合法動作／結算與 Bag 5 查詢契約尚無實作輸出；跨 Bag 驗證待依賴到位 |
| 4.2 | 可開發明確範圍；尚無 Cookie 結果 | — | Bag 1/5 排程與事件契約尚無實作輸出；D-008 可見半徑未決，只影響跨 Node 顯示 |
| 4.3 | 可開發已知計數契約；尚無 Cookie 結果 | D-016前台模型設定槽方向已定 | Bag 1/5呼叫／紀錄與設定UI實作需證據；具體模型／價格未設定；fallback及成本Crumbs未驗 |
| 5.1 | 未宣告 DONE | Bag Review 允許內部版本化 store scaffolding | 重啟、重播及事件生命週期無證據；D-002 外部 schema 待核 |
| 5.2 | 未宣告 DONE | Bag Review 核對資料權限界線 | C-14 細節未決；無實作／權限驗收證據 |
| 6.1 | 可開發獨立 UI 模組；尚無 Cookie 結果 | — | Bag 2 地圖與 Bag 5 權限化查詢尚無實作輸出；跨 Bag 驗證待依賴到位 |
| 6.2 | 可開發獨立 UI 模組；尚無 Cookie 結果 | D-017單窗切換頁面、動態格子／字體方向已定；D-016十個可留空模型槽已定 | Bag 1/5接線、完整UI及browser驗收未證；D-008可見半徑限制相關顯示 |
| 7.1 | 尚未啟動 Cookie | — | 待 Bags 1–6 可觀察結果及 Bag 7 Review；此描述不是 Cookie 執行狀態 |
| 7.2 | 尚未啟動 Cookie | — | 待全計畫來源／實作索引核對及 Bag 7 Review；此描述不是 Cookie 執行狀態 |

## 2026-10-21 交接與停止新增實作

使用者要求暫停新增實作，先同步可供下一 AI 接手的狀態。根目錄 [HANDOFF.md](../HANDOFF.md) 為精簡入口，列有閱讀順序、Git/執行環境、目前實作與未接線邊界、來源地圖標註差異及近期驗證。此工作區與 `island-sim` 均非 Git repository，沒有 remote；不得描述為已同步至 Git。

本次新鮮核查（工程代理，2026-10-21 13:18:43 Asia/Taipei）：`npm run check` exit 1，停在 typecheck；`dungeon-runtime.test.ts:6:69` TS2307 缺少 `./dungeon-runtime.ts`，39:38、80:43、81:38 的 event implicit any 為該缺模組衍生；`simulation.ts:273:10` 未解析 `isSurfaceAction`，281:7 `string` 無法指派 `SurfaceAction`。因此 check 未執行 tests。另行 `npm test` exit 1，145 tests／144 pass／1 fail，唯一失敗為載入測試檔時 `ERR_MODULE_NOT_FOUND`（缺少 runtime module）。不得刪除測試或建立stub假綠。此為當下可見失敗，不等同已完成修復或任何 Cookie 狀態變更；歷史141/141通過不是當前狀態。

CLI 入口依 `src/ui/server.ts` 的直接執行判斷為 `node --experimental-strip-types src/ui/server.ts`，會開啟/建立 SQLite 並啟動 SimulationRunner，本次未啟動。對 `http://127.0.0.1:4173/` 的 GET（max 5s）失敗（curl exit 7／HTTP 000，2.015秒）；`Get-NetTCPConnection -LocalPort 4173 -State Listen` 無結果，當時沒有服務在聽。無法據此宣稱 UI/browser 驗收通過。模型 API key 僅存程序記憶體，服務重啟後須重新輸入；本次無真實付費 provider E2E 證據。

交接後若使用者未恢復實作，不新增功能。恢復後先處理上述有界失敗slice並重新核查，再選單一 Cookie/Crumb 對照契約與證據；歷史 141/141 測試快照不代表目前通過，也不代表 Cookie DONE。原始 ZIP、CSV、PNG 與 SQLite 資料保留。

## 後續紀錄格式

每次 Cookie 更新須提供 Cookie ID、單一 Cookie 狀態、變更、逐 Crumb 證據、未解項及跨 Bag 影響。Bag 宣稱完成時，另執行 Completed Bag Review，不以個別 Cookie DONE 代替 Bag Completion Condition。
