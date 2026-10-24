# Cookie Review｜輪迴島規劃草稿

> **執行授權更新（2026-10-20）：** 以下原始 Review 是規劃草稿審查的歷史結論；使用者後續明確指示「執行cookie」，已由 D-001 記錄為依現有 7 Bags／17 Cookies 開始執行。該授權不核准其他 D 決策或待回查規格。執行前局部 Bag Review 見 [BAG_REVIEWS.md](BAG_REVIEWS.md)，逐 Cookie 執行與證據見 [EXECUTION_LOG.md](EXECUTION_LOG.md)。

> **歷史計畫範圍記錄（2026-10-22；已由2026-10-25現況覆寫）：** 當時計畫共7 Bags／18 Cookies。正式遊戲文本寫入與來源映射歸Cookie 7.1；當時將Cookie 7.3空框架聚焦AI提示文本與回傳格式個性化微調，現有JSON動作格式維持不變。現行範圍及狀態見本文狀態索引與末段。

> **狀態索引歷史（2026-10-22）：** 以下D-006／Cookie 4.1–4.3摘要為當時狀態。Cookie 7.3於2026-10-25擴充Crumbs最終驗收後為DONE；最新逐Crumb結論見本文末段。Cookie 6.3亦依使用者指定紀錄審核方式接受為DONE，但未宣稱全頁browser E2E。

> **現行夜間規則與工程證據更新（2026-10-21）：** 使用者修正版覆蓋先前森林夜間負面率17.5%及睡眠正規化。夜間移動抵達時先按地形判遇敵：沙灘30%、森林35%、河流35%、岩石區30%；命中扣1HP後按蝙蝠:狼4:6選敵並結束地表事件，未命中才抽原地形池。危險區睡眠每3T用所在Node率判定、不抽地形池；有效點燃且仍在保護期的營火豁免；命中扣1HP，僅存活者醒來處理遭遇。定向測試49/49、`npm run check` exit 0且160/160通過。Cookie 1.1經快速Review後為DONE；Cookie 2.3仍未DONE，因部分Node地形／原事件池及營火點燃互動資料接線尚缺，其他Crumbs未全驗。
> **較早決策與工程快照（2026-10-21前）：** 原紀錄的17.5%正規化、夜間同池比例調整及WAIT未決均為歷史內容，已由新規則／決策覆寫；原Review段落只保留審查歷史。早期Cookie 1.1 BLOCKED狀態已由下方快速Review取代。

> **歷史決策及工程快照（2026-10-20；後續規則於2026-10-21覆寫夜間17.5%）：** D-010記錄SLEEP僅夜間至天亮；無獨立全域固定8次風險，安全區不觸發額外睡眠風險，不安全區睡眠風險逐人每3T、睡滿24T共8次。當時以森林夜間負面總率17.5%作非野外睡眠基準，現已作廢。D-013至D-017方向已決。Foundation當時回報`npm run check`及typecheck通過、141/141 tests；此舊快照不代表目前狀態或完整Cookie完成。

> **追加規格／來源核對（2026-10-20；夜間部分為歷史版本，2026-10-21已覆寫）：** 當時安全區睡眠不觸發額外風險；危險區逐人每3T檢查、最多8次；攻擊後傷害／死亡結算，存活才醒。森林夜間25%觸發、70%負面及非野外夜間睡眠正規化至17.5%均已作廢；現行夜間遇敵、地形率及睡眠規則以上方更新為準。白天森林池、主動採集野莓池及互動點來源標籤仍按其原規則保留。屍體成本與來源層級等不受此夜間覆寫影響。

**Subject:** 初始 Project Branding、Design Decisions 與計畫層 Cookie 結構  
**Scope and plan version:** `PROJECT_BRANDING.md` 草稿0.1、`DESIGN_DECISIONS.md` Proposed；依使用者指定 ZIP Reference 審查來源覆蓋、Bag Labels、Cookie 完整性、依賴與跨 Bag 契約。  
**Conclusion:** **passes**（規劃涵蓋與內部契約檢查）。這個結論只適用於計畫草稿，不代表使用者已核准計畫、程式已實作，或原始未決項已可驗證。

## 覆蓋與契約檢查

### 來源要求覆蓋矩陣

| Reference | 來源範圍 | 計畫對應 | 覆蓋判斷 |
|---|---|---|---|
| `README.md` | 規格標記、五項不變原則、可臆造邊界、增量資料 | Project Spirit、Bag 1–7、D-001–D-012、來源索引 | 覆蓋；保持來源狀態區分 |
| `00_版本與覆寫.md` | Q1–Q43 覆寫、72T、短訊、椰子、岩縫歷史 | Bag 1/2/4/7；D-008、D-010；歷史差異表 | 覆蓋；15/15/70 保留作廢狀態 |
| `01_核心玩法與角色.md` | 十居民、自主／觀察者、初始資源、代次與可見性 | Bag 4/5/6；Cookie 5.2、6.1 | 覆蓋 |
| `02_時間與行動排程.md` | 72T 時鐘、獨立等待、行動成本、訊息 | Bag 1/4；Cookie 1.1、4.2 | 覆蓋；WAIT=1T已決；夜間睡眠、危險區每3T風險、營火豁免、攻擊醒來順序依後續裁定更新 |
| `03_地圖與探索.md` | 主島與地牢拓樸、探索連續條件、物件生命週期 | Bag 2/3；Cookie 2.1、2.3、3.3 | 覆蓋；未映射地點不補值 |
| `03A_28Node原圖與鄰接表.md` | 28 Node、51 邊、地形分類與名稱可信度 | Cookie 2.1、6.1；D-003/D-004 | 圖可核28 Node／51邊及火山、營地、港口；森林／石堆／河流依分組序列對應，非逐點文字標名；像素座標未轉距離 |
| `04_生存物品與裝備.md` | 背包、裝備、HP／食物、唯一裝備與升級 | Cookie 2.2、3.3；D-005/D-010 | 覆蓋；容器商品映射已依使用者核准，來源名稱保留 |
| `05_戰鬥與怪物.md` | 傷害公式、地表／地牢怪、Boss、特殊技能 | Cookie 3.1–3.3；D-009 | 覆蓋；未定機率與映射沒有補造 |
| `06_地表事件與資源.md` | 椰子、釣魚、河流、岩石、森林及夜間安全 | Cookie 2.3、3.2；D-004、D-019 | 森林進區與主動野莓採集分池；森林進區比例依使用者後續裁定更新；逐點互動位置按來源確定度記錄 |
| `07_地牢事件與掉落.md` | 三層主事件、Boss 獎勵、特殊限制 | Cookie 3.2–3.3；D-007/D-009 | 覆蓋；D-007非第一排分配已核准並接線 |
| `07A_找回的詳細掉落表.md` | 怪物附加掉落、七容器兩階段池、舊值對照 | Cookie 3.3、7.2；D-005/D-006 | 覆蓋；D-006現行覆寫為所有含物品容器每次一件 |
| `08_交流歷史與死亡.md` | 公開短訊、交易、碑文、死後傳記與痕跡 | Bag 4/5/6；Cookie 4.2、5.2、6.2 | 覆蓋；可見半徑仍未決 |
| `09_工程架構與介面.md` | 核心、Router、持久化、內容表、UI、成本與次序 | Bag 1/4/5/6/7；D-002、D-012 | 覆蓋；架構方向和 schema 欄位分清 |
| `10_驗收與模擬測試.md` | 行為案例、整數時間、戰鬥數學、來源缺口 | Cookie 全體 Crumbs、Cookie 7.1 | 覆蓋為計畫驗收目標；未聲稱已執行 |
| `11_待回查與一致性.md` | M/C 缺口、錯誤合併防線及資料完整範圍 | Design Decisions 未知追溯表、各 Rotten if | 覆蓋；M-01–06、C-01–19 保留 |
| `12_舊稿保存.md` | 2026-10-19 可用歷史方向、作廢值與價格快照 | Project Branding 歷史差異、D-001/D-012 | 覆蓋；歷史數據不當現價／現行值 |
| `13_關鍵數值速查.md` | 主要數值和事件率快速索引 | Bags 1–3、Cookie 7.2 | 覆蓋；引用完整章節作準 |
| `14_AI決策提示詞與Node報幕.md` | AI 輸入、JSON、報幕、Router、錯誤／記憶 | Bag 4/5；Cookie 4.1、4.3、5.2 | 覆蓋；介面示例未當資料庫 schema |
| `15_UI原決議回查與界面邊界.md` | 觀察 UI 功能、可視資料界線與未知視覺設計 | Bag 6；Cookie 6.1/6.2；D-011 | 覆蓋；保留未取回的版面和美術資訊 |
| `tables/attack_distributions.csv` | 54 列攻擊／反傷分佈及狀態 | Cookie 3.2、7.1 | 覆蓋；設計衍生值標示來源 |
| `tables/container_category_weights.csv` | 七來源 × 四分類權重 | Cookie 3.3 | 覆蓋；provisional 標記未提升 |
| `tables/container_effective_item_rates.csv` | 46 項兩階段有效率 | Cookie 3.3、7.1 | 覆蓋；與子池計算一致性屬後續驗收 |
| `tables/container_item_subpools.csv` | 46 項分類內比例及有效率 | Cookie 3.3、7.2 | 覆蓋；商品名不自動映射 |
| `tables/dungeon_events.csv` | 27 條含Node scope與整數權重的地牢事件列 | Cookie 3.3、7.1 | 覆蓋；兩組第三層Node pool各300 weight units／100% |
| `tables/equipment.csv` | 28 項裝備能力、空欄和歧義註記 | Cookie 2.2、3.2、D-005 | 覆蓋；空速度值不補0 |
| `tables/fishing_pool.csv` | 釣魚主池和雜物整體率 | Cookie 2.3 | 覆蓋；勇者下甲 2% 按整體率 |
| `tables/food.csv` | 12 項食物效果、腐敗與例外 | Cookie 2.2 | 覆蓋；三日腐敗起點列未決 |
| `tables/island_adjacency.csv` | 28 Node 鄰居／度數 | Cookie 2.1 | 覆蓋 |
| `tables/island_edges.csv` | 51 條邊及原圖證據 | Cookie 2.1 | 覆蓋 |
| `tables/island_nodes.csv` | 28 Node、視覺類型、命名確定度 | Cookie 2.1、D-003/D-004 | 覆蓋；地名 certainty 保留 |
| `tables/monster_bonus_drops.csv` | 九種怪物附加掉落率 | Cookie 3.3 | 覆蓋；與唯一劍分離 |
| `tables/monsters.csv` | 19 條地表／地牢／Boss 參數和生成條件 | Cookie 3.2、2.3 | 覆蓋；缺率保持空值 |
| `tables/recovered_surface_actions.csv` | 野莓、岩縫歷史與山羊摘錄 | Cookie 2.3、D-010、歷史差異 | 覆蓋；作廢舊列不得載入 |
| `tables/surface_exploration.csv` | 河流、岩石結果與獨立風險 | Cookie 2.3 | 覆蓋 |
| `tables/values_to_recover.csv` | 未知值索引 | Design Decisions 未知追溯表 | 覆蓋；狀態據來源維持 |
| `assets/主島28Node原圖.png` | Node 幾何與道路拓樸視覺來源 | Cookie 2.1、6.1 | 原圖已直接查看，支持28 Node／51邊及火山、營地、港口；地表互動點須與03A及CSV分組標記交叉核對，不視為每個事件站點均有圖上直接標名，也不視為畫風規格 |

### Bag Label 與 Cookie 結構

- 7 個 Bag 均包含 Purpose、Owns、Inputs、Outputs、Allowed Changes、Forbidden Changes、Dependencies、Completion Condition、Rotten Conditions 九欄。
- 17 個 Cookie 均具 Goal、Inputs、Allowed touch points、Dependencies、Expected output、Crumbs、Rotten if。
- Crumbs 均可在未來透過狀態、表格、事件紀錄、重播或 UI 觀察核對；此處列的是計畫驗收條件，不代表已有證據。
- 所有正式定義保持 Proposed／待核准；Reference 中既有確定值與推導值按原狀態分別記錄。

### 跨 Bag 依賴與契約相容性

| 契約 | 提供方 → 接收方 | 檢查結果 |
|---|---|---|
| 時鐘與合法時間成本 | Bag 1 → Bags 2–4、6、7 | 相容：核心排程決定下一可行動實體、領域 Cookie 提供行動成本；D-013定義同SPD次序；WAIT=1T已決。 |
| Node 圖與位置語義 | Bag 2 → Bags 3、4、6 | 相容：同一主島拓樸支援移動、場景事件、模型可見 Node 及唯讀 UI；尚未確認名稱／互動點保留 TBD。 |
| 物件與裝備契約 | Bag 2 → Bags 3–5 | 相容：物件身分與全域唯一性由核心／持久層共同支援；商品別名及D-006容器件數均有明確使用者決定並同步實作。 |
| 結算與歷史 | Bags 1–4 → Bag 5 → Bag 6/7 | 相容：已結算客觀事件由 Bag 5 保存；Bag 6 只讀呈現、Bag 7 驗證；intent/記憶/傳記維持不同資料生命週期。 |
| Router 輸入與動作回覆 | Bag 4 → Bags 1–3 | 相容：模型只能提交當前 action ID，由核心／領域驗證及結算；`text`、`intent` 不直接寫物理狀態。 |
| 短訊與事件可見性 | Bag 4 → Bags 5–6 | 條件相容：公開非同步和1T成本已定；跨 Node 範圍保留決策 D-008，UI 不先行承諾廣播。 |
| UI 控制和世界權限 | Bag 6 → Bag 1；查詢來自 Bag 5 | 相容：暫停／恢復／調速走控制介面；其他資訊為唯讀投影，不直接形成居民動作。 |
| 整合驗收 | Bags 1–6 → Bag 7 | 相容：Bag 7 僅在前置契約有可觀察輸出後執行；計畫檢查和系統執行驗證明確分開。 |

## Findings

### 規劃範圍通過，正式執行仍待核准

- **Evidence and source:** 指定 ZIP 的 README、00–15、16 個 CSV 與主島原圖；`PROJECT_BRANDING.md`、`DESIGN_DECISIONS.md`。
- **Requirement or contract:** Branding 的完整 Project → Bag → Bag Label → Cookie → Crumbs 結構；每 Bag 九欄；正式定義需核准。
- **Affected scope:** 所有 Bags 與 Cookies。
- **Issue:** 覆蓋和文件內部契約已規劃；計畫本身仍是 Proposed，尚未成為執行授權。
- **Correction route:** 使用者審閱／核准或修訂 D-001；正式通過後，依 Cookie skill 的 Project Review 再進入執行流程。
- **Verification after correction:** 核對核准版本、適用範圍與受影響決策；執行前對相關 Bag 做 Bag Review。

### 原始未決資料不構成計畫覆蓋缺陷，但其實作仍不可驗證

- **Evidence and source:** Reference 11 的 M-01–M-06、C-01–C-19；`tables/values_to_recover.csv`；Reference 15 視覺設計缺口。
- **Requirement or contract:** 規劃不得虛構值；Review 應區分未知與已核定。
- **Affected scope:** Bag 1–6，特別是 D-003–D-012。
- **Issue:** 多個原始細節未取得；本次只檢查其在計畫中被保留，無法驗證其最終答案或實作行為。
- **Correction route:** 依每項決策所列來源證據取得方式回查或提出具體提案；只更新受影響範圍並保留歷史。
- **Verification after correction:** 將來源／核准狀態回填 Design Decisions 與受影響 Cookie，並做局部 Review。

## 證據與不確定性

- **直接檢視：** ZIP 內 19 份 Markdown、16 份 CSV、主島原圖的來源路徑與必要內容。附件未解壓；未查看 `transfer.json`；未執行附件內容。
- **規格可核對：** 文件是否覆蓋來源範圍、Bag Label 欄位是否齊全、Cookie 必要欄位是否齊全、主要 Bag 契約是否相容、歷史／未知狀態是否保留。
- **本次不可能驗證：** 尚不存在的遊戲實作、實際 API/Router、SQLite schema、瀏覽器 UI、成本計量、長期模擬，以及待核原始規則本身。
- **核對摘要限制：** Reference 明示部分值來自長篇 Q&A 摘要、不是逐字原文；本 Review 不把摘要偽稱為逐字原始證據。

## 追加局部Review：最新睡眠、事件及地圖來源更新

