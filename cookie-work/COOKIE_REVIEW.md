# Cookie Review｜輪迴島規劃草稿

> **執行授權更新（2026-10-20）：** 以下原始 Review 是規劃草稿審查的歷史結論；使用者後續明確指示「執行cookie」，已由 D-001 記錄為依現有 7 Bags／17 Cookies 開始執行。該授權不核准其他 D 決策或待回查規格。執行前局部 Bag Review 見 [BAG_REVIEWS.md](BAG_REVIEWS.md)，逐 Cookie 執行與證據見 [EXECUTION_LOG.md](EXECUTION_LOG.md)。

> **決策及工程證據更新（2026-10-20）：** D-010最新記錄為SLEEP僅夜間至天亮；無獨立全域固定8次風險，安全區不觸發額外睡眠風險，不安全區睡眠風險逐人以入區判定時點為錨每3T、睡滿24T共8次；森林夜間負面總率17.5%作非野外睡眠比例基準。D-013排序、D-014正數`.5` round half up、D-015出生點、D-016模型設定槽、D-017 UI方向均已決。Foundation最新回報`npm run check`與typecheck通過、141/141 tests，定向engine 26/26，涵蓋sleep anchor/risk gate；先前80/80為較早測試快照。Bag 3 helper仍待runtime dispatcher整合，surface/dungeon/social dispatcher與完整AI閉環、死亡／世代生命週期仍未完；未知睡眠事件效果仍由gate隔離。局部測試不等於相關Cookie或完整17 Cookie完成。

> **追加規格／來源核對（2026-10-20）：** 安全區睡眠不觸發額外睡眠風險；不安全區才依個人入區判定時點每3T檢查、睡滿24T共8次。睡眠遭攻擊先結算傷害及死亡，存活才醒。使用者提供森林進區事件日間15%觸發且負面35%（總5.25%）、夜間25%觸發且負面70%（總17.5%）；夜間提高同池負面占比、不額外roll，僅Node原本無其他島民時觸發。主動採集野莓90/10與進區池分開；Reference早期80/20作為歷史差異保留。非野外夜間睡眠負面事件相對權重正規化至17.5%，不改一般進區事件表；若睡眠負面項目／效果缺值則局部阻擋該事件。屍體行動成本採每拿一件1T、搬起1T、放下1T，攜屍跨Node按原3T移動。使用者採用互動點執行設定：魚站2/10/14、椰子1/8/13、森林9/17/23、岩石6/19/22、河流24；地圖crosswalk支持森林／石堆／河流分組序列對應，但不等同原圖逐點文字標名，魚站與椰子Node依使用者設定而非地圖直接標記。這些裁定尚不代表Cookie完成。工程端最新core 141/141及typecheck通過為局部證據，與完整17 Cookie完成分開記錄。

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
| `02_時間與行動排程.md` | 72T 時鐘、獨立等待、行動成本、訊息 | Bag 1/4；Cookie 1.1、4.2 | 覆蓋；夜間睡眠、安／危險區睡眠風險、攻擊醒來順序依使用者後續裁定更新；WAIT可選時長仍待決 |
| `03_地圖與探索.md` | 主島與地牢拓樸、探索連續條件、物件生命週期 | Bag 2/3；Cookie 2.1、2.3、3.3 | 覆蓋；未映射地點不補值 |
| `03A_28Node原圖與鄰接表.md` | 28 Node、51 邊、地形分類與名稱可信度 | Cookie 2.1、6.1；D-003/D-004 | 圖可核28 Node／51邊及火山、營地、港口；森林／石堆／河流依分組序列對應，非逐點文字標名；像素座標未轉距離 |
| `04_生存物品與裝備.md` | 背包、裝備、HP／食物、唯一裝備與升級 | Cookie 2.2、3.3；D-005/D-010 | 覆蓋；商品名稱歧義留待核 |
| `05_戰鬥與怪物.md` | 傷害公式、地表／地牢怪、Boss、特殊技能 | Cookie 3.1–3.3；D-009 | 覆蓋；未定機率與映射沒有補造 |
| `06_地表事件與資源.md` | 椰子、釣魚、河流、岩石、森林及夜間安全 | Cookie 2.3、3.2；D-004、D-019 | 森林進區與主動野莓採集分池；森林進區比例依使用者後續裁定更新；逐點互動位置按來源確定度記錄 |
| `07_地牢事件與掉落.md` | 三層主事件、Boss 獎勵、特殊限制 | Cookie 3.2–3.3；D-007/D-009 | 覆蓋；第三層區外權重未決 |
| `07A_找回的詳細掉落表.md` | 怪物附加掉落、七容器兩階段池、舊值對照 | Cookie 3.3、7.2；D-005/D-006 | 覆蓋；候選單件容器狀態清楚 |
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
| `tables/dungeon_events.csv` | 24 條地牢事件與觸發條件 | Cookie 3.3、7.1 | 覆蓋；火山彈非第一排標為 TBD |
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
| 時鐘與合法時間成本 | Bag 1 → Bags 2–4、6、7 | 相容：由核心排程決定下一個可行動實體；領域 Cookie 提供合法行動成本。D-013 定義同 SPD 次序；WAIT 仍待決，不影響其他已知範圍的計畫分工。 |
| Node 圖與位置語義 | Bag 2 → Bags 3、4、6 | 相容：同一主島拓樸支援移動、場景事件、模型可見 Node 及唯讀 UI；尚未確認名稱／互動點保留 TBD。 |
| 物件與裝備契約 | Bag 2 → Bags 3–5 | 相容：物件身分與全域唯一性由核心／持久層共同支援；商品別名和容器單件假設已標為待核，未形成互相衝突的正式依賴。 |
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