- **睡眠規則（現行修正版）：** 安全區睡眠不觸發額外風險；危險區逐人每3T以所在Node地形率判定、完整夜最多8次，不抽地形池。有效點燃且仍在保護期內的營火Node跳過；命中先固定扣1HP，存活者才驚醒並處理遇敵，後續怪物攻擊另算。舊17.5%正規化已作廢。定向49/49及完整160/160通過；完整Cookie仍未驗收。
- **夜間移動與森林事件（現行修正版）：** 夜間移動結算時依地形先抽遇敵率：沙灘30%、森林35%、河流35%、岩石區30%。命中扣1HP並按蝙蝠:狼4:6選敵，結束本次地表事件；未命中才抽原地形池，兩池不合併。森林原地形池夜間25%觸發／70%負面僅在新遇敵抽取失敗後適用；白天原池及主動野莓90/10保留。舊「夜間同池調成17.5%」已作廢。
- **地圖crosswalk：** 原圖直接標示Node／道路骨架及火山、營地、港口。`03A`與`island_nodes.csv`能以分組文字順序對應森林9/17/23、石堆6/19/22、河流24，但CSV的label_status明示不可視作逐點命名。使用者採用魚站2/10/14及椰子1/8/13作執行設定；此為使用者設定，不聲稱地圖直接標定。以上互動點依使用者採用設定執行，Reference／圖面來源層級另行保留。
- **屍體行動：** 使用者採用每拿一件1T、搬起1T、放下1T；攜屍跨Node仍用3T移動、不另加搬運成本。具體程式／Cookie驗收尚未完成。
- **審查狀態：** 上述內容只更新現行規則、來源可信度及位置狀態，不提升任一Cookie為DONE。工程端回報core 141/141與typecheck通過屬局部證據，不等同整合或完整Cookie驗收。

## Cookie 1.1 快速 Review（2026-10-21）

**範圍：** `PROJECT_BRANDING.md` Cookie 1.1（版本0.2）及其Bag 1契約；核對Reference 02時間排程、06地表夜間規則、`simulation.ts`／`clock.ts`／`tie-break.ts`／`night-encounter.ts`，以及最近實際驗證 `npm run check` exit 0、typecheck通過、160/160 tests。

**結論： passes。** 核對結果如下：

| Cookie 1.1 Crumb | 實際證據 | Review |
|---|---|---|
| 72T一日、48T白天、24T夜晚；獨立整數T | `clock.ts` 的日相位／時間計算；`clock.test.ts:5` 邊界測試 | 通過 |
| WAIT=1T；行動只推進該角色下次行動時間 | `simulation.ts:19,90` 常數及WAIT action；`simulation.test.ts:444` 單角色T1、移動3T及其他居民時點不變 | 通過 |
| 移動耗3T並在到達結算點更新Node；無額外travel timer | `simulation.ts:639-645` 同次結算事件抽取；`simulation.test.ts:204,238,322` 即時Node／3T移動／夜間抵達遭遇 | 通過 |
| 夜間地形率、命中固定-1HP、成功後4:6選敵並與原池互斥 | `surface-user-overrides.ts` 地形率與權重；`night-encounter.ts:24-44` 抽取；`simulation.test.ts:322` 命中／未命中；`domain/surface.test.ts:79-106` 四類率與權重邊界 | 通過（有來源分類的地形） |
| 危險區睡眠每3T依Node率、不抽地形池；固定扣血後存活才醒；有效營火保護 | `simulation.ts:901-941,1304-1310`; `simulation.test.ts:572,606,642,664` 覆蓋命中、致死、未點燃／過期及有效營火 | 通過（保護狀態以WorldState欄位提供） |
| 同一時點依SPD排；居民同SPD按D-013屬性並以seed打破完全平手；怪物行動1T並回饋同Node居民／AI | `clock.ts`、`tie-break.ts:108+`; `clock.test.ts:18-36`、`tie-break.test.ts:16-59`；`simulation.test.ts:422`；`simulation-runner.test.ts`怪物自動行動；`ai/view.test.ts`前次怪物結果進下一AI輸入 | 通過；跨類型同SPD依Crumb保留unresolved |
| 死亡者離開排程、事件與隨機結果可重播 | `clock.test.ts:28-36`; `simulation.test.ts:885` SQLite關閉重開後snapshot/event/RNG重播 | 通過 |

**疑點歸屬判斷：** (1) 03A／`island_nodes.csv`對部分Node未提供四類地形映射，屬Bag 2.1/2.3內容資料；1.1排程器對缺映射回傳unresolved、不臆測率，已符合其核心輸入邊界。這不等於宣稱所有Node的地表遇敵內容完成。(2) Reference 04:85把營火列為物件，來源見07；Cookie 1.1只需依WorldState的`lit`與`expiresAtT`判斷保護，本體建立／點燃或保護期生成屬物件取得／互動流程，不是排程Crumb。測試已覆蓋有效、未點燃和過期狀態。(3) Cookie 1.1 Crumb明確把跨類型同SPD保留為unresolved；clock／simulation測試驗證缺少核准比較規則時不猜排序。故三項均不構成Cookie 1.1未完成的核心驗收Crumb；地圖／營火流程仍留在各自Cookie未完成範圍。

**狀態： Cookie 1.1 DONE。** 最新完整檢查160/160及上述既有整合證據足以驗收本Cookie。Cookie 1.1 DONE不代表Bag 1完成；依序進入Cookie 1.2。

## Cookie 1.2 快速 Review（2026-10-21；執行中，未通過）

**範圍：** `PROJECT_BRANDING.md` Cookie 1.2 Goal／Crumbs，參照03–07、09–10；核對 `simulation.ts`、`dungeon-runtime.ts`、`domain/dungeon.ts`、`domain/survival.ts`、`sqlite-store.ts`與對應測試。最近驗證為唯一裝備回歸測試通過及 `npm run check` exit 0、typecheck通過、161/161 tests。

| Cookie 1.2 Crumb | 實際證據 | Review |
|---|---|---|
| 每個合法行動一筆可查結果；SQLite事件及snapshot同批原子提交；重播不重複授獎 | `sqlite-store.ts` `commit()`同一transaction插入事件並更新snapshot；`sqlite-store.test.ts`測試提交、舊sequence拒絕及事件衝突整批rollback；`simulation.test.ts`磁碟close/reopen重播 | 核心儲存原子性有證據；各領域行動是否都走共用完整dispatcher尚未通過 |
| 掉落／移交與唯一裝備全域檢查單次原子操作 | `surface`結算曾只檢查世界物件及當前actor；新增測試重現另一居民持有勇者下甲時仍重授；`simulation.ts`現在檢查所有活躍世界物件及所有居民背包／裝備。測試確認不授第二件且事件標記唯一品已存在 | 此修正通過測試；正式DROP及simulation中的GIFT／交易移交dispatcher尚未接入，Crumb整體未通過 |
| 一般地面物件及未開容器生成後72T到期；自然椰子、屍體、碑文、唯一勇者裝備各依例外 | `survival.ts:68-77`純函數計算普通物件與opened-container到期，例外不過期；`simulation.ts:223`加入有期限物件timer、`:968`移除到期物件；`survival.test.ts:32-39`及`simulation.test.ts:525`測試期限和排程 | 一般物件及列舉例外有局部證據；container目前未列為`WorldObject`類型，DungeonRuntime只產生event draft，未建立可由timer刪除的未開容器。端到端未通過 |
| 屍體每取一件1T、搬起／放下1T；跨Node搬運仍只按移動3T | `simulation.ts` corpses action costs及settlement；`simulation.test.ts`屍體搜刮與移動測例 | 既有測例支持該行動切片；Cookie整體未通過 |
| 事件保留隨機抽取資訊 | surface/dungeon純resolver回傳draws；SQLite持久化event draws；`simulation.test.ts`磁碟重開重播檢查 | 局部通過；Dungeon事件尚未接入同一WorldState事件提交，不能認定所有領域完整 |

**結論：** 1.2仍未宣告DONE。最新檢查161/161證明當前已接入路徑，並不涵蓋Cookie要求的所有合法領域行動。具體剩餘程式缺口是DROP與社交移交沒有接入simulation dispatcher；DungeonRuntime容器event沒有建立WorldObject，因此不能驗證未開容器72T到期與同交易事件結果。其餘本文已逐項標明局部實作證據。沒有要求使用者補數值；下一步需在Cookie1.2範圍內完成這些既有來源規則的runtime接線後，再逐Crumb複核。

## 使用者摘要

規劃草稿原已通過來源覆蓋與 Cookie 結構檢查；其後使用者授權依現有計畫執行。WAIT=1T、戰鬥每回合1T及現行夜間／睡眠規則已決，舊17.5%睡眠正規化及WAIT未決記錄均為歷史狀態。決策已定不代表工程完成；完整Cookie Crumb仍未驗收。Node地形分類、原地形池來源資料、營火實際建立／點燃接線及其他未完成規則須按最小範圍保留。

## Cookie 1.2 Review 更新（2026-10-21；覆寫本節前述執行中缺口狀態）

**新增完成證據：** `simulation.ts`現接入DROP（1T、一般物件72T、四件勇者裝備永久且unique）、GIFT（1T同Node即時移交、唯一持有者更新）；地表唯一授獎檢查會查所有actor inventory/equipment及未到期unique WorldObject。所有死亡路徑的屍體物品保留勇者裝備unique標記。`dungeon-runtime.ts`對容器事件回傳`WorldObject`，生成時+72T；其早期provisional件數標記已由現行D-006覆寫移除。測試新增跨居民重授防護、DROP普通／唯一物件、GIFT勇者劍owner更新、容器物件72T建立與到期排程。

**最新驗證：** `npm run check` exit 0，`tsc --noEmit`通過、164/164 tests通過；新增的三條定向測試（唯一獎勵、GIFT、DROP）及container creation/expiry case通過。

### Cookie 1.2 Quick Review 更新（2026-10-22）

**依據：** `PROJECT_BRANDING.md` Cookie 1.2 Crumbs；`engine/simulation.ts`、`engine/dungeon-runtime.ts`、`domain/dungeon.ts`、`persistence/sqlite-store.ts`及其定向測試。

| Crumb | 現有可查證證據 | Review |
|---|---|---|
| 掉落／移交及唯一裝備全域檢查同次原子結算 | `simulation.test.ts` DROP/GIFT/唯一授獎測例；`sqlite-store.test.ts`事件與snapshot同批、衝突rollback | 已接入路徑通過。 |
| 普通物件與未開容器生成後72T到期；特殊物件例外 | `survival.test.ts`期限／例外；`dungeon-runtime.test.ts` container WorldObject建立；`simulation.test.ts` timer到期 | 規則與各自helper/timer有局部證據；DungeonRuntime輸出仍未進主WorldState。 |
| 屍體取放成本及跨Node移動成本 | `simulation.test.ts`屍體單件取放、攜帶後移動測例 | 通過既有接線。 |
| 事件保留隨機抽取資訊與重播 | `dungeon-runtime.test.ts`抽取draw；`sqlite-store.test.ts`關閉重開與事件/snapshot；SQLite批次rollback | 已接入的領域／store路徑有測試；未把helper的draw等同已持久化的DungeonRuntime事件。 |
| 地牢事件加入核心並與WorldState/事件同批提交 | DungeonRuntime目前獨立回傳`nextDungeonState/eventDrafts/createdObjects`；`WorldState`沒有DungeonRuntime持久欄位，simulation沒有`enter-cell` action或DungeonRuntime呼叫點 | 未通過。來源缺地牢各層cell ID/鄰接、入口分支及Boss cell映射；不能生成合法、可驗證的cell move action。已向parent請求來源或明確定義授權，不猜拓樸。 |

**本次定向驗證：** `node --experimental-strip-types --test src/domain/dungeon.test.ts src/engine/dungeon-runtime.test.ts src/engine/simulation.test.ts src/persistence/sqlite-store.test.ts`，57/57通過。此結果確認可執行切片，沒有解除上述核心整合缺口。

**結論： BLOCKED。** 非拓樸依賴的Crumbs均有現有測例；整體Cookie因DungeonRuntime尚未接入主simulation/WorldState/同批SQLite提交而不能DONE。要完成該接線需要正式拓樸來源或授權的最小拓樸定義，現階段不虛構cell資料。

**逐Crumb結論更新：** 原先表格中「DROP／GIFT dispatcher未接入」及「DungeonRuntime不建立容器物件」已由本次改動取代。1.2仍為 **BLOCKED**：本checkout沒有地牢進入合法動作或主simulation dispatcher呼叫`resolveDungeonRuntimeStep`，因此容器WorldObject、DungeonState、event draws尚不能同一WorldState結算／SQLite交易提交。此精確缺口依賴Cookie 3.3地牢事件dispatch與Bag 5.1持久化整合；沒有臆造容器內容、開啟流程或掉落行為。Cookie 1.2不標DONE，依序可先執行不依賴該地牢dispatch的Cookie 2.1。

### Cookie 1.2 接續檢查（2026-10-21）

已補 `loadSimulationActionContent` 正式載入 `dungeon_events.csv`，`actions.test.ts` 直接驗證雨林巨蟒來源列可讀，且全套 `npm run check` exit 0、typecheck通過、168/168。這解除事件表未載入問題，但不解除主流程缺口。核對 `03_地圖與探索.md` 只說三層、三分支、每層至少3次移動到Boss，並列第三層第一排A1/B1/C1；`dungeon_events.csv`沒有 cell 欄位。仍欠每層cell ID/鄰接、入口初始branch/cell及Boss cell映射，故不能從actor狀態生成合法目標或判定 `isBossCell`。已向parent詢問正式來源或核准映射；收到前保持BLOCKED，不新增拓樸。既有SQLite `commit` 已提供snapshot+event batch transaction，待dispatcher接通後可沿用。
## Cookie 2.1 快速 Review（2026-10-21）

**範圍：** `PROJECT_BRANDING.md` Cookie 2.1 Crumbs及Reference 03／03A、地圖CSV；檢視 `content/island.ts`、`engine/world.ts`及既有測試。此Cookie依Cookie順序接續1.2；1.2因後續地牢dispatcher／持久化依賴已記BLOCKED，2.1只依賴已驗3T移動結算。

| Cookie 2.1 Crumb | 實際證據 | Review |
|---|---|---|
| 28 Node、51唯一無向邊；圖連通 | `island.test.ts:7-30`讀實際CSV驗數量、連通；`island.ts`驗Node ID、規則化edge uniqueness及端點有效 | 通過 |
| 外圈1–16閉環、15↔25直連；不從幾何交叉增邊 | `island_edges.csv`外圈16邊與15-25資料；新增`island.test.ts`逐一核對1-2...15-16、16-1；edge來源只讀CSV，不從座標產生 | 通過 |
| 場景／地形標籤保留證據層級；森林9/17/23、石堆6/19/22、河流24分組不冒稱逐點命名 | `island_nodes.csv`逐點`label_status`與分組`region_description`；`island.ts`原樣映射；測試確認未逐點命名Node標籤仍為null並保留M-01 unresolved | 通過 |
| 使用者採用魚站2/10/14、椰子1/8/13（0初始、日+1、上限3） | `approved-surface-capabilities.ts`採用設定與來源候選交叉核驗；`approved-surface-capabilities.test.ts`核對node IDs/stock/cap/production | 通過（標為user-adopted設定，不稱原圖直標） |
| 出生點限1/8/13且每居民seeded獨立抽選、不相鄰、不沿用前代 | `world.ts`按居民消耗seeded draws；`world.test.ts:8-39`驗證十居民、重播一致、候選點與互不相鄰 | 通過 |

**結論： passes。** 最新 `npm run check` exit 0，typecheck通過、164/164 tests；本輪另補外圈逐邊回歸測試。Cookie 2.1標DONE。2.2待依順序開始；1.2仍BLOCKED不影響其拓樸輸入依賴。
## Cookie 2.2 快速 Review（2026-10-21）

**範圍：** `PROJECT_BRANDING.md` Cookie 2.2 Crumbs與Reference 01／04／13；核對生存、物品、裝備與定時器實作及現有測例。最新驗證`npm run check` exit 0、typecheck通過、164/164 tests。

| Cookie 2.2 Crumb | 實際證據 | Review |
|---|---|---|
| HP30／飽食5／睡眠3；十格背包、物品不堆疊；飽食低於5才吃、整份效果可超過5 | `domain/survival.ts:createInitialVitals/applyFood/addInventoryItem`；`survival.test.ts:5-25` | 通過 |
| 三島日腐敗起點保留待決 | `foodSpoilAtT()`保留C-11 unresolved，不設到期；`survival.test.ts:27-30` | 通過（按Crumb保留未知，不作錯誤計時） |
| 普通地面物件生成後72T；唯一勇者裝備不過期且全世界唯一 | `survival.ts:68-77`、`simulation.ts`DROP／expiry timer／授獎全域檢查；`survival.test.ts:32-40`、`simulation.test.ts`DROP與跨居民重授測例 | 通過 |
| 自然椰子、屍體、碑文例外 | `survival.ts:68-77`對natural-coconut／corpse／inscription／hero-unique回傳無到期；死亡路徑屍體與戰利品永存並保留勇者裝備unique；`survival.test.ts:32-40`、`simulation.test.ts`死亡測例 | 通過；碑文狀態以無expiry的領域物件契約保留，未添加未授權刻碑流程 |
| 屍體每取一件1T、搬起1T、放下1T；跨Node搬運仍移動3T | `simulation.ts:52-65, 163-179, 644-681`；`simulation.test.ts`逐件搜刮、搬屍及立即3T移動 | 通過 |
| 未知椰子由庫存／滿包採收落地生命週期不臆測 | `surface.ts:142-154`滿包採收回傳C-16且不扣庫存；`simulation.ts`椰子drop以C-16拒絕且不提交。`surface.test.ts`與`simulation.test.ts`覆蓋 | 通過（明確未知邊界fail-closed） |

**結論： passes。** Cookie2.2明文保留C-11腐敗起點和C-16落地椰子生命周期未知；執行端不假設其值、無變更提交，符合Crumb。其餘定義行為有測試證據，Cookie2.2設DONE。Cookie 1.2仍因DungeonRuntime進入／同交易dispatcher依賴Cookie3.3及Bag5.1而BLOCKED；不阻止2.2已驗生存／物件Crumbs。
## Cookie 2.3 快速 Review（2026-10-21；BLOCKED）

**範圍：** `PROJECT_BRANDING.md` Cookie 2.3 Crumbs及Reference 00／03／06／07A／11／13；核對`domain/surface.ts`、`forest-risk.ts`、`night-encounter.ts`、`simulation.ts`及地表CSV與既有測例。最新完整驗證`npm run check` exit 0、typecheck通過、164/164 tests。

| Cookie 2.3 Crumb | 實際證據 | Review |
|---|---|---|
| 釣魚主池100%；雜物12/4/2/2為整體率 | `fishing_pool.csv`及`surface.test.ts`雜物子池conditionalize／勇者下甲唯一測例 | 來源資料與resolver通過；唯一裝備全域防重由simulation新回歸覆蓋 |
| 河流20/5/75、岩石資源5/5/90；HP／睡眠風險各自獨立抽 | `surface_exploration.csv`；`surface.test.ts`岩石測試確認3個獨立draw及效果 | 通過；夜潛魚池與夜熊獨立次序仍明確unresolved，不合併抽池 |
| 森林野莓90/10；森林進區日15%×35%、夜25%×70%，空Node且不與夜間新遇敵合併 | `surface-user-overrides.ts`；`forest-risk.ts`兩階段抽取；`simulation.test.ts`移動結算依序接入 | 機率和順序有測試；production未載入具體森林條件結果列，resolver只回傳positive/negative category及unresolved，不生成來源不足怪物 |
| 夜間地表遇敵30/35/35/30，命中扣1HP並按4:6選敵；miss才抽原地形池；睡眠每3T同Node率且營火豁免 | `night-encounter.ts`、`surface-user-overrides.ts`、`simulation.ts`；`surface.test.ts`率與權重邊界；`simulation.test.ts`夜移動／睡眠／營火互斥流程 | 有來源分類Node的行動結算通過；未分類Node／原地形池缺失保持unresolved |
| 椰子三Node設定、每日+1上限3；自然椰子不過期 | `surface.ts`與`approved-surface-capabilities.ts`；`surface.test.ts`庫存／生產；2.2本輪改為C-16落地場景fail-closed | 已知產量通過；自然椰子落地後生命周期依C-16留unresolved |

**結論： BLOCKED。** 已有來源值與測試證明已接入的分支；但production森林條件遭遇表未提供（目前只存在測試注入），森林實際負面結果無法選出monster actor。另有Node地形／原事件池缺口。這些是Cookie要求的production資料接線而非需要使用者補定已決夜間率；不新增或估計資料。依順序下一個可先執行Cookie 3.1，其依賴Bag1時間與Bag2.2已具備可驗切片。

### Cookie 2.3 快速 Review 更新（2026-10-21；DONE）

**範圍與Acceptance：** 依 `PROJECT_BRANDING.md` Cookie 2.3 Crumbs，以及使用者修正版夜間遭遇規則；本次只核對production地形/權重設定路徑，不擴寫地形事件池。

| Crumb | 最新證據 | Review |
|---|---|---|
| 夜間抵達按四地形率判定 | `island_nodes.csv` 正式Node 1/9/24/6經 `loadIslandGraph` 載入；新增 `surface.test.ts` 以現行resolver、正式Node標籤和 production 覆寫規則驗證四率命中，定向測試18/18 | 通過。未知地形仍fail-closed。 |
| 成功後4:6選敵 | `surface-user-overrides.ts`既有 production 權重4/6；測試覆蓋低於40%選蝙蝠、40%及以上選狼；simulation既有端到端測試證明只在命中時生成並排程敵人 | 通過。沒有把權重當成遭遇率。 |
| 生產來源，不用注入遭遇表 | 新測試讀正式 `island_nodes.csv`，直接呼叫 production resolver/規則覆寫；無注入地形表或遭遇權重 | 通過。正式夜間率與敵種權重原已在 `surface-user-overrides.ts`，本次補足production地形路徑驗證。 |
| 其他已知地表池、睡眠、椰子、風險分離 | 原測例及 `surface.test.ts` 現有測試；本次完整檢查 `npm run check` exit 0、typecheck通過、165/165 | 通過。 |
| 未知資料保留 | `surface_exploration.csv`／森林原池資料不足仍由resolver記錄unresolved；不新增結果或機率 | 符合「保留地表事件缺口」Crumb，不構成本Cookie已知內容未完成。 |

**結論： DONE。** 舊BLOCKED結論是本次更新前的歷史記錄；production rates/weights實際已設定，新增正式地圖資料測試後Crumbs有可重播證據。未映射Node與未提供原事件結果仍隔離為unresolved，沒有補造內容。

## Cookie 3.1 快速 Review 更新（2026-10-21；BLOCKED）

**範圍：** `PROJECT_BRANDING.md` Cookie 3.1 正式Crumbs與Reference 05；本次處理先前路線撤退實作缺口，並複核攻擊、排程、結果發布和擊殺獎勵。

| Crumb | 實際證據 | Review |
|---|---|---|
| 居民命中傷害與怪物對居民傷害 | `domain/combat.ts`；`domain/combat.test.ts`；`simulation.test.ts` resident attack、monster action coverage | 公式已接線，玩家命中底限1、怪物傷害底限0。 |
| 居民與怪物共用時間/SPD排程、怪物每行動後冷卻1T | `nextWorldEvent`、`resolveScheduledMonsterTurn`、runner自動結算測例；同時點resident/monster順序與跨類型tie fail-closed測例 | 已知規則接線；跨類型tie依Crumb維持unresolved。 |
| 撤退沿先前路線、黏液怪阻止、不可穿越路障怪 | `WorldActor.routeHistory`及 `simulation.ts` `retreat` action；新增A→B→C後退B→A、黏液怪禁止、先前Node有活怪阻路測試 | 通過。move append，retreat pop，無額外旅行timer；成本沿一般移動3T。 |
| 戰鬥結果公開並回饋同Node居民/AI | `monster-action-settled`／`resident-attacked`公開事件；`ai/view.ts` previous monster result測例 | 已接線。 |
| 最後一擊者取得擊殺物品，包滿時掉地 | resident攻擊能降低/擊殺怪物，但該分支目前不讀怪物獎勵資料、不建立獎勵WorldObject | 未完成，Cookie BLOCKED。依Bag 3.3/1.2既有掉落物件/唯一性接口處理；本次不補造怪物獎勵。 |

**驗證：** 撤退定向測試3/3；`npm run check` exit 0，typecheck通過、168/168 tests。

**結論： BLOCKED。** 已修復可獨立完成的路線狀態/撤退行為；擊殺獎勵Crumb仍需落地物件與來源掉落資料的跨Cookie接線，因此不宣告DONE。原Cookie 3.1歷史狀態文字由本段更新。

### Cookie 3.1 Quick Review 更新（2026-10-22；歷史狀態，已由後續更新取代）

**依據：** `PROJECT_BRANDING.md` Cookie 3.1 Crumbs；Reference 05、07、07A；`engine/simulation.ts`、`domain/dungeon.ts`、`content/actions.ts`及相關測試。

| Crumb | 實際證據 | Review |
|---|---|---|
| 玩家／怪物傷害、怪物SPD排程、1T冷卻、撤退條件與結果回饋 | `combat.test.ts`、`simulation.test.ts`、`ai/view.test.ts`；公開事件及前次怪物結果投影 | 已知部分有測例；跨類型同SPD依Crumb保留unresolved。 |
| 最後一擊取得怪物物品；滿包落地 | 新增擊殺結算接線讀取production `monster_bonus_drops.csv`；巨蟒來源列測試證明最後一擊者獲隨機紙筆／告示牌，空位存入inventory、滿包落地72T，event保存抽取draw | 僅來源表含列的一般怪物切片通過。 |
| 火蜥蜴條件保證勇者劍與Boss獎勵最後一擊／滿包處理 | `domain/dungeon.ts`已有unique可回歸判斷、`domain/monsters.ts`已有Boss reward plan helper；尚未接入simulation的擊殺結算 | 未通過；依Cookie 3.3已核對有既有資料／helper可沿用，屬尚未完成的runtime接線，不是使用者缺值。 |
| 不在九怪掉落表中的怪物獎勵 | Reference 05有一般「擊殺獎勵給最後一擊者」原則，但目前production bonus-drop表只含9種地牢怪 | 來源未提供其他怪物具體獎勵內容；不擴成猜測掉落。 |

**驗證：** 新測先失敗（`rewardItemId`缺失）；修復後定向 `node --experimental-strip-types --test src/content/actions.test.ts src/engine/simulation.test.ts` 39/39；`npm run check` exit 0、typecheck通過、176/176。

**歷史結論（已被下方更新部分取代）： BLOCKED。** 當時火蜥蜴unique reward尚未接線；後續已完成此來源明確切片，但Cookie整體仍不可DONE。

### Cookie 3.1 Quick Review 更新（2026-10-22；火蜥蜴唯一獎勵切片）

| Crumb | 實際證據 | Review |
|---|---|---|
| 火蜥蜴條件保證勇者劍，並避免可取回副本造成重複 | `simulation.ts`致死結算呼叫`canRespawnUniqueItem`，檢查居民inventory/equipment及仍有效WorldObject；有空格時最後一擊者取得並更新owner ledger，滿包時在該Node建立`unique: true`、`expiresAtT: null`物件；公開事件帶`uniqueHeroItemId`。三個simulation測例覆蓋滿包落地、有空格直接持有、已有持有副本時不重生 | 此來源明確條件獎勵切片通過。 |
| 通用戰鬥、擊殺獎勵與Boss剩餘規則 | 原有測例涵蓋一般怪最後一擊／滿包、巨龍+10HP；Boss1/2通行資格與其餘獎勵仍未完成 | 部分證據保留，未將 helper 或單一Boss情境當成完整驗收。 |

**驗證：** 火蜥蜴定向測試3/3通過；`npm run check` exit 0、`tsc --noEmit`通過、190/190 tests。

**結論： BLOCKED。** 本切片解除火蜥蜴唯一勇者劍runtime接線缺口；Cookie 3.1仍有Boss1/2資格／獎勵與未有來源資料的怪物掉落結果，且跨類型同SPD維持unresolved，故不能標DONE。

## Cookie 4.1 快速 Review（2026-10-21；歷史BLOCKED，已由下方覆寫）

**依據：** `PROJECT_BRANDING.md` Cookie 4.1 Crumbs、Reference 14、`ai/router.ts`、`ai/view.ts`、`ai/simulation-runner.ts`及現有router/view/runner測試。

| Crumb | 實際證據 | Review |
|---|---|---|
| action ID僅取自本輪快照；單一JSON；intent≤30字、text≤50字 | `router.test.ts`驗證允許/拒絕ID及長度；runner每次從當前WorldState重建action list | 已有證據。 |
| 可見actor type只限human/animal/monster，不洩露他人精確狀態/裝備/背包、整數時間；移動中不帶Node事件 | `view.ts`映射與`view.test.ts` Node-scoped/travelling/隱藏欄位測試 | 已有證據。 |
| JSON錯誤或ID錯誤不重試並愣神1T；報幕保留符合條件事件與持續狀態 | `router.test.ts`、`simulation-runner.test.ts`、`simulation.test.ts` runner/invalid reply與事件敘述測例 | 已有證據。 |
| 物件文字需READ後才呈現 | Reference 14:36、48明確要求告示牌／書籍／紙條執行READ後才把原文放入Node報幕；Reference 08:33允許碑文隨機讀取既有內容，08:34明示100+段文獻原文未存入本包。現有`WorldObject`無readable-text欄位，`availableActions`及dispatcher無READ action；容器表只有`告示牌`等item名，沒有內容 | 規則足以確定READ的觸發／呈現時點，但沒有可供讀取的原文資料或物件到內容的映射；不得捏造文本或假裝空值已完成閱讀。此Crumb仍未完成。 |

**結論： BLOCKED。** 大部分AI輸入/輸出邊界已有實測。READ的規則本身明確，但正文內容及可讀物件映射缺失；只有加action/schema仍無法滿足「讀後報原文」驗收。依序轉入可獨立的4.3成本記錄核對，不把READ標為已完成。

### Cookie 4.1 READ接線 Quick Review（2026-10-22；歷史狀態，現行Crumbs已移交／完成）

**範圍：** 依Reference 14讀後才呈現原文的規則，落實物件到文字ID與可用文字表的最小runtime契約；依使用者指示不創作正文，文字資料由使用者後續提供。

| Crumb | 現行證據 | Review |
|---|---|---|
| READ只使用目前Node可讀物件與當前提供的文字映射 | `WorldObject.readableTextId`對應`SimulationActionContent.readableTexts`；未有文字、空字串、純空白、非同Node、屍體或容器均不列出READ；結算再次驗證物件及文字映射 | 接線通過；沒有資料時fail-closed。 |
| 物件文字需READ後才呈現，READ耗時1T | `simulation.test.ts`定向案例驗證映射缺失與純空白都無READ；有效READ耗1T並生成`object-read` public event；`view.test.ts` formatter只在讀取事件後將原文送入Node報幕。讀前AI input不含測試文字，讀後報幕含文字 | runtime能力通過定向測例；未有production文字資料，因此沒有宣稱正式物件內容已可讀。 |

**Reference供稿狀態：** `04_生存物品與裝備.md`已明示固定文獻、告示牌、紙條原文及物件映射待使用者後續提供；無對應非空文字不提供READ、不報幕為已讀。

**驗證：** `node --experimental-strip-types --test --test-name-pattern="read action exposes mapped text" src/engine/simulation.test.ts`通過1/1；`npm run typecheck`通過；本輪完整`npm run check` exit 0，213/213。

**結論： BLOCKED。** READ schema、合法動作、1T結算與讀後呈現已接通；正式物件映射及正文仍待使用者提供，且Reference 08明示100+段文獻文字未存於現有資料。未捏造任何閱讀內容。

**當時狀態覆寫（後續再次修正）：** 使用者曾指定場景及掉落文字由其後續供稿；其後明確將正式文字寫入及映射責任移至7.1，因此本段的4.1 BLOCKED結論已失效。READ runtime切片本身已通過，無須自行產生內容。

### Cookie 4.1 空白書籍物件與獨立文字池 Quick Review（2026-10-22；歷史局部Review，後續定為DONE）