- **睡眠規則：** 安全區睡眠不觸發額外睡眠風險；不安全區才逐人以入區判定時點為錨每3T一次，完整夜最多8次。攻擊後先結算傷害／死亡，存活才醒；一般進區／探索觸發保留。非野外夜間睡眠以森林夜間總負面17.5%作基準，保留原負面項相對權重等比例正規化，不動進區表；工程代理回報安全區零觸發、entry-anchor、3T/max8、缺表gate及排程繼續測試已通過，整體Cookie驗收仍未完成。
- **森林事件：** 使用者明定白天觸發15%、條件負面35%=總負面5.25%；夜晚25%、70%=17.5%。只在進入原本無其他島民的Node時觸發；夜晚改同池負面占比、不額外roll。主動野莓90/10另池；早期Reference 80/20值保留作歷史差異。森林進區值不得混成主動採集率。
- **地圖crosswalk：** 原圖直接標示Node／道路骨架及火山、營地、港口。`03A`與`island_nodes.csv`能以分組文字順序對應森林9/17/23、石堆6/19/22、河流24，但CSV的label_status明示不可視作逐點命名。使用者採用魚站2/10/14及椰子1/8/13作執行設定；此為使用者設定，不聲稱地圖直接標定。以上互動點依使用者採用設定執行，Reference／圖面來源層級另行保留。
- **屍體行動：** 使用者採用每拿一件1T、搬起1T、放下1T；攜屍跨Node仍用3T移動、不另加搬運成本。具體程式／Cookie驗收尚未完成。
- **審查狀態：** 上述內容只更新現行規則、來源可信度及位置狀態，不提升任一Cookie為DONE。工程端回報core 141/141與typecheck通過屬局部證據，不等同整合或完整Cookie驗收。

## 使用者摘要

規劃草稿原已通過來源覆蓋與 Cookie 結構檢查；其後使用者授權依現有計畫執行。使用者已決定夜間至天亮睡眠、安全區無額外睡眠風險、不安全區逐人每3T及受攻擊先傷害後存活醒來、非野外夜間睡眠負面率按森林17.5%同比例正規化、同SPD排序、正數round、出生點、模型設定槽、UI方向、森林進區事件率、屍體行動成本。互動點設定已由使用者採用；其來源層級與地圖直接標定範圍分開記錄。決策已定不代表工程完成；尚無足以將任何Cookie標DONE的完整Crumb證據。Bag 1、2、3、5有局部Review；Bag 4、6、7依實際開始及依賴補Review。仍未決項按最小範圍隔離，包括WAIT、部分地名／椰子互動點來源標記、訊息可見半徑、部分戰鬥值、別名、容器出貨規則與文獻原文。