| Crumb | 現行證據 | Review |
|---|---|---|
| 可放置物件承載文字ID，且READ前不洩露空白內容 | `WorldObject.readableTextId`沿用既有欄位；正式`readable_documents.csv`有101個空白書籍文字槽，`書籍`catalog列標明可放置空白閱讀物件。production loader將空字串載入ID映射，定向simulation測試證明同Node空白書籍不提供READ | 空白物件與fail-closed讀取通過；沒有虛構正文。 |
| 書籍與漂流瓶使用獨立、等機率文件池 | `readable_document_pools.csv`明確分列book與drift-bottle；`readableDocumentPoolWeights`對所選池每項返回`1/N`，`selectReadableDocument`只從該池依uniform draw選取。測試證明新增第N+1項後自動變為`1/(N+1)`，不串池；正式漂流瓶文件列數為0，狀態reserved_future_no_formal_gameplay | 等機率選文與池隔離通過；漂流瓶只預留、未啟用玩法。 |
| READ後才呈現非空正文 | `simulation.test.ts`既有fixture測試以測試文本驗證1T READ與讀後報幕；production空白槽不提供READ | READ流程fixture通過；正式文字等待使用者供稿。 |

**邊界：** 本slice只提供文件池等機率選取契約，不新增書籍實例生成流程。書籍來自地牢深處刷新、漂流瓶來自海灘刷新，故使用不同文件池避免來源與資訊混用；不新增漂流瓶刷新或玩法。現有WorldObject文字ID欄位可承載空白書籍物件，production空白映射不會觸發READ。

**驗證：** 定向`document-pools.test.ts` 2/2、`content/actions.test.ts` 1/1、`simulation.test.ts`（READ兩案例）通過；均分改為等機率選取後定向測試2/2及`npm run typecheck`通過。picker改動後完整`npm run check` exit 0，typecheck通過，218/218。當時因供稿將4.1列BLOCKED，已由最新使用者決定覆寫。

## Cookie 4.2 初次快速 Review（2026-10-22；已由下方更新覆寫）

**依據：** `PROJECT_BRANDING.md` Cookie 4.2 Crumbs；`domain/social.ts`、`engine/simulation.ts`、`ai/simulation-runner.ts`、`ai/view.ts`及對應測試。

| Crumb | 實際證據 | Review |
|---|---|---|
| 公開發話耗1T，收件者下次行動可見；旁觀者按已核准範圍可見；不鎖住/強制回覆 | `simulation.test.ts`驗證訊息action成本1T、公開事件落地且收件者時點未改；`view.test.ts`驗證同Node收件者下一行動能看到公開訊息；sender/recipient限定同Node。`social.ts`將訊息限制1–50 Unicode字元 | 這個same-Node訊息slice有測試證據；跨Node範圍仍未決，不擴張。 |
| 交易請求/回應耗行動時間且競態不複製物品 | 初次盤點時`social.ts`有domain helper但`simulation.ts`未接dispatcher；其後使用者明定發起方指定提供與索取物品、對方接受或拒絕，詳下方更新 | 初次盤點缺口已於下方補完，不能再視為現況。 |

**初次結論： BLOCKED。** 此段為協議明確前的歷史狀態；現況以緊接的更新為準。

### Cookie 4.2 Quick Review 更新（2026-10-22；已被後續停用決定取代）

**正式範圍：** `PROJECT_BRANDING.md` Cookie 4.2 Crumbs；交易協議採使用者明確決定：發起方指定提供物品與索取物品，收件者接受或拒絕。

| Crumb | 實際證據 | Review |
|---|---|---|
| 發話與回覆各耗1T；不鎖住或強制對方回覆 | `simulation.test.ts`驗證公開訊息不改變收件者時點；交易請求只推進發起方，接受／拒絕各推進回覆者1T | 通過。 |
| 收件者下次行動看到訊息；旁觀者依已核准邊界可見 | `view.test.ts`既有測例驗證命名收件者下次行動看到同Node公開訊息；本次交易事件為public且含雙方與指定物品 | 同Node現有路徑有測試；跨Node即時傳播仍明確保留未決。 |
| 發起方明確指定提供/索取，收件者可接受/拒絕 | `availableActions`列出發起者自己的提供物與收件者，不列出收件者背包；發起者在文字欄指定索取物，dispatcher只接受來源food/equipment目錄項目。pending offer只向指定收件者提供accept/reject actions，simulation保存offer，事件公開記錄指定物品 | 通過。 |
| 物品不因競態複製；唯一物品所有者一致 | 接受時重新驗證雙方、同Node與當前庫存，交換作為一次state settlement；定向測試覆蓋勇者劍owner ledger轉移及收件者已失去索取物品時拒絕提交，拒絕流程不動庫存 | 通過。pending offer存入WorldState；本次未單獨重跑交易快照磁碟重開測試。 |

**實際驗證：** 交易runtime定向測試3/3通過；先前無request action時測試失敗，接線後通過。最新`npm run check` exit 0，typecheck通過、186/186 tests通過。

**歷史結論： DONE（已撤回）。** 本段記錄當時協議與驗證，不再代表現況。

### Cookie 4.2 交易停用 Quick Review（2026-10-22；歷史BLOCKED，現行決策已完成）

**現行決定：** 使用者因交易會洩露情境外資訊並增加上下文負擔，要求先停用交易、等待重新設計。Reference 00/08/01已標示此覆寫或舊白名單狀態。短訊與丟棄物品維持可用。

| 驗收邊界 | 實際證據 | Review |
|---|---|---|
| 不提供交易請求／接受／拒絕合法動作 | `availableActions`已移除兩類交易actions；定向測試確認不在列表 | 通過停用邊界。 |
| proposal不可繞過合法動作校驗 | 測試直接提交舊格式交易request與pending offer accept proposal；均由`settleNextAction`回報not currently legal，state、庫存、pending offer不變 | 通過。 |
| 丟棄及公開短訊仍可用 | 同一測試確認`drop:普通魚`及`message:resident-02`仍在合法動作 | 通過。 |

**驗證：** 新定向測試先在舊交易actions存在時失敗，再於移除actions與交易dispatcher後通過；停用回歸1/1。最新`npm run check` exit 0、typecheck通過、214/214，包含該停用測試。完整Cookie 4.2交易Crumb目前依使用者決定暫停，非DONE；待交易重新設計後再評估，不把舊實作當現行能力。

**當時結論（已被下方狀態覆寫）： BLOCKED。** 執行端交易關閉已核實；使用者後續明確將停用決策本身作為4.2現行完成狀態，現不列BLOCKED或待辦。

## Cookie 4.3 快速 Review（2026-10-22；歷史狀態，已由下方更新取代）

**依據：** `PROJECT_BRANDING.md` Cookie 4.3 Crumbs；`ai/router.ts`、`ai/budgeted-provider.ts`、`ai/model-settings.ts`、`persistence/sqlite-store.ts`及相關測試。未新增價格或模型資料。

| Crumb | 實際證據 | Review |
|---|---|---|
| 10個可配置槽、不預設live AI；key只留server記憶體 | `model-settings.test.ts`、`observer.test.ts`、`observer-adapter.test.ts`覆蓋10槽、設定與key不進持久化/回應；ProcessModelSecrets只按credential reference存process map；未配置時runner停止呼叫 | 有測試證據。 |
| 傳輸錯誤最多retry 2次且不耗遊戲T；格式/ID錯誤不retry並愣神1T | `router.test.ts`覆蓋最多3次transport requests（初次+2 retry）、格式錯誤不切備援；`simulation-runner.test.ts`與`simulation.test.ts`覆蓋無效回覆的1T結算 | 有測試證據。 |
| Primary連續三次失敗轉使用者設定fallback；fallback 10次有效行動後probe primary | `router.test.ts`的health及fallback路徑測例覆蓋3次失敗與10次有效行動 | helper/Router層有證據。 |
| 記錄prompt/output/retry/message/biography成本；月上限US$20硬阻擋 | `sqlite-store.test.ts`、`budgeted-provider.test.ts`驗證保留額度、實際用量結算、缺usage保守結算與超額前阻擋。但實際`BudgetedModelProvider`只建立`category: 'prompt'`記錄；`settleProviderCost`分類helper沒有呼叫點，message/biography也沒有AI呼叫路徑 | 部分金額限制有證據；分類記錄Crumb未完成。不能把同一prompt類記錄當作其餘分類完成。 |

**更新（2026-10-22）：** `src/ai/budgeted-provider.ts`現將一次action請求的input token成本與output token成本分成`prompt`／`output`兩筆記錄，仍以單一預留額度和單次settle原子落庫；`src/ai/router.ts`把transport attempt是否retry傳給provider，使後續attempt標為`retry`。`message`／`biography` operation分類已由provider interface可接入並有分類單測，但production目前沒有訊息或傳記模型呼叫路徑；不得將單測當成該兩種實際成本已產生。SQLite測試直接讀回`record_json`確認分類陣列持久化。

**更新後驗證：** `node --experimental-strip-types --test src/ai/budgeted-provider.test.ts src/ai/router.test.ts src/persistence/sqlite-store.test.ts` 21/21；完整`npm run check` exit 0、typecheck通過、181/181。

**結論： BLOCKED。** prompt/output/retry production分類及資料庫落地已有證據；message／biography缺production呼叫路徑，故Cookie 4.3仍不可DONE。未配置價格及模型槽依正式fail-closed規則處理，非待補來源數值。

### Cookie 4.3 message成本接線 Quick Review（2026-10-22；歷史狀態，Biography佔位已由下方覆寫）

| Crumb | 現行證據 | Review |
|---|---|---|
| 同一次action proposal若選擇文字動作，記為message成本 | Router把本輪`requiresText` action ID傳給provider；BudgetedModelProvider只在合法JSON形狀、有效字數及message ID一致時，將該次input/output總成本記為一筆`message`；一般action仍拆成`prompt`/`output`，錯誤格式不誤分類，retry仍記`retry` | production成本路徑已接線；router context及provider分類定向測試通過。 |
| 死亡後以`intend bio`設定模型生成玩家專屬傳記並記傳記成本 | 使用者明確決定`intend bio`維持空白；不配置模型、不觸發死亡後Biography生成、不猜模型ID。`settleResidentBiography`僅處理明確傳入文字，不是模型呼叫。 | 自動生成Crumb依使用者決定明確暫緩，Cookie 4.3保持BLOCKED；目前不等待格式檔路徑或模型值，也不需追問。 |

**驗證：** Router message ID傳遞1/1、BudgetedModelProvider同次message分類1/1；`npm run typecheck`通過；本輪完整`npm run check` exit 0，213/213。4.3仍保留既有價格／備援設定及$20月上限fail-closed邊界。

**當時結論（已被下方狀態覆寫）： BLOCKED。** message成本已按有效文字action proposal實際寫入分類；Biography配置保持使用者手動設定的空白佔位，未配置時沒有模型呼叫。本段舊BLOCKED判斷已失效。

**2026-10-22使用者覆寫（配置與狀態現況）：** `intend bio`配置位置保留為空白手動配置佔位，目前沒有已選模型、不觸發死亡後模型生成、不猜模型ID；空白狀態下沒有Biography模型呼叫。既有外部Biography settlement只處理明確傳入文字，不代表自動模型呼叫。使用者將此「手動配置、空白時不呼叫」設為現行政策，4.3不列BLOCKED；文字action成本仍歸到同一次既有模型proposal呼叫。

## Cookie 5.2 Quick Review（2026-10-22；歷史狀態，已由後續更新取代）

**正式範圍：** `PROJECT_BRANDING.md` Cookie 5.2 Crumbs：代次隔離、seeded出生點、私有intent、死亡世界痕跡與玩家專屬傳記、十名人口及次日早晨補人。

| Crumb | 實際證據 | Review |
|---|---|---|
| 新代次不繼承前代記憶／人格 | `WorldActor.id`含代次；新生Actor由`settleNextTimerEvent`以fresh vitals、空inventory和獨立actor ID生成；AI view只讀當世actor key的private intent。`simulation.test.ts`驗證新代次狀態，`view.test.ts`驗證不把前代／他人intent送入AI | 通過已實作隔離路徑。 |
| 新生者按已記錄seed從Node 1/8/13抽出生點，不沿用前代位置 | `world.ts`使用seeded draw及`START_BEACH_NODE_IDS`；`world.test.ts`驗證出生點分佈／抽取記錄；`simulation.test.ts`驗證次日新代出生於海灘 | 通過現有出生路徑測例。 |
| intent保留至死亡但不進客觀事件 | 行動結算以privateLifeData保存intent；死亡結算把其標為pending；公開action event不含intent；view測例排除private-intent | 通過現有可查證據。 |
| 死亡後可刪個人原始上下文但保留世界痕跡 | 日生存致死測例驗證永久屍體、裝備／背包物件保留且intent仍pending；`settleResidentBiography`完成時清空intent | 通過死亡記錄及清除路徑。 |
| 傳記僅玩家可見，不改客觀事件或餵給新居民 | `simulation.test.ts`驗證`player-only` biography event、完成時刪intent；`view.test.ts`將玩家傳記與AI輸入分開 | 通過已測隱私界線；未聲稱自動傳記模型生成已接線。 |
| 維持十名目標人口並按來源次日早晨補人 | timer resolver按空缺slot在dawn產生新代；單名死亡測例確認死亡當晨不立刻補、至次晨補回一位 | 單一死亡路徑有證據；來源未定同一夜多人死亡的補人批次與缺額恢復數量／順序（C-14），故完整Crumb仍未通過。 |

**驗證：** 本次只讀引用既有測例與實作，未重跑測試。沒有依C-14自行決定同晨一次補足全部缺額或逐名補人的處理方式。

**歷史結論（已被下方更新取代）： BLOCKED。** 當時C-14尚未由使用者指定；使用者於2026-10-22後續明確決定次日晨一次補足至10人。

### Cookie 5.2 Quick Review 更新（2026-10-22；DONE）

**範圍：** `PROJECT_BRANDING.md` Cookie 5.2 Crumbs；C-14依使用者明確決定：「次日晨一次補到10人」。本次檢查世代隔離、死亡痕跡、次晨批次補足及既有個人資料權限測例。

| Crumb | 實際證據 | Review |
|---|---|---|
| 新世代不繼承前代記憶／人格，使用新生命資料及記錄seed出生 | 既有`world.test.ts`與`simulation.test.ts`覆蓋fresh vitals、空inventory、seeded出生點及模型生命綁定 | 通過。 |
| intent私有保存；死亡保留屍體等世界痕跡，傳記僅玩家可見並可在完成後清除個人原始上下文 | 既有`simulation.test.ts`、`view.test.ts`覆蓋私有intent、永久屍體／物件、player-only傳記與完成後清除 | 通過既有驗證。 |
| 次日晨一次補足至十名 | 新增`simulation.test.ts`測試：兩個slot在同夜於T60死亡，單次T72 `daily-survival-settled`批次建立兩個generation 2居民，結果存活居民總數10；事件`newGenerations`按slot列出兩位新居民 | 通過。現有同一次dawn timer遍歷空缺slot並建立補位，本次補入多人同夜情境回歸測例。 |

**驗證：** 定向多人死亡測試1/1通過；`npm run check` exit 0、`tsc --noEmit`通過、191/191 tests。

**結論： DONE。** C-14由使用者決定一次補足至10人，已以同一dawn結算批次驗證。這是Cookie 5.2局部Quick Review，不表示Bag 5所有內容或模型傳記自動生成皆完成。

## Cookie 5.1 快速 Review（2026-10-22；DONE）

**依據：** `PROJECT_BRANDING.md` Cookie 5.1 Crumbs；`persistence/sqlite-store.ts`、`persistence/schema.ts`、`persistence/snapshot-migration.ts`、`engine/simulation.ts`及相關store/simulation測試。

| Crumb | 實際證據 | Review |
|---|---|---|
| 客觀事件可追查時間、角色、Node、結果、可見性、抽取資訊 | `WorldEvent`保存`worldTimeT/actorId/nodeId/kind/payload/visibility/randomDraws`；store原子批次測試讀回事件，抽取資訊以randomDraws JSON保存 | 通過。 |
| 重啟恢復世界狀態；亂數結果可重播 | `simulation.test.ts`磁碟重開測試核對snapshot sequence/RNG state及事件randomDraws，並以同初始狀態重跑比較抽取；舊snapshot升級在讀取時不改原始快照 | 通過。 |
| 永久文字、屍體、交換物品及物件到期狀態不依賴角色記憶刪除 | 新增`sqlite-store.test.ts`檢查交換後inventory、永久屍體、`expiresAtT`及含文字的公開事件讀回；死亡/交換對象狀態在完整WorldState snapshot，公開文字事件進追加歷史 | 通過目前正式模型所涵蓋的資料。 |
| 實際schema欄位待設計審核 | 僅使用Bag Review核准的內部versioned store；未把欄名或遷移流程宣稱為外部schema | 符合D-002邊界。 |

**結論： DONE。** 定向store/simulation測試42/42；`npm run check` exit 0、typecheck通過、171/171。這不代表Cookie 1.2所需的地牢runtime dispatcher已完成；其runtime接線另依3.3/1.2處理。

## Cookie 6.1 快速 Review（2026-10-22；DONE）

**依據：** `PROJECT_BRANDING.md` Cookie 6.1 Crumbs；Reference 03A/15；`ui/observer-adapter.ts`、`ui/observer.ts`、`ui/observer.css`與adapter/render/server測試。

| Crumb | 實際證據 | Review |
|---|---|---|
| 28 Node拓樸與51條來源道路 | `observer-adapter.test.ts`以source graph建projection，核對Node數、位置與51條邊 | 通過。 |
| 可查居民代次、模型、HP/飽食、裝備/背包、上一行動與行動結果 | adapter逐欄由persisted resident映射；新增`lastActionResult` mapping與render測試，核對結果可見 | 通過。 |
| 玩家可見資料不等於居民彼此可見資訊 | UI只讀player projection並明示玩家觀察界線；AI資料另由`ai/view.ts`的Node-scoped allowlist建構，不共用此投影 | 通過。 |
| Node與居民代次編號清楚區分；位置/場景標籤保留確定度 | 地圖/居民頁分別標`Node`和`居民`，`labelStatus`在地點標題呈現；unknown名稱顯示來源未定 | 通過。 |
| 單窗切換頁面、動態格線與字級 | `observer.ts`單一shell含tab/tabpanel；`server.ts`提供點選與鍵盤tab切換；`observer.css`以`clamp()`字級及viewport media query調整格線 | 通過程式與DOM/HTTP證據；未聲稱獨立美術設計。 |

**結論： DONE。** UI/adapter定向測試9/9；`npm run check` exit 0、typecheck通過、172/172。未新增模型可見資料或居民行動控制。

## Cookie 6.2 快速 Review（2026-10-22；DONE）

**依據：** `PROJECT_BRANDING.md` Cookie 6.2 Crumbs；Reference 08/09/15；`ui/observer-adapter.ts`、`ui/observer.ts`、`ui/server.ts`與observer adapter/render HTTP測試。

| Crumb | 實際證據 | Review |
|---|---|---|
| 時間線只展示已結算客觀事件 | adapter從追加式`readEvents`投影，只接受`public`或`player-only`；private intent不會進事件列表 | 通過。 |
| 公開短訊按核准範圍呈現 | 新增測試證明已結算`public-message-sent`文字呈現於玩家觀察時間線；事件不回灌AI視野。居民同Node可見限制維持在4.2，不新增跨Node居民廣播規則 | 通過玩家觀察範圍。 |
| 死亡傳記只供玩家看且不改客觀世界 | adapter僅從`player-only` `biography`事件投影；UI另列「僅玩家可見」；`settleResidentBiography`保存傳記事件並清除個人intent，不修改既有事件 | 通過。 |
| 暫停/恢復/調速控制 | production server將runner注入控制port；新增HTTP測試核對pause、resume及白名單speed請求到達控制port；未配置倍率時UI不造倍率 | 通過。 |
| 單窗切頁、模型設定槽與key邊界 | DOM含單一tab shell；10槽僅一個可見；既有HTTP測試確認key不進持久化及response、key只放process secrets | 通過。 |
| 動態格線/字級試用 | CSS以viewport media query切換格線、`clamp()`調整字級；保持既有低保真排版，不添加來源外互動 | 通過程式證據。 |

**結論： DONE。** UI/adapter定向測試11/11；`npm run check` exit 0、typecheck通過、174/174。D-008未被擴寫為居民跨Node可見規則。

## Cookie 7.1 Quick Review（2026-10-22；DONE）

**正式範圍：** `PROJECT_BRANDING.md` Cookie 7.1 要求跨 Bag 契約Review，並區分規格可核、需執行驗證及來源待決；Crumbs明確禁止把計畫驗收當程式、API、瀏覽器或長期平衡通過。此狀態表示Review交付完成，不代表各被Review的前置Cookie全數DONE。

| Crumb | 可查證來源 | Review |
|---|---|---|
| 72T排程與行動成本 | `EXECUTION_LOG.md` Cookie 1.1列`clock.ts`／`simulation.ts`及既有測試；其記錄的`npm run check` 160/160是當時版本結果 | 規格／程式測例有歷史驗證證據；未在本次重跑。 |
| 分層事件池與生產遭遇率 | Cookie 2.3記production Node 1/9/24/6、30/35/35/30與4:6測試18/18；Reference 06與`surface.test.ts` | 已知規則及資料路徑有證據；來源未映射Node及具體原池結果仍按Reference保留未知。 |
| 唯一裝備與持久化 | Cookie 1.2/5.1的實作、SQLite測例及各自快速Review | 唯一授獎／存檔切片有測例；地牢主流程仍未整合，故不宣稱全世界端到端授獎完成。 |
| 權限可見性與模型介面 | Cookie 4.1–4.3記錄隱藏他人HP／背包、公開事件及設定/key邊界；4.1 READ runtime、4.2交易停用政策、4.3 message成本與空白Biography配置佔位依末段Review更新 | 依現行決策均DONE；正式遊戲文本移至7.1，7.3承接AI提示／回傳格式微調。 |
| 隨機重播與客觀歷史 | Cookie 5.1及`sqlite-store.test.ts`記錄磁碟關閉重開、事件draw與snapshot測試 | 已接通儲存路徑有證據；沒有據此推稱所有行動dispatcher都已完整接入。 |
| UI唯讀邊界 | Cookie 6.1/6.2的adapter、render與HTTP測試記錄；最新全檢曾為typecheck通過、174/174 | 投影／唯讀控制切片有程式及測試證據；未宣稱瀏覽器人工驗收或美術完成。 |
| 未決項可追溯 | `DESIGN_DECISIONS.md` D-002、D-005–D-008、D-011等及Reference 03/05/07/08/11/15；詳本Review前述矩陣 | Review中保留來源路徑／決策號；不以推定填補缺值。 |

**結論： DONE（跨 Bag 契約與證據分類Review）。** 這不是整體產品或端到端模擬完成聲明。實作／依賴缺口仍以`EXECUTION_LOG.md`各Cookie當前列為準；歷史命令結果保留其原執行日期和測試數，不視為本次重跑。

## Cookie 7.2 Quick Review（2026-10-22；DONE）

**正式範圍：** `PROJECT_BRANDING.md` Cookie 7.2要求來源導覽能回到每個Cookie的來源、現行值、歷史差異與未知項，並維護狀態標籤。

| Crumb | 可查證來源 | Review |
|---|---|---|
| 19份Markdown與16份CSV有明確來源覆蓋 | `PROJECT_BRANDING.md`「Reference來源索引」列出19個Markdown路徑及16個CSV路徑；`COOKIE_REVIEW.md`「來源要求覆蓋矩陣」逐檔標註計畫對應與覆蓋判斷 | 通過文件索引核對；索引所述為ZIP內來源清單，不代表本工作區有解壓副本。 |
| 定案、核對摘要、推導、待回查及歷史作廢可區辨 | `PROJECT_BRANDING.md`來源索引矩陣、來源覆寫／待回查導航；`DESIGN_DECISIONS.md`決策狀態及C/M追溯；`COOKIE_REVIEW.md`各Cookie證據表 | 通過；來源certainty與未決項有明文標籤。 |
| 岩縫歷史15/15/70已退役，現行5/5/90 | `DESIGN_DECISIONS.md` C-17及第100行歷史提醒；`PROJECT_BRANDING.md` Cookie 2.3 Crumb列5/5/90；來源矩陣註明舊值作廢 | 通過，歷史值未冒充現行。 |
| 容器出貨遵循D-006 | D-006現行覆寫、兩份容器池CSV皆為`user_confirmed_one_item_per_item_container`；domain測試逐七來源斷言一次分類抽取加一次子池抽取、結果恰一件且`provisional:false` | 通過；使用者確認所有含物品容器每次一件，權重不變。 |

**結論： DONE（來源追溯與維護索引）。** 此Review確認現有計畫文件的索引及標記，不表示ZIP附件內容在本輪重新解壓比對；程式或運行狀態依各Cookie執行記錄，不由索引推定。

## Cookie 3.2 Quick Review（2026-10-22；BLOCKED）

**正式範圍：** `PROJECT_BRANDING.md` Cookie 3.2 Crumbs（普通怪、Boss與特殊戰鬥行為）。本次只驗收來源表已定義的熔岩史萊姆反傷結算切片，不把後續地牢拓樸或掉落事件池併入本Cookie。

| Crumb | 實際證據 | Review |
|---|---|---|
| 已知攻擊分佈總率100% | `src/domain/monsters.test.ts` 驗證有來源列的19種怪物攻擊分佈總率；`npm run check` 本次178/178通過 | 通過測試證據。 |
| 綠矮人／火翼蝙蝠每場最多召喚一隻 | `simulation.ts` 攻擊結算只允許來源表中的綠矮人／火翼蝙蝠，在存活且HP≤30%時生成完整能力同類；遭遇ID保存單場上限，召喚物標記禁止連鎖。定向simulation測例驗證綠矮人召喚及完整測試通過 | 已覆蓋此召喚切片；其他 encounter integration 仍按來源資料分別驗收。 |
| 巨鼠／火翼蝙蝠雙擊各自抽傷 | `src/domain/monsters.test.ts` 測巨鼠每擊獨立選目標／傷害；`simulation.test.ts` 以production火翼蝙蝠來源列經主world event queue驗證兩擊及各自抽籤 | 本次來源可驗雙擊均有測試證據。 |
| 史萊姆反傷包含致死擊並與普攻相加 | `src/engine/simulation.ts` 使用production `attack_distributions.csv`在同次居民attack settlement先結算普通攻擊，再抽反傷；`simulation.test.ts` 驗證熔岩史萊姆被擊殺後仍反傷。另一測例驗證反傷致死居民同次建立永久屍體，intent保留為pending biography。此測試先因死亡被標成active而失敗，修正後通過 | 通過本次涵蓋的熔岩史萊姆反傷切片；不外推到未串接的其他FSM。 |
| Boss勝利門檻及在場存活者資格正確 | 巨龍致死攻擊接入`planBossVictoryRewards`，以同Node存活居民驗證最後一擊者並結算+10HP；`simulation.test.ts`定向測試命中前HP20→30且怪物死亡。Boss1/2通行資格與隨機防具獎勵尚未接入；Boss2五次有效防禦突破仍需釐清未定的20%命中率判定次序 | 巨龍已知獎勵切片通過；整體Boss Crumb未通過。 |
| 森林野豬設計值標示為user-request-derived | `PROJECT_BRANDING.md`／Reference維持該來源標記；本次沒有改動其數值或來源屬性 | 保持來源標籤；非本次程式驗收項。 |
| 居民相同SPD依D-013次序裁決 | `src/engine/tie-break.test.ts` 驗證同速欄位優先及完全平手seeded重播；同一完整檢查通過 | 通過已測居民排程規則。 |

**實際驗證：** `node --experimental-strip-types --test src/engine/simulation.test.ts src/domain/monsters.test.ts` 當時60/60通過；新增巨龍獎勵測例先紅（擊殺後HP仍20），接線後通過。最新`npm run check` exit 0，typecheck通過、187/187 tests通過。

**結論： BLOCKED，不是DONE。** 來源明確且已實作的召喚限制、火翼蝙蝠雙擊、熔岩史萊姆反傷、巨龍最後一擊+10HP均有runtime測試證據；Boss1/2通行資格及獎勵尚未完整接線，Boss2有效突破次序與C-05龍傷害細分、C-06熔岩飛濺權重、C-07 Boss2命中率適用方與次序仍按來源缺口保留，本次未推定。

## Cookie 3.3 Quick Review（歷史狀態；後續Review已取代）

**正式範圍：** `PROJECT_BRANDING.md` Cookie 3.3 Crumbs：三層主事件池、直遇普通怪、第二層額外水道遭遇、第三層火山彈位置限制、九種怪額外掉落、7類容器／46項有效率，以及勇者唯一裝備回歸條件。依父任務限定，本次只核對既有介面與接線，不擴寫runtime。

| Crumb | 實際證據 | Review |
|---|---|---|
| 每層事件池100%、直遇普通怪50% | `src/domain/dungeon.test.ts` 核對三層來源池總率；`src/engine/dungeon-runtime.test.ts` 的單格resolver測一次來源權重抽取 | 來源池與helper局部通過；`simulation.ts`沒有調用地牢resolver，未達生產事件驗收。 |
| 第二層水道額外遭遇不扣主池50% | domain測例核對水道條件；runtime helper測同一resolver結果同時產生主事件與額外黏液怪事件 | helper通過；沒有主simulation事件入口和持久化驗收。 |
| 第三層火山彈只在A1/B1/C1 | domain測例驗證範圍門檻及其他格不消耗RNG；resolver測例對未允許格保持狀態 | 純resolver條件通過；未由正式地牢行動流程觸發。 |
| 九怪額外掉落總率正確且勇者劍保證獎勵分池 | `src/domain/dungeon.test.ts`核對九列率及火蜥蜴炸彈池與勇者劍分離；3.1居民最後一擊掉落已有測試，但地牢事件池未接主流程 | 資料／局部掉落helper通過；Cookie整體事件與獎勵鏈未通過。 |
| 7類容器及46項有效率按雙層比例計算、保留provisional one item | domain測例核對七類來源、子池及46項有效率；resolver單測建一個72T `provisional: true` container object | 權重資料與物件草稿局部通過；容器尚未由生產地牢dispatcher建立／持久化。 |
| 勇者裝備全世界唯一；僅不可取回時按來源回歸 | 物品domain測例核對唯一回歸條件；通用唯一裝備移交／owner ledger已有獨立simulation測例 | helper與通用移交單測通過；地牢回歸觸發條件及事件流程未驗收。 |

**主流程缺口：** `DungeonRuntimeState`／`resolveDungeonRuntimeStep`在`src/engine/dungeon-runtime.ts`是獨立介面，`enter-cell`僅出現在其測試；主`simulation.ts`只宣告可選`dungeonEvents`內容欄位，無地牢進格action dispatcher、WorldState地牢欄位、行動結算調用或SQLite同批事件／狀態寫入。故上述純helper的測試不能代表真實Actor到格、抽取、生成WorldObject／monster actor和同批持久化。

**依賴／未知：** Bag 1.2地牢WorldState與原子主流程尚被未定的cell拓樸來源阻塞；Cookie 3.1戰鬥結算及3.2怪物FSM仍未完整。D-005商品別名待來源核對／核准，D-006容器一次出貨仍provisional，D-007第三層非A1/B1/C1火山彈8%去向待決；未代填任何拓樸、物品別名或權重。本次未跑測試，引用現有測例名稱及原執行記錄，不聲稱新驗證。

**結論： BLOCKED，不是DONE。** 所需缺口是主simulation／WorldState／持久化接線與其前置依賴；已存在的資料、resolver及測例提供局部證據，未構成完整Cookie接受條件。

### Cookie 1.2 Quick Review更新（2026-10-22；拓樸與主流程接線）

**範圍：** 正式 Cookie 1.2 Crumbs、使用者提供的三層相同拓撲、DungeonRuntime／simulation／SQLite action commit。此節取代先前所有「缺拓樸、入口或主WorldState接線」的現況判斷；較早的BLOCKED記錄保留作歷史。

| Crumb | 最新可查證證據 | Review |
|---|---|---|
| 掉落／移交、唯一裝備全域檢查單次原子結算 | `simulation.test.ts`既有DROP/GIFT／唯一持有測例；`sqlite-store.test.ts`事件與snapshot同批、衝突rollback | 通過。 |
| 普通物件及未開容器生成後72T到期；自然椰子、屍體、碑文及勇者唯一裝備例外 | 既有`survival.test.ts`、`simulation.test.ts`到期排程；本次端到端案例由正式`dungeon_events.csv`抽中「遺失背包」，生成期限物件並在snapshot讀回 | 通過。 |
| 屍體取放各1T，搬運不加收跨Node成本 | `simulation.test.ts`搜刮、搬起、放下及隨移動攜帶測例 | 通過。 |
| 事件保留抽取資訊並可重播 | 本次地牢動作事件把抽取draw與Dungeon事件草稿一併記錄；SQLite測試讀回事件／snapshot，既有重開及rollback測例覆蓋重播與原子性 | 通過。 |
| 地牢行動、位置、事件和建立物件同批進入WorldState／SQLite | `simulation.test.ts`：Node 21提出進入動作，seed `00002400` 按正式CSV選出容器，commit後讀回cell S、visited state、container WorldObject、抽取draw；同一store再結算S→A1並讀回新cell。`simulation-runner.ts:126,167`將合法動作和action content交給相同settlement入口。 | 通過。 |
| Cell拓樸、入口與Boss cell映射 | `dungeon-runtime.test.ts`：三層共用S→A/B/C1→A/B/C2→E，每條路徑到E為3步；S入口、E由cell ID辨識Boss；非相鄰移動不改state且不抽RNG | 通過；映射採用使用者ASCII的直接解讀。 |

**驗證：** `node --experimental-strip-types --test src/engine/dungeon-runtime.test.ts` 7/7；simulation端到端定向 1/1；`npm run check` exit 0，typecheck通過，194/194。

**邊界：** 此Quick Review僅裁定Cookie 1.2。進入Boss cell目前辨識E且不抽普通事件池；Boss actor/FSM、樓層解鎖／切換和Boss獎勵仍由Bag 3相關Cookie處理，本Review不宣稱其完成。SimulationRunner將該action content和proposal交由已測的共用settlement/commit入口；本輪沒有另跑外部AI provider。

**結論： DONE。** 正式1.2 Crumbs均有現行程式或可重現測例支持；先前以拓樸和dispatcher缺失為由的BLOCKED判斷已被本次接線及用戶提供拓撲取代。

### Cookie 3.1 Quick Review更新（2026-10-22；範圍與剩餘Crumb校正）

**正式範圍：** `PROJECT_BRANDING.md` Cookie 3.1通用戰鬥、速度與傷害結算Crumbs。此節取代較早將Boss1/2通行資格與勝利獎勵列為3.1缺口的判斷：正式計畫將Boss特殊行為／勝利資格置於Cookie 3.2，地牢Boss cell事件置於Cookie 3.3。

| Crumb | 最新證據 | Review |
|---|---|---|
| 玩家命中傷害`max(1, ATK-DEF)`；怪物傷害`max(0, raw-DEF)` | `domain/combat.ts`及定向測例；主simulation attack/monster-turn測例 | 通過。 |
| 怪物和居民共用時點／SPD佇列；普通怪行動後1T；居民同SPD按D-013 | `nextWorldEvent`、`tie-break.ts`、`simulation.test.ts`排程案例；本次完整檢查通過 | 通過已定規則。居民與怪物跨類型同SPD按Crumb保持unresolved，這是規格要求，不是阻塞缺口。 |
| 來源獨立選擇多次攻擊目標；龍息群體 | `resolveMonsterAttackAction`每擊選擇仍存活目標；但`drawDragonActionMode`僅產生爪／息mode並回傳C-05 damage unresolved，`resolveScheduledMonsterTurn`尚未將龍息作用於同Node全員 | 未通過；需先依使用者「代試算」授權決定C-05原始傷害權重，再完成群攻接線。 |
| 撤退路線、阻路怪、黏液怪限制 | 現有routeHistory及`simulation.test.ts`路線／阻擋測例 | 通過。 |
| 擊殺獎勵按最後一擊、包滿落地、唯一劍條件 | 一般怪來源額外掉落、火蜥蜴勇者劍及巨龍+10HP已有simulation測例；抽取結果寫公開事件 | 已有來源列的通用戰鬥獎勵通過。Boss1/2防具與通行資格不是3.1 Crumb，於Cookie 3.2檢查及接線。 |
| 戰鬥結果公開並回饋AI | `monster-action-settled`／`resident-attacked`和`ai/view.test.ts` previous result案例 | 通過。 |

**本次驗證依據：** 本輪`npm run check` exit 0，typecheck通過，194/194；定向dragon/C-05尚未重跑或完成，故不把全檢結果當成dragon群攻通過證據。

**結論： BLOCKED。** 唯一定位的3.1剩餘Crumb是龍息群攻runtime缺口，依賴C-05原始傷害權重；同SPD跨類型依規格保持unresolved已符合要求。依Cookie順序先完成3.2允許的C-05—C-07試算，再回到3.1接線及快速Review。

## 2026-10-22 3.2 同格Boss排程增補（只Review已完成slice）

本增補取代前節對「1.2拓樸未定」及C-05資料未定的舊判斷；不代表Cookie 3.2整體DONE。正式Crumb仍依 `PROJECT_BRANDING.md` Cookie 3.2（普通怪分佈、召喚／雙擊／反傷、Boss勝利門檻與在場存活者資格）。本輪依使用者已提供C-05規則實作龍息／利爪排程路徑；C-07 Boss2及Boss1特殊條件仍待接線。

| 此 slice 驗收項 | 實作及執行證據 | Review |
|---|---|---|
| 移動結算抵達 Boss E 並建立Boss actor | `simulation.ts`的`dungeon-move` settlement將角色更新到E並建立來源`monsters.csv`中的巨龍`WorldActor`；測試`entering the dungeon Boss cell enqueues a scheduled attack against only same-trip, same-floor, same-cell residents`實際由A2移至E後讀到Boss actor | 通過本slice。 |
| Boss進入共用世界事件佇列並結算行動 | Boss actor使用來源SPD及`nextActionAtT`進入`nextWorldEvent`，`settleNextTimerEvent`呼叫`resolveScheduledMonsterTurn`並寫出`monster-action-settled`及隨機抽取記錄；同一端到端測試確認下一個事件為`monster-action`並完成結果事件 | 通過本slice。 |
| Boss攻擊只作用於同一次地牢遭遇的目標 | Timer target filter對有`dungeonLocation`的怪物要求resident trip、floor、cell三者相同。新增測試固定seed先失敗：同Node、另一floor居民HP從30降至10；接線後定向測試通過，該居民HP不變，同floor/cell目標受擊 | 通過本slice。 |
| Dragon C-05群攻分佈 | `resolveScheduledMonsterTurn`對每名存活同cell參戰者獨立抽龍息傷害；`monsters.test.ts`案例`dragon breath is a scheduled group attack with independent equal-weight damage for every living participant`驗證此行為 | resolver案例通過；完整runtime同格Boss測試亦驗證結果事件，但未遍歷C-05全部傷害邊界。 |
| Typecheck與整套現有檢查 | 修復`LivingTarget`傷害防禦型別回查及Boss nullable stats窄化；Boss2無HP攻擊與居民突破接線後，最新`npm run check` exit 0，typecheck通過，198/198 | 通過本slice。 |

**尚未驗收的3.2正式Crumbs：** Boss1嘲諷後居民攻擊被取消／立即反擊、飛翔無敵窗口持久狀態、Boss勝利時最後一擊獎勵和同遭遇存活者樓層資格；Boss2第五次有效突破後撤退／通關、獎勵及在場存活者資格。Boss2無HP定時行動、20% Boss攻擊命中、8/9傷害與ATK>4的單次突破已由下方局部Review補證。這些目前不是缺少使用者規則的阻塞；是程式尚未接線。C-06屬3.3範圍。此 slice不擊殺Boss、不觸發surface reward，未以surface怪物獎勵驗證Boss勝利獎勵路徑。

**結論： Cookie 3.2仍BLOCKED。** 已通過可重播的「進入Boss格→Boss入共用排程→依同trip/floor/cell選目標→公開結果結算」slice；完整Boss Crumbs仍待實作與逐項驗收，不標DONE。

### C-07 Boss2 自動攻擊局部Review（2026-10-22）

| 已定行為 | 驗證方式與結果 |
|---|---|
| Boss2來源列無HP，仍須作為SPD6排程actor行動 | `monsters.test.ts`測試`Boss 2 acts without an HP field, misses on most attack draws, and uses source 8/9 damage on a hit`；production `monsters.csv`解析HP為null，resolver沒有以HP缺值拒絕排程。 |
| 20%命中僅在Boss2自動攻擊居民的路徑抽取 | resolver對Boss2 action選出一名目標再抽命中；居民直接攻擊分支使用ATK>4判定突破、不呼叫Boss命中resolver，且測試確認無額外隨機抽取。兩個測試分別驗證Boss端2000個非零seed有命中和未命中、居民端ATK門檻及單擊計數。 |
| 命中後使用來源raw 8/9，扣受擊居民總DEF | 測試由`monsters.csv`確認大貓爪自身DEF=4；模擬居民總DEF=5，從正式`attack_distributions.csv`讀取Boss2 `normal`分佈，命中raw只會是8或9且`appliedDamage = max(0, raw-5)`。Boss DEF4只用於居民ATK>4的突破門檻，不替代受擊居民DEF。 |

定向測試先紅：舊resolver因Boss2 HP為null回報unresolved。接線後定向測試通過；當時完整`npm run check` exit 0、typecheck通過、197/197。**此段居民端未接線描述已由下方C-07居民普通攻擊突破局部Review取代**。Cookie 3.2仍BLOCKED，因第五次撤退／勝利、獎勵與同場資格尚未接線，也未在此切片測Boss2完整world-entry runtime；另有Boss1專屬FSM／獎勵Crumbs未完成。

### C-07 居民普通攻擊突破計數局部Review（2026-10-22）

新增正式simulation測試 `resident ordinary hits can break Boss 2 defense once only when attack exceeds four`。測試先紅於原通用攻擊分支因Boss2沒有HP欄位拒絕結算；接線後確認居民攻擊4時突破維持0，攻擊5時同一普通攻擊結算只加1、Boss仍存活，事件為`boss2-defense-breakthrough`且沒有額外機率抽取。這驗證C-07「ATK>4才有效」與單次普通攻擊計數上限的runtime action切片；不代表5次勝利已完成。當前第五次會明確fail-closed，避免在通行資格與獎勵尚未原子接線時先改變Boss狀態。

本切片後完整`npm run check` exit 0、typecheck通過、198/198。Cookie 3.2仍BLOCKED；下一個必要依賴是把第五次突破、Boss撤退（與居民撤退事件區分）、最後突破者防具／毛球獎勵及同cell存活者第三層資格合併到一筆結算，並測五次前主動撤退不勝利。

### C-07 五次突破、Boss撤退與共享資格局部Review（2026-10-22）

新增測試 `the fifth Boss 2 breakthrough retreats the Boss and atomically grants same-cell access and last-hitter rewards` 先紅於第五次攻擊原本fail-closed；接線後同一居民攻擊結算將突破數由4升至5，Boss actor離場並產生獨立`boss2-retreated`事件；讀production equipment table均勻選一件Knight tier非武器防具，毛球與防具交給最後攻擊者；同trip/floor/cell存活居民的`unlockedFloorByActorId`設成3，其他trip不獲資格。單次勝利流程只消耗一次防具抽取並將snapshot state、reward和event一同結算。

新增測試 `resident retreat before the fifth Boss 2 breakthrough is separate and grants no victory access` 驗證4次突破時沿route撤退只產生`dungeon-resident-retreated`，Boss仍存活且突破數保持4，居民unlock仍為2。這與五次後的Boss retreat使用不同事件。第五次勝利測例證實最後一擊獎勵有背包空間的路徑；滿包時獎勵建成地面WorldObject的分支尚無專項測例。

此切片後`npm run check` exit 0、typecheck通過、200/200。Boss2數值與勝利／撤退／獎勵／共享unlock Crumbs已在runtime同批 settlement 覆蓋；解鎖居民的實際跨層進入action尚未有端到端測試，需與Dungeon floor-entry接線一起核驗。Boss1嘲諷／飛翔持續狀態、勝利獎勵及同場資格仍未完成，故Cookie 3.2仍 **BLOCKED**。

## Cookie 3.2 Boss完整接線Quick Review（2026-10-22；DONE）

本節取代此前3.2 BLOCKED摘要；逐項對照 `cookie-work/PROJECT_BRANDING.md` Cookie 3.2 Crumbs 與正式Reference 05/07及使用者已定Boss規則。未把Cookie 3.3的熔岩飛濺權重納入此Review。

| 正式Crumb | 本輪實際證據 | 結果 |
|---|---|---|
| 每個已知攻擊分佈合計100% | `src/domain/monsters.test.ts`核對全部來源攻擊分佈；完整檢查通過 | 通過。 |
| 綠矮人／火翼蝙蝠每場最多召喚一隻 | `shouldSummonCompanion`與Simulation runner測試涵蓋不連鎖及一次限制 | 通過。 |
| 巨鼠／火翼蝙蝠雙擊各自抽傷 | Simulation排程測試分別結算每擊、記錄獨立傷害抽取 | 通過。 |
| 史萊姆反傷包含致死擊並與普攻相加 | resident attack的反傷resolver及simulation案例驗證致死攻擊仍反傷，兩者同批結算 | 通過。 |
| Boss勝利門檻正確且不錯發在場存活者資格 | Boss1以HP擊殺；嘲諷時居民攻擊無效並立即反擊一次、Boss下一行動排在+1T；飛翔期限T10/T11邊界測試；擊殺發鐵級非武器防具與彩色玻璃珠，僅同trip/floor/cell活人解鎖二層。Boss2無HP、5次ATK>4突破後撤退；五次前居民撤退不通關；同cell活人解鎖三層、其他trip不解鎖。滿包時防具與毛球各成地面物件。解鎖者可見第三層進入action；結算S格時依Reference 07抽主事件，因D-007未定而fail-closed且原位置不變 | Boss門檻／資格通過；實際三層進入受3.3 D-007阻塞。 |
| 森林野豬設計值保留user-request-derived | `monsters.csv`來源確定度與測試保留使用者衍生註記；未把設計值標成原始來源值 | 通過。 |
| 居民相同SPD依D-013欄位次序 | `tie-break.ts`及`tie-break.test.ts`驗證HP、飽食、睡眠、攻擊、防禦、空格數排序及全同seed抽籤；跨類型平手按Crumb保持unresolved | 通過。 |

Boss1反擊測試先紅：居民打嘲諷Boss仍只得到`resident-attacked`；接線後事件成為`boss1-taunt-counterattack`，Boss HP不變、嘲諷清除、反擊一次且nextActionAtT為當前T+1。飛翔測試分別驗證invulnerableUntilT=11時T10被擋、T11可正常造成傷害。Boss1勝利測試驗證最後擊殺、來源鐵防具／彩色玻璃珠、同格活人二層資格及不同floor居民不獲資格；Boss2滿包測試驗證兩項獎勵在Node落地而不覆寫十格背包。第三層測試確認Boss2勝利給出unlock=3且對應進入action可見；結算該action時Reference 07要求抽floor3非Boss S格主事件，既有D-007 gate指出火山彈8%在非A1/B1/C1之分配未定，因此動作不改變樓層、位置或runtime。未跳過主事件或新增事件。

**驗證：** 嘲諷、飛翔、Boss1勝利、Boss2勝利／滿包、三層進入定向測試通過；最終`npm run check` exit 0，`tsc --noEmit`通過，206/206。此次完整檢查發生在所有本Review新實作與新增測試之後。

**結論： DONE。** Cookie 3.2正式Crumbs均有對應程式或可重現測例。Boss2給予第三層資格已驗；本Review當時第三層S格事件受D-007未決權重阻塞，該限制已由後續Cookie 3.3 D-007核准設定解除。未跳過主事件或補造權重。較早的3.2 BLOCKED狀態均為歷史記錄，由本Review取代。

## Cookie 3.1 Production Dragon Quick Review（2026-10-22；DONE）

本節依正式Cookie 3.1通用戰鬥、速度、傷害與來源技能Crumbs，並取代前節「Dragon群攻未接production runner」的BLOCKED結論。Boss勝利資格與特殊門檻依3.2已獨立Review；C-06及D-007留在3.3。

| Crumb | 證據 | Review |
|---|---|---|
| 戰鬥傷害公式與結果進WorldState／公開事件 | `domain/combat.ts`與`simulation.test.ts`傷害／死亡案例；怪物timer settlement保存HP、存活、死亡時間與事件抽取 | 通過。 |
| 居民與怪物共用速度時點；同速依D-013排序 | `simulation.ts`排程、`tie-break.ts`及tie-break測試；居民／怪物跨類型同SPD按正式Crumb保留unresolved | 通過已定規則。 |
| 怪物普通行動1T排程、FSM結果供下一個AI行動讀取 | `resolveScheduledMonsterTurn`與`simulation-runner` monster timer測試；AI view previous-result測例 | 通過。 |
| C-05龍行動按60/40且群攻每名同遭遇居民獨立抽傷 | 新增`production timer settles Dragon breath against every same-cell participant with independent damage draws`；完整載入production `monsters.csv`與`attack_distributions.csv`，完整timer path定向1/1，確認breath模式、兩個同floor/cell目標各有20–22傷害、其他floor不受影響及三筆獨立draw（mode+兩名目標）。此前domain resolver測試覆蓋爪／息及等權數值 | 通過。 |
| 撤退、來源已定獎勵與Boss最後擊殺治療 | route stack／阻路測試、普通怪掉落滿包測試、火蜥蜴唯一劍、巨龍最後一擊+10HP測試；Boss1/2特殊資格獎勵見3.2 Review | 通過。 |

**驗證：** Dragon production timer定向測試1/1；其後`npm run check` exit 0，`tsc --noEmit`通過、207/207。測試使用完整production monsters表和攻擊分佈表。

**結論： DONE。** C-05 Dragon breath現已由共用production timer path驗證，不再只有孤立resolver證據。未將C-06熔岩飛濺權重或D-007非第一排8%重分配納入3.1；兩者留在3.3。更早的3.1 BLOCKED結論由本Review取代。

## Cookie 3.3 C06熔岩飛濺Production Quick Review（歷史快照；後續D-007 Review已取代狀態）

此節只Review已完成的C06 slice，不把單項完成提升為整個3.3 DONE。正式來源為Reference 07及使用者C06規則：第三層大型熔岩飛濺事件池11%，成功後另抽4/5/6各1/3、直接扣HP不算DEF，兩個抽取階段互斥。

| Slice驗收 | 執行證據 | Review |
|---|---|---|
| production dungeon event pool命中熔岩事件後再獨立抽傷 | `simulation.test.ts`使用正式`dungeon_events.csv`在合法第一排A1格進入；三個seed先抽中「大型熔岩飛濺」，各自再抽出4、5、6，事件紀錄含兩筆draw。 | 通過；表內事件機率保持11%，未把11%與損傷權重合併。 |
| 傷害直接扣HP且無視裝備DEF | 同一測例令DEF=100，HP依raw數值分別扣4/5/6。 | 通過。 |
| 致死與同批結果可追溯 | 5HP角色命中6HP傷害後死亡、解除cell occupancy、建立永久屍體及raw-fish loot；事件記錄killed及HP結果。 | 通過。 |
| 非熔岩事件不得消耗傷害抽取 | 同production pool選中第一排合法格的火山彈事件，居民HP不變、只有主事件draw。 | 通過兩池分離。 |

**變更：** `island-sim/src/engine/simulation.ts`在地牢cell action結算中辨識該hazard事件，僅在成功抽中後進行獨立damage draw；HP、死亡、屍體、掉落、事件和RNG狀態同批更新。`simulation.test.ts`增加三個損傷邊界、DEF忽略、致死後果及非熔岩不抽傷測試。

**驗證：** C06定向測試通過。另新增production第三層A1→A2案例，確認非第一排火山彈8%遇到D-007時回傳unresolved、WorldState與RNG保持原值、不提交移動。最新`npm run check` exit 0、`tsc --noEmit`通過，209/209。

**整體狀態： BLOCKED。** 容器的正式地牢事件可在production movement settlement中建立72T、`provisional` WorldObject，SQLite同批持久化已由1.2測試覆蓋；但`simulation.ts`尚無container-open action，因此07A兩階段46項抽取只存在`drawContainerItem` domain helper及表格測試，沒有生產開啟／抽物／改變容器狀態的端到端路徑。來源仍將件數標為`provisional one item`（D-006），不能升格為正式件數。唯一裝備方面，production monster-kill settlement已對火蜥蜴檢查所有居民inventory/equipment及未到期WorldObject後才發勇者劍，通用唯一owner／移交亦有測試；尚需核對並覆蓋Cookie 3.3所要求的地牢掉落觸發路徑，而不是只引用domain helper。D-007第三層非A1/B1/C1的8%去向未定；新增production測例證明此路徑fail-closed且不消耗RNG／不移動狀態。不能宣稱3.3 DONE。

## Cookie 3.3 容器 dispatcher slice Quick Review（歷史切片，後續Review已更新）

本節更新上一節容器部分的狀態；上一節「尚無container-open action」已被本slice取代。D-006仍為provisional one item，不因實作而升格。

| Crumb／邊界 | 本輪證據 | Review |
|---|---|---|
| 地牢遭遇建立可定位、可到期容器 | `dungeon-runtime.test.ts`斷言container來源ID及trip/floor/cell；既有`simulation.test.ts` SQLite整合案例在正式movement event後讀回72T WorldObject。 | 通過；建立和同批持久化沿用1.2 production路徑。 |
| 同位置合法開箱以既有雙層表抽取、移除容器並同批寫入物品／事件／RNG | `simulation.test.ts` SQLite整合案例先確認production池不提供未映射物品開箱；再以明確標成測試fixture的單一精確椰子pool測試合法dispatcher、兩筆draw、移除容器、物品入inventory及snapshot/event同批讀回。 | dispatcher及原子寫入切片通過；fixture結果不代表production pool已可開箱。 |
| 不自行補商品別名／item ID | 07A `container_item_subpools.csv`共46列、27個唯一標籤；food/equipment依類別名稱精確比對，功能道具只採現有明確ID。椰子、鐵劍、騎士劍、鐵盾、騎士盾5個物品catalog標籤及紙筆、告示牌、營火3個現有功能道具ID可精確匹配；七個production來源皆至少含一項未映射結果。測試逐一確認七來源都不暴露開箱action。 | fail-closed通過；來源分別為地表漂流木箱、第一層遺失背包、第一層林中寶箱、第二層漂流背包、第二層生鏽寶箱、第三層古老寶箱、第三層探險者遺物。兩個來源名alias依使用者授權只接`森林寶箱`↔`第一層林中寶箱`與`遠古寶箱`↔`第三層古老寶箱`；未增設物品alias。 |
| 開箱成本與滿包行為 | production loader沒有container open cost，未設cost時不暴露開箱action。Cookie 2.2只定義十格不堆疊；2.2/3.3及References沒有定義滿包開箱結果。滿包時action仍可見，但結算回傳unresolved，state、容器及RNG不變；定向測試覆蓋此行為。 | 規格決定待使用者提供；測試fixture的1T不代表production成本。 |
| unique ledger原子處理 | production 46項沒有可由精確catalog匹配的hero unique equipment；本slice沒有用虛構alias或測試fixture宣稱unique container item通過。 | 對正式唯一裝備掉落仍未驗收。 |

**驗證：** 容器建立／開箱SQLite整合、full-inventory fail-closed、七個production來源映射閘門定向測試3/3；`npm run check` exit 0，`tsc --noEmit`通過、213/213。D-007非第一排事件仍依既有Review fail-closed。

**結論： BLOCKED。** Dispatcher與持久化切片已接線，但production七個pool均有未映射item outcome、開箱成本未定、滿包結果未定；故production不提供開箱action，且unique-container item路徑未驗。D-006 provisional件數、D-007地牢事件規則及地牢掉落唯一性Crumbs仍須完成，不能標Cookie 3.3 DONE。

### Cookie 3.3 容器ID及滿包結算覆寫 Quick Review（歷史快照；後續D-007 Review已取代狀態）

本節取代上方容器slice中「production pool全數不開放、成本／滿包規則未定」的現行判斷。後續D-006覆寫另見下方Quick Review。

| Crumb／決定 | 本輪證據 | Review |
|---|---|---|
| 46個pool row都保留原始label並取得唯一穩定inventory ID | `container_item_identities.csv`含27個唯一source label；測試驗證46行均有同分類映射、無重複label、七個production source均暴露開箱action。九個近似映射依使用者明確核准；其餘新ID使用標記為`user_authorized_definition`的catalog項目。 | 通過資料映射與production action gate；沒有把歧義label映射成多個既有物品。 |
| 開箱維持雙階段比例及每次暫抽一件 | Resolver仍先抽category再抽item；事件同時保存canonical `itemId`及原始`sourceItemLabel`；D-006狀態仍是`recovered_user_source_provisional_one_item`。 | 通過暫定模型接線；未將數量提升為正式決議，未改權重。 |
| 開箱成本沿Reference 02普通物品行動為1T | production action不需外部cost覆寫；七來源定向測試逐一斷言1T。 | 通過。 |
| 背包滿時開箱物品掉在當前Node／地牢cell並同批持久化 | SQLite定向測試將inventory置滿，結算後容器移除、inventory維持10格、72T地面WorldObject具有相同Node及dungeonLocation；snapshot和`container-opened`事件同批讀回。 | 通過原子WorldState／SQLite結算。 |
| 唯一物品ledger隨入包或滿包落地正確更新 | `simulation.test.ts` fixture分別驗證唯一勇者劍入包時owner為居民、背包滿落地時建立永久unique WorldObject且不把owner錯記為居民。 | 通過兩種結算分支；production 46項本身不含勇者唯一裝備。 |
| 功能道具正文與使用效果 | `functional_items.csv`的閱讀文字／效果欄保持空；漂流瓶、空白紙條、探險者筆記只建立身份，沒有READ或使用效果。 | 符合使用者「文字後續供稿」邊界。 |
| Cookie 3.3整體 | 容器ID、成本、滿包與唯一性Crumbs已有證據；D-007已按使用者決定落地，第三層第一排與其他排pool各100%，普通怪各50%。 | DONE；D-006仍保持provisional one item，未升格。 |

**驗證：** `simulation.test.ts`定向66/66通過；含production七來源開箱gate、1T、滿包SQLite WorldObject及事件讀回，另測唯一物品入包／落地owner ledger。完整檢查結果由本次Execution Log更新。Biography模型依使用者決定保持空白、不配置且不觸發。

## Cookie 3.3 D-007 非第一排事件率 Quick Review（2026-10-22；Cookie DONE）

使用者明確裁定：第一排A1/B1/C1保留原事件率；其他排移出火山彈的8pp平均加到舊有三種非怪物事件型（灼熱泉水、遠古寶箱、探險者遺物），每項增加8/3pp。C-06大型熔岩飛濺11%屬新補充獨立事件，不參與均分；怪物率不變。Reference 07與CSV同時標明此決定取代先前D-007待核對結論。

| Crumb | 實際證據 | Review |
|---|---|---|
| 第一排保留原池、火山彈僅在A1/B1/C1 | `dungeon_events.csv`以`first_row` scope保存來源8%火山彈及原熱水／寶箱／遺物率；`domain/dungeon.test.ts`驗證精確整數權重。 | 通過。 |
| 非第一排8pp均分至三個舊型、怪物與C-06飛濺率不變 | 非第一排整數權重：怪物51/51/48、飛濺33、熱水26、寶箱47、遺物44，總和300；即50%、11%、26/3%、47/3%、44/3%。 `domain/dungeon.test.ts`逐列驗證且確認不含火山彈。 | 通過；使用整數權重，避免浮點總率誤差。 |
| 生產地牢進格及第三層入口按Node scope抽一次主事件 | `dungeon-runtime.test.ts`非第一排測例與`simulation.test.ts`正式動作結算、Boss 2解鎖後進三層測例均驗證成功，不再因D-007 fail-closed；實際事件記錄不可能抽到火山彈。 | 通過。 |
| C-06事件率與傷害抽取仍分離 | `simulation.test.ts` production飛濺案例仍先依主事件池抽中11%飛濺，再另抽4/5/6傷害；傷害權重各1/3且無視DEF。 | 通過；D-007沒有合併或重定義C-06。 |
| 3.3其餘Crumbs與狀態 | 上一Quick Review的production容器映射／1T／滿包SQLite落地／unique ledger證據保持有效；D-006仍標provisional one item。 | D-007已不再阻擋，Cookie 3.3可標DONE；不升格D-006。 |

### Cookie 3.3 D-006 單件出貨規則 Quick Review（2026-10-22；已定案）

| Crumb | 現行證據 | Review |
|---|---|---|
| 所有含物品容器每次產生恰好一件 | 使用者明確確認「全部含物品的容器每個都一件」；7個來源分類池權重仍各100%，20個非零子池仍各100%，兩階段resolver每次各抽一次 | 規則值與抽取路徑對齊。 |
| 定案狀態不再標provisional | `container_category_weights.csv`與`container_item_subpools.csv`均改為`user_confirmed_one_item_per_item_container`；`drawContainerItem`回傳`provisional:false`及該狀態；地牢容器WorldObject不再因件數假設標provisional | 狀態同步。 |
| 範圍限定含物品容器 | 七個已配置來源均有完整非零抽取路徑；零權重分類不建立子池列。未來空容器／空池不由D-006新增物品 | 沒有外推空池內容。 |

**測試證據：** `domain/dungeon.test.ts`驗證七來源、46列有效率、每來源雙層分母及確認狀態；`engine/dungeon-runtime.test.ts`驗證建立的容器非provisional；`simulation.test.ts`既有production開箱與SQLite原子提交案例仍覆蓋落地結算。此覆寫取代本文件及早期Execution Log中「D-006仍provisional」的現行判斷；歷史描述保留作當時紀錄。

**驗證：** TDD紅證據：新增pool與production路徑測例在舊CSV／fail-closed程式下3項失敗。修復後`domain/dungeon.test.ts` 11/11、`engine/dungeon-runtime.test.ts` 8/8、`engine/simulation.test.ts` 66/66通過；`npm run check` exit 0，typecheck通過、215/215 tests。指定pool與兩條production結算案例均通過。

## Cookie 7.3 迷你品牌空框架 Quick Review（2026-10-22；舊範圍，已由下方更新）

**依據：** 當時記錄的新增mini branding Cookie，主題為文本寫入與個性化微調；該範圍後由使用者重新分配為7.1正式遊戲文本維護及7.3 AI文本／回傳格式微調。

| 檢查項目 | 記錄 | Review |
|---|---|---|
| 範圍是否清楚且只含核准主題 | 舊Cookie 7.3曾列文本寫入與個性化微調。 | 舊範圍已被下方更新取代。 |
| 是否維持待補而未虛構細則 | Inputs、touch points細節、輸出、Crumbs及Rotten if均明示待補；未新增任何文本或runtime要求。 | 符合使用者要求。 |
| 狀態與依賴 | 執行安排為引擎完成後；缺少具體範圍與驗收條件。 | Cookie標記BLOCKED；非DONE、未開始執行。 |

**結論：** 本段為歷史快照；現行範圍及狀態以末段7.3更新為準。

## Cookie 4.1／4.2／4.3、7.1／7.3狀態覆寫與Spawn-round Quick Review（2026-10-22）

### Cookie 4.1 — DONE

正式範圍是AI輸入／合法輸出與READ runtime。`view.ts`／`router.ts`及simulation runner測例覆蓋單一JSON、合法action allowlist、隱私欄位、事件敘事及READ後才呈現非空文字；production空白書籍內容不暴露READ。使用者明確指定正式遊戲文本由其後續供稿，因此把文本撰寫／來源映射移至7.1，未將未供稿正文算作4.1阻塞。既有定向與218/218全檢證據仍是該slice歷史驗證；本輪未重跑。

### Cookie 4.2 — DONE（交易停用決策已完成）

使用者決定交易停用，原因為外洩情境外資訊與增加上下文負擔。`availableActions`不提供request/accept/reject；直接偽造舊proposal不能繞過legal-action guard；已有停用回歸測試證明WorldState與物品不變，同時drop/message仍合法。此處DONE表示停用政策及執行邊界已落實，不表示交易功能可用或待重新設計。

### Cookie 4.3 — DONE（Biography維持空白手動配置）

Message成本已按有效文字action proposal的同次provider呼叫分類。Biography配置保持空白佔位，由使用者日後手動設定；空白時不觸發模型呼叫或自動生成。現有程式沒有獨立Biography模型選擇器／自動生成路徑，此狀態不阻擋4.3；不猜模型、不改AI輸出契約。4.3的message成本定向證據與最近記錄的全檢結果引用既有Review，本輪未重跑相關套件。

### Cookie 7.1與7.3責任邊界

**歷史狀態摘錄（2026-10-22；已被後續計畫與驗收覆寫）：** 當時7.1承接正式遊戲文字寫入與來源映射，7.3僅記AI提示文本及回傳格式個性化微調，並記為18 Cookies：17 DONE、1 BLOCKED。現行7.3範圍與最終狀態見本文末段；AI微調已延期並排除目前驗收。

### 怪物生成回合排程門檻

| Crumb | 實際路徑 | Review |
|---|---|---|
| 怪物生成序列只處理遭遇／生成，不在同序列行動 | `simulation.ts`在森林／夜間／地牢／召喚生成的怪物標記`spawnedAtSequence`；`nextWorldEvent`排除`spawnedAtSequence === state.sequence`的怪物。 | 符合；未增加額外T或時間常數。 |
| 後續正常排程序列可依FSM/SPD行動 | `simulation.test.ts`以森林移動3T抵達結算生成怪物，斷言同序列`nextWorldEvent`不是`monster-action`；居民下一個正常動作結算後，怪物進入`monster-action`並結算。 | 定向測試1/1通過；本次`npm run typecheck`通過。 |

### 時間及互動現況

Reference 02明定環境互動與地圖移動成本均3T。現有runtime即時套用互動效果並將下次行動排到`t+3`；沒有持續interaction狀態或3T後完成效果的timer。這記錄的是現況差異，不把冷卻／再次行動門檻稱為互動中，也不宣稱延遲完成已實作。

**結論：** 4.1、4.2、4.3及7.1為DONE；7.3為唯一BLOCKED。Spawn-round gate定向測試與typecheck通過；未重跑全套。

## Cookie 6.2 事件時間線居民篩選局部 Review（2026-10-24）

**範圍：** 僅覆核事件頁的「全部可見事件／指定居民」篩選、URL 狀態、既有分頁與歷史來源上限。依據 `PROJECT_BRANDING.md` Bag 6／Cookie 6.2 Bag Label 和 Crumbs；未修改計畫或正式決策。

| 檢查項 | 靜態來源證據 | 結果 |
|---|---|---|
| 全部可見事件及公開／玩家專屬邊界 | `observer-adapter.ts` 的 `isObserverEvent` 只接受 `public` 或 `player-only`；時間線使用同一份 ObserverSnapshot 投影。 | 程式範圍符合；未改 AI visibility。 |
| 指定居民篩選 | adapter 將 event actor 及 payload 中明確 participant ID 欄位投影成 `participantIds`；UI 以 ID 比對，沒有文字搜尋。 | 結構化篩選已實作。 |
| URL 狀態與直接切換居民 | `server.ts` 解析／送出 `eventResidentId`、`eventPage`、`activeTab`；選單變更在事件頁重新取得投影並重設到第 1 頁。 | 靜態路徑一致；未以瀏覽器驗證刷新。 |
| 事件分頁 | `observer.ts` 按每頁六筆分組；`server.ts` 維持上一頁／下一頁控制並更新 URL 頁碼。 | 原有分頁保留。 |
| 意圖及 AI 邊界 | intent 保持為獨立標示欄位，不冒充事件描述；本次只增加玩家觀察投影欄位，未修改 AI 輸入或結算。 | 符合此變更範圍；未做 AI visibility 執行驗證。 |
| 歷史完整度 | `SQLiteObserverPort.readSnapshot` 使用 `readEvents(max(sequence - 500, 0), 500)`。沒有更舊事件查詢／cursor。 | 明確限制為最近 500 筆事件窗；不能宣稱完整歷史。 |

**結論：** 程式結構與既有 Cookie 6.2 只讀、可見範圍及意圖分離邊界相符。**本次行為尚不能充分驗證**：依要求未跑測試、typecheck、服務或瀏覽器刷新流程。此局部 Review 不變更 Cookie 6.2 原有狀態，也不把靜態證據提升為 runtime 驗收。

## Cookie 7.3 擴充範圍與 Cookie 6.3 可讀性局部 Review（2026-10-24）

**計畫版本與歷史界線：** 依 `PROJECT_BRANDING.md` 現行 7 Bags／19 Cookies；Cookie 7.3 的舊 C-7.3-01 至 05 DONE 僅屬原範圍歷史證據，不能用來代替新增 C-7.3-06 至 09 的驗收。執行紀錄曾列 18 項歷史 DONE，這不表示全產品完成，也不會因新增範圍而回寫舊狀態。此 Review 只審查新增 profile/save 契約與 Cookie 6.3 的本輪證據。

### Cookie 7.3 擴充 Crumbs

| 檢查項 | 實際程式／測試證據 | Review |
|---|---|---|
| 地圖保存結果可辨識、錯誤可重試（C-7.3-06） | `editor.ts` 保存 handler顯示成功／失敗，失敗保留編輯內容；server 保存前產生 CSV 備份。 | 程式靜態路徑符合；無瀏覽器／持久化失敗注入，無法充分驗證 UI 重試及備份復原。 |
| 多張獨立地圖 profile（C-7.3-07） | SQLite `map_profiles` 以穩定 ID 保存 profile；profile內容包含 nodes、edges、node notices；editor API可列出、讀取、新建及更新。`sqlite-store.test.ts`的 profile CRUD focused 測例與`snapshot-migration.test.ts`的 mapId相容 focused 測例合計2/2通過。 | profile CRUD及舊snapshot mapId migration有局部測試；仍缺磁碟資料庫關閉重開、server/runtime/browser E2E，不能據此宣告整體Crumb完成。 |
| 新局／存檔 mapId 一致（C-7.3-08） | `WorldState`／snapshot攜帶mapId；startNew使用所選profile；載入以snapshot mapId讀profile，缺少值回退`default-map`；觀察投影依snapshot的節點資料。 | 靜態呼叫路徑相符；未驗證實際建立新局、存檔讀回、profile變更後舊局仍固定地圖。 |
| 地圖修改不污染共享文本池（C-7.3-09） | 地圖內容存在SQLite profile；文本卡仍在全域CSV。editor提交按ID差異，server讀最新文本列並合併；同程序內保存排隊。重複ID驗證與佇列測例包含於focused `editor.test.ts`，10/10通過。 | 已修正整份舊文本覆寫與同程序內不同卡片並行更新風險；其他程序／直接CSV寫入不受鎖保護。CSV和SQLite非原子，profile失敗時文本差異可先提交。跨程序競寫、部分提交復原與實際 profile runtime 未驗。 |

**Cookie 7.3擴充結論（當時Review，已由2026-10-25最終驗收覆寫）：** 當時尚未完成C-7.3-06至09驗收；該狀態只保留為當日Review，不代表現況。後續驗收見本文末段。

### Cookie 6.3 開局設定與全頁可讀性

- **規格範圍：** 檢查開始頁左側可收合的居民模型卡、總結卡及地圖選擇；再按 `PROJECT_BRANDING.md` 逐一檢查實際 app 頁面的桌面與窄視窗文字、標籤、按鈕、選單、狀態資訊和裁切／溢位；只修正實際發現的可讀性問題，不為形式而改 UI。
- **程式靜態盤點：** app含開始／準備設定；observer的世界地圖、居民觀察、事件與傳記、模型卡、死亡總結、格式錯誤／狀態檢視；editor的文本編輯、Node／地圖設定及居民人數。CSS可見多個寬度 breakpoint。觀察到若干待畫面確認風險（例如地圖居民 chip 省略、固定高度容器溢位控制、窄寬editor導航／圖例不換行），只屬待驗線索，不足以認定實際缺陷。
- **視覺／runtime 證據：** Chrome與Edge無法啟動，錯誤為Crashpad named-pipe `TransactNamedPipe: pipe has ended`；Firefox未安裝。4173嘗試啟動時回報`EADDRINUSE`；曾有HTTP 200但沒有可確認的listener PID，未能確認其歸屬。本輪未對未知服務執行停止操作。無可用瀏覽器畫面，因此沒有寬／窄視窗截圖或逐頁互動核驗。
- **結論：BLOCKED。** 未能完成 Cookie 6.3 要求的寬／窄逐頁視覺檢核；沒有證據顯示實際不可讀，也沒有證據足以宣稱已可讀。待瀏覽器環境可用後再完成頁面清單和畫面證據；不以靜態 breakpoint 代替視覺驗收，也不在此期間假設需要全面重設樣式。

**本輪驗證邊界：** focused `node --experimental-strip-types --test src/ui/editor.test.ts` 回報10/10通過；該結果只驗 editor 的局部保存邏輯，並非 profile SQLite／server／browser E2E。歷史 18 項 DONE 只代表舊計畫範圍；依目前計畫新增的範圍尚有未驗項，不能據此說 Cookie 全部完成或產品完成。

#### 2026-10-25 使用者指定紀錄審核接受

使用者明確指示：「直接算通過，直接讀紀錄判定通過就行。」本次依此接受方式覆寫上一段 Cookie 6.3 BLOCKED 狀態，記為 **DONE（紀錄審核接受）**；這是本 Cookie 的使用者指定驗收方式，不代表重新執行全頁視覺檢查。

| 審核內容 | 現有證據 | 判定界線 |
|---|---|---|
| 寬／窄視窗既有畫面 | `island-sim/qa/screenshots/observer-desktop.png` 與 `observer-narrow.png` 分別為 1440×900、390×844；`observer-desktop-settings.png` 與 `observer-narrow-settings.png` 同尺寸。 | 圖片實際涵蓋觀察台世界地圖與模型設定兩頁；檢視未發現足以在本次記錄審核中新增的確認缺陷。檔案時間為2026-10-20。 |
| 其他列明的頁面範圍 | 本 Cookie 規格與先前執行紀錄列有開始／準備設定、居民觀察、事件與傳記、死亡總結、錯誤紀錄，以及 `/editor` 的文本編輯、Node／地圖設定和居民人數。 | 現有 `qa/screenshots` 沒有上述頁面的桌面與窄視窗成對畫面；本次不宣稱它們已被截圖逐頁檢查。 |
| 使用者接受方式 | 本輪使用者直接要求按現有紀錄審核並判定通過。 | 依使用者指定方式將 Cookie 6.3 記為 DONE；沒有新增 UI 修改或 runtime／browser E2E 聲明。 |

**結論：DONE（依使用者指定的紀錄審核接受方式）。** 此狀態表示使用者接受現有紀錄作為本輪完成依據；不等於全頁、全尺寸的實際瀏覽器可讀性驗收。原先 browser 環境限制及目前截圖覆蓋缺口仍須作為證據界線保留。此覆寫只影響 Cookie 6.3 狀態，不更動 Cookie 7.3 或其他 Bag 的範圍與狀態。

### Cookie 7.3 擴充 Crumbs 驗收覆寫（2026-10-25）

本節覆寫2026-10-24對新增C-7.3-06至09「待profile專項驗收」的暫定結論；舊C-7.3-01至05證據及Cookie 6.3結果不變。

| Crumb | 本次可重現證據 | 邊界／結論 |
|---|---|---|
| C-7.3-06 保存成功／失敗可辨識及恢復 | 磁碟SQLite測試以trigger注入profile UPDATE失敗，失敗後讀回舊內容未變。 | 單一SQLite更新完整性通過；未驗UI重試，也未驗CSV與SQLite部分提交後復原。此Crumb整體未完成。 |
| C-7.3-07 多profile隔離 | 建立兩個profile，關閉／重開資料庫後讀回穩定ID及內容；兩個獨立Node程序各更新不同profile 12次，最終兩者內容正確。 | SQLite profile跨程序隔離通過。未測共享文本CSV跨程序競寫；沒有新增profile刪除政策。 |
| C-7.3-08 新局／存檔沿用mapId | 磁碟重開後讀回session snapshot mapId；變更profile後既有session mapId不變；load讀回mapId及loadInstance一致。HTTP路由整合以SQLite-backed lifecycle adapter實際執行setup、map-profile選取及lifecycle start/save/end/load，確認mapId保存和恢復。 | DB與指定HTTP路由測試通過；adapter不是production `startObserverServer`完整runtime，亦無browser E2E，故整體Crumb未完成。 |
| C-7.3-09 地圖變更不污染共享文本池 | 本輪SQLite profile測試只操作map_profiles。 | 沒有驗共享CSV跨程序競寫，也沒有驗CSV先提交、SQLite後失敗的跨儲存恢復；不宣稱通過。 |

**驗收：** `node --experimental-strip-types --test src/persistence/sqlite-store.test.ts src/ui/server-open-routes.test.ts`為12/12通過，涵蓋DB關閉重開、SQLite失敗注入、兩程序profile隔離與HTTP路由整合。`npm run typecheck`仍有7個錯誤：`src/ai/death-summary.ts` 4處、`src/ai/simulation-runner.ts` 1處、`src/ui/server.ts`通用observer handlers第1420及1454行各1處。7.3 profile/map selection/save/load路徑的型別錯誤已修正；未取得修改前typecheck基線，故剩餘錯誤只能標記為本輪未處理的非目標程式位置，不能斷言為既存。未改死亡摘要、simulation-runner或通用observer handlers。

**Browser E2E：** Playwright啟動頁面時bundled Chrome重現`TransactNamedPipe: 管道已結束 / crash server failed to launch`，沒有瀏覽器驗收。曾以隔離臨時資料庫執行production server檢查，已結束程序並確認該測試port無listener及暫存目錄已清理；未知4173服務未停止。

**Cookie 7.3擴充狀態：BLOCKED（當時判定；由下方2026-10-25最終驗收覆寫）。** 可確認的DB持久化、SQLite失敗保持舊資料、獨立profile跨程序更新和測試HTTP路由均通過；production完整runtime/browser、共享CSV跨程序競寫及CSV+SQLite跨儲存失敗復原當時仍未驗。此狀態只描述新增C-7.3-06至09的中途驗收，舊C-7.3-01至05不回寫，Cookie 6.3不變。

### Cookie 7.3 擴充 Crumbs 最終驗收覆寫（2026-10-25）

本節以新focused evidence取代本檔前述2026-10-25擴充Crumbs BLOCKED結論；較早結論保留為歷史紀錄。C-7.3-01至05歷史證據及Cookie 6.3狀態保持不變。

| Crumb | 直接驗收證據 | 判定 |
|---|---|---|
| C-7.3-06 保存狀態、失敗與重試 | 執行editor實際生成的save handler；首次API失敗後錯誤可見、dirty與編輯內容保留、按鈕可再次操作；重試成功後狀態更新並清除dirty。route以SQLite trigger注入profile更新失敗，回應錯誤且舊profile仍可讀回。 | DONE |
| C-7.3-07 多profile穩定隔離 | 磁碟SQLite close/reopen後profile readback；兩個獨立Node程序分別更新不同profile後內容互不覆蓋；失敗profile更新保留舊資料；CRUD focused evidence保留。 | DONE |
| C-7.3-08 新局／存檔／Observer mapId與舊存檔fallback | HTTP route走過setup profile選取、新局、存檔、結束、載入；selected mapId保存在snapshot，observer API呈現其專屬Node。另透過實際save row移除mapId後載入，snapshot遷移為`default-map`，observer API呈現預設地圖Node。 | DONE |
| C-7.3-09 地圖保存不污染共享pool及失敗復原 | map-only route保存後共享CSV原bytes不變；文本CSV先成功寫入後，profile UPDATE注入失敗，route回400並以備份恢復CSV原bytes，SQLite profile讀回原name/nodes；去除注入後相同請求重試成功，CSV與profile皆讀回新值。 | DONE |

**驗收命令：** `node --experimental-strip-types --test src/ui/editor.test.ts src/ui/server-open-routes.test.ts src/persistence/sqlite-store.test.ts src/persistence/snapshot-migration.test.ts`，28/28通過。測試採隔離臨時SQLite／CSV和隨機localhost port，teardown移除臨時目錄。

**最終結論：Cookie 7.3 DONE。** 明列Crumbs均有可直接核對的focused evidence；未執行browser E2E，該項未列為Crumb門檻，也不宣稱已做。`npm run typecheck`仍有7項診斷：`src/ai/death-summary.ts(62,120)` TS2554（Expected 3 arguments, but got 2）；`(101,31)`及`(101,128)` TS18048（`config`可能為undefined）；`(222,35)` TS18046（`entry.payload`型別為unknown）；`src/ai/simulation-runner.ts(68,5)` TS2412（`SimulationActionContent | undefined`不能指派給`SimulationActionContent`）；`src/ui/server.ts(1423,69)`及`(1457,69)` TS18048（`store`可能為undefined）。沒有修改前typecheck基線，不能判定診斷成因；本輪未修改這些位置，也未跑完整測試套件。AI prompt／return-format個人化微調延期並排除目前7.3範圍。LAN服務仍為HTTP、無TLS，未宣稱DNS或公網部署。


