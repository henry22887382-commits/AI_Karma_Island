# Cookie Execution Log｜輪迴島

## 授權與範圍

- **使用者原文：** 「執行cookie」
- **日期：** 2026-10-20（Asia/Taipei）
- **記錄位置：** `DESIGN_DECISIONS.md` D-001；`PROJECT_BRANDING.md` 狀態欄已反映執行授權。
- **授權範圍：** 原授權為依 `PROJECT_BRANDING.md` 執行7 Bags／17 Cookies。使用者於2026-10-22另明確授權新增Cookie 7.3空框架，後依後續使用者指示調整其實作範圍；正式世界文本維護歸7.1，AI提示／回傳格式微調排除本輪。7.3原有同IP `/editor`、地圖檢視及獨立profile／mapId擴充Crumbs均已按明列條件驗收DONE（2026-10-25）；最終證據見本Log末段與`COOKIE_REVIEW.md`。本記錄以後續具體授權與驗證為準。
- **執行原則：** 依依賴啟動工作；明確來源值可實作。未知值只限制其最小受影響 Crumb/Cookie。每個 Bag 開始前須有 Bag Review。工程代理聲稱不等同 DONE；DONE 需逐條 Crumb 對應可查的實作與驗證證據。

## 執行前 Review 與依賴

- Bag Review 見 [BAG_REVIEWS.md](BAG_REVIEWS.md)。本輪審查 Bag 1、2、3、5；Bag 4、6、7 須在實際開始前依其依賴另做 Bag Review。
- 依賴圖存在 Bag 1–5 循環；執行時以純 domain handler/reducer/store adapter 分層，避免跨包直接互相依賴。工程介面草案見 `BAG_REVIEWS.md`，仍須以實際程式及呼叫路徑證實。
- D-002 繼續待正式外部 schema 決策；內部可逆 versioned 存取結構只作執行細節，不升格成正式契約。
- Bag 1.1 WAIT可選時長已由使用者於2026-10-21明確決定為1T；戰鬥回合=1T，C-08／C-09不再是T缺值。夜間與睡眠規則以本檔2026-10-21修正版執行紀錄為準。怪物actor排程與runner自動結算已局部接線；完整FSM、跨類型同SPD及死亡／獎勵Crumbs仍未驗完。
- **夜間風險裁定（2026-10-20）：** 使用者更正原文「我講錯 我是指常規觸發外 只在不安全區域稅著觸發 3T一次 參考進入區域判定時點 美人判定分開」，再補充「沒有這項 8來自24/3 指的是睡著時會有共8次判定」，並明示「安全處睡眠不觸發」。現行沒有獨立全域固定8次；安全區睡眠不觸發額外睡眠風險；不安全區睡眠額外風險只對該處睡眠居民逐人每3T判定，以各人進入區域判定時點為錨，睡滿24T共8次；一般進區／探索觸發保留。此前由 ZIP／計畫解讀出的global 8 routine已撤回，不以舊判讀反駁使用者最新決定。
- **睡眠裁定（2026-10-20）：** 使用者原文「晚上才能睡覺 睡到天亮」。SLEEP 僅夜間可用並持續至天亮；睡眠遭攻擊時先結算傷害及死亡，存活才驚醒。WAIT 時長後由使用者於2026-10-21明確決定為1T，見D-010。
- **D-013 同SPD（2026-10-20）：** 使用者原文「同速度比生命 食物 睡眠 攻擊 防禦 空格子 最後抽速」，答覆「1 空格子按多(消歧異)」；正式順序HP、飽食、睡眠資源、攻擊、防禦、背包空格數依序降序，全同才按記錄seed抽籤。
- **D-014/C-15（2026-10-20）：** 使用者答「1 要」；正數 `.5` 四捨五入進位。語義已定，跨語言實作與測試待驗。
- **D-015出生點（2026-10-20）：** 使用者授權「2請自訂義 共三個 不相鄰 隨機 不沿用」；依此選來源沙灘 Node 1/8/13，居民／新世代依記錄seed重抽、不沿用前代。這是出生點設定，與D-020使用者採用的椰子Node 1/8/13（初始0、每日+1、上限3）分開；後者不宣稱由地圖直接標定。
- **D-016模型設定（2026-10-20）：** 使用者「留可用空位 操作設定在前台」；記錄前台10個可留空provider/model/fallback/價格/API key槽，不預選live AI；key僅server記憶體，不進WorldState。
- **D-017 UI（2026-10-20）：** 使用者「作成切換式頁面 藉此將資訊壓縮在單一視窗 格子和字體動態調整試試看」；記錄單窗切換頁面及動態格子／字體原型，UI與browser驗收待證。
- **D-018 屍體搬運成本（2026-10-20）：** 使用者採用每拿一件屍體物品1T、搬起1T、放下1T；攜屍跨Node仍以原移動3T處理，不另加搬運時間。工程整合與逐Crumb驗收仍待證。
- **D-019 森林進區事件（2026-10-20，歷史規則，已被2026-10-21修正版覆寫）：** 當時記錄白天15%觸發／負面35%，夜晚25%觸發／負面70%（總負面17.5%）；現行夜間不再將森林負面比例當作全域遇敵率，森林原地形池僅於地形夜間遇敵抽取失敗後判定。主動野莓採集90/10仍是獨立池。
- **D-020 互動點位置核對（2026-10-20）：** 使用者明確採用魚站2/10/14、椰子1/8/13（初始0、每日+1、上限3）、森林9/17/23、岩石6/19/22、河流24作執行設定。原圖crosswalk確認28 Node／51邊、火山／營地／港口；森林／石堆／河流Node來自Reference分組序列對應，CSV標記提醒不可說成原圖逐點文字標名；釣魚與椰子Node是使用者採用設定，不偽稱為地圖直接標定。按既有使用者授權執行，並在來源欄保留此區別。
- **非野外區域夜間睡眠風險（2026-10-20，歷史規則，已被2026-10-21修正版覆寫）：** 當時按森林17.5%同比例正規化非野外睡眠結果。現行危險區睡眠每3T依所在Node地形遇敵率抽一次，不抽地形池；固定扣1HP及營火豁免規則見2026-10-21執行紀錄。
- **最新工程驗證（implement_foundation，2026-10-20；時間未提供）：** 工作目錄 `D:\Henry\Documents\AI-land\island-sim`。代理直接回報：`npm run check` exit 0，typecheck通過、141/141 tests通過；`npm run typecheck -- --pretty false` exit 0；定向命令 `node --experimental-strip-types --test src/engine/night-risk.test.ts src/engine/simulation.test.ts` 為26/26。睡眠相關覆蓋包括unsafe entry-anchor、每3T／每夜最多8次、共用風險表、安全區不觸發、效果與死亡結算、缺表gate並讓排程繼續。本記錄代理未重跑，且此為該程式版本snapshot，不視為後續程式或Cookie整合持續通過；原先80/80報告保留為更早歷史。Bag 3 runtime dispatcher及surface/dungeon/social dispatcher、完整AI行動閉環、死亡／世代生命週期仍未完成，測試通過不等於完整Cookie DONE。
- **較早工程證據摘要（implement_foundation，2026-10-20；80-test快照）：** 在 `D:\Henry\Documents\AI-land\island-sim` 執行 `npm run check`，回報 exit 0；`tsc --noEmit` pass，`node --experimental-strip-types --test src/**/*.test.ts` 為80 tests / 80 pass / 0 fail。列明 `src/engine/clock.ts`／`clock.test.ts`（72T日、48白+24夜）、`src/domain/combat.ts`／`combat.test.ts`（C-15使用`Math.round(HP/10 + equipment modifier)`，5/15/25半數測例）、`src/engine/tie-break.ts`／`tie-break.test.ts`（六欄降序、完全同值seed抽籤）、`simulation.ts`、`world.ts`／`world.test.ts`（Node1/8/13 beach點、seeded draws）、`simulation.test.ts`（磁碟SQLite關閉重開後snapshot seq/RNG、event draws與replay一致）。該快照曾記sleep逐人3T entry-anchor、T48–72含T72最後一次且無global timer，並稱risk outcome因來源機率欄空而unresolved；此風險狀態已由後續使用者規則和141-test工程報告更新。Bag 3 monsters/dungeon仍是純helper且runtime dispatcher integration pending；death/next-generation lifecycle亦未完成。此為工程代理歷史報告，未由本記錄代理重跑；80/80不代表完整17 Cookie DONE。
- **執行環境邊界（root，2026-10-20）：** host `127.0.0.1:4173` 與 API 200 為DB端回報；browser驗收及完整runtime尚未證明。除非另附瀏覽器／runtime證據，不把HTTP成功當作UI Crumb通過。

## Cookie 狀態與證據

狀態只採用 skill 定義的 DONE、BLOCKED、ROTTEN、FAILED。尚未完成驗證的 Cookie 不標 DONE；若尚未遇到必要缺失資源/資訊而無法繼續，不以 BLOCKED 代替一般待辦。


| Cookie | 執行概況（非結果狀態） | 已取得的完成證據 | 未完成／待核 |
|---|---|---|---|
| 1.1 | DONE | 2026-10-21快速Review逐Crumb核對：72T/48+24、WAIT=1T、移動3T同點Node結算、各已知地形夜間率與互斥事件池、睡眠每3T與存活後醒來、活躍營火免疫、SPD/居民tie-break、怪物行動1T及公開結果回饋均有源碼與既有測試證據；最新`npm run check` exit 0、160/160。 | 未映射Node的地形仍回報unresolved，歸屬Bag 2.1/2.3來源資料；營火的建立／點燃與保護期設定非1.1排程器Crumb；跨類型同SPD依Crumb維持unresolved。以上不阻止1.1核心排程驗收。 |
| 1.2 | DONE | 2026-10-22依使用者提供拓撲接入Node 21進入、地牢相鄰格行動、WorldState DungeonRuntime及SQLite同批提交；拓樸／runtime定向7/7、端到端simulation+SQLite 1/1、`npm run check` exit 0、typecheck通過、194/194。另引用既有DROP/GIFT、unique、72T物件例外、屍體成本與SQLite rollback測例。 | 正式1.2 Crumbs逐項通過。地牢Boss actor/FSM、樓層通行進展和Boss獎勵留在Bag 3，不在1.2完成聲明內。詳COOKIE_REVIEW.md「Cookie 1.2 Quick Review更新（2026-10-22；拓樸及主流程接線）」。 |
| 2.1 | DONE | 2026-10-21逐Crumb快速Review：28個Node／51唯一無向邊、連通、外圈1–16逐邊閉環、15↔25直連、分組場景標籤、使用者採用魚站/椰子節點及seeded居民出生點均有來源資料與測試；最新`npm run check` exit 0、typecheck通過、164/164 tests。 | 部分節點名稱仍按來源標記未逐點命名；這是刻意保留來源確定度，不阻止2.1拓樸／標籤Crumbs。
| 2.2 | DONE | 2026-10-21逐Crumb快速Review：初始狀態、背包格數、食用條件、普通物件72T、唯一裝備／屍體／自然椰子／碑文例外、屍體1T取放／跨Node移動3T均有實作與測試；已保留C-11腐敗起算未決與C-16落地椰子生命周期未決並fail-closed。最新`npm run check` exit 0、typecheck通過、164/164 tests。 | 食物三島日腐敗的起算事件留在C-11；庫存椰子落地及滿包採收落地留在C-16，對應行為不改變狀態且不假設72T。這兩個邊界已由Cookie Crumbs明示保留，不阻止已知範圍驗收。
| 2.3 | DONE | 2026-10-21 Cookie Review 更新：production `island_nodes.csv` 的沙灘Node 1、森林Node 9、河流Node 24、石堆Node 6直接載入並依現行規則分別命中30/35/35/30%；production 規則覆寫含蝙蝠:狼4:6，兩種選擇邊界有測試。定向測試18/18；`npm run check` exit 0、typecheck通過、165/165。既有釣魚、河流／岩石獨立池、森林兩階段率、椰子及睡眠證據見COOKIE_REVIEW.md。 | 不新增原地形池或條件森林outcome。來源未映射Node及未提供的具體原池結果仍依Crumb保留unresolved；production成功敵種以既有`monsters.csv`行解析。已知範圍完成且資料缺口保持隔離，不再以該缺口阻擋2.3。 |
| 3.1 | DONE | 2026-10-22補Production runner Dragon breath整合測試：完整`monsters.csv`與`attack_distributions.csv`載入，排程怪物在同cell對每位存活參戰者獨立抽20/21/22傷害，只影響同trip/floor/cell；定向1/1。其餘戰鬥公式、怪物共排程／1T冷卻、居民D-013排序、撤退、一般怪last-hit與滿包掉落、火蜥蜴唯一劍、龍血+10HP均由現行程式與測例覆蓋。C06與D-007測例新增後最新`npm run check` exit 0、typecheck通過、209/209（包含Dragon production測例）。 | Quick Review校正後，跨類型同SPD unresolved是Crumb要求；Boss資格與特殊勝利獎勵由3.2完成，不構成本Cookie缺口。詳COOKIE_REVIEW.md「Cookie 3.1 Production Dragon Quick Review」。 |
| 3.2 | DONE | 2026-10-22逐Crumb Quick Review更新：普通怪源參數／攻擊分佈、召喚最多一隻、雙擊獨立抽傷、史萊姆致死反傷、Boss1/2勝利與同遭遇存活者樓層資格、居民D-013同SPD排序均有實作與測例。Boss1嘲諷反擊、飛翔T邊界、最後一擊鐵防具／玻璃珠與資格；Boss2第五次突破、撤退區別、滿包地面獎勵均有新定向測試。原Quick Review時三層S格事件曾受D-007未決阻塞，已由本次3.3 D-007核准設定解除；3.2 Boss資格與獎勵不變。 | C-06／D-007樓層事件池權重屬Cookie 3.3範圍；D-007現已完成，不再阻擋三層事件結算。Quick Review詳COOKIE_REVIEW.md「2026-10-22 Cookie 3.2 Boss完整接線Quick Review」及後續3.3 D-007 Review。 |
| 3.3 | DONE | 2026-10-22容器規則及D-007覆寫後逐Crumb Quick Review：27個source label／46列映射至唯一inventory ID；七來源production開箱、1T成本、滿包72T地面物件與SQLite同批提交；唯一物件ledger；三層主事件池均合計300整數權重單位。第三層非第一排移出的8pp平均給灼熱泉水／遠古寶箱／探險者遺物，C-06飛濺11%與怪物50%不變。最新`npm run check` exit 0、typecheck通過、218/218；D-006已由使用者定案並同步接線。 | Cookie 3.3 Crumbs逐項已驗；所有含物品容器每次一件，雙階段權重不變。Review詳`COOKIE_REVIEW.md`「Cookie 3.3 D-007 非第一排事件率 Quick Review」及下方D-006覆寫。 |
| 4.1 | DONE | READ schema／action／settlement已接通；101個空白書籍文字槽、與漂流瓶分離的預留池、空白書籍catalog身份及獨立等機率picker均有測試。空白READ隱藏、fixture READ流程通過；`npm run check`曾218/218。 | 正式正文仍由使用者後續供稿，正式文本寫入／來源映射歸7.1；空白內容不阻擋4.1 AI/READ runtime驗收。漂流瓶池只預留、無正式玩法。 |
| 4.2 | DONE | 使用者決定交易停用；`simulation.ts`移除交易合法actions及dispatcher，偽造request/accept proposal被legal-action guard拒絕且狀態／物品不變；drop與message仍可用。停用定向測試1/1，typecheck通過。 | 交易停用是已決政策，不列待辦；舊交易協議與實作Review保留為歷史。 |
| 4.3 | DONE | Router將文字action IDs隨同action call提供BudgetedModelProvider；有效message proposal的同次input/output成本分類為message。Biography模型配置留空白手動配置佔位；空白時不呼叫、不自動生成。 | 目前沒有專用Biography模型選擇器或自動生成路徑；使用者日後手動配置前不觸發Biography模型。現行模型輸出契約不在4.3改動。message成本測例與既有retry／成本上限測試可查。 |
| 5.1 | DONE | 2026-10-22新增SQLite持久化事實測試，驗證角色交換後inventory、永久屍體、物件到期時點與公開文字事件都可讀回；既有磁碟重開測試驗證snapshot/RNG/event draws重播，原子批次、追加事件、sequence衝突與rollback已有store測試。定向測試42/42；`npm run check` exit 0、typecheck通過、171/171。 | Cookie Crumbs已有實測；內部schema保持D-002所限的implementation detail，未宣稱外部欄位契約已核准。地牢runtime主流程仍屬Cookie 1.2/3.3依賴，未混入5.1狀態。詳COOKIE_REVIEW.md。 |
| 5.2 | DONE | 2026-10-22使用者決定C-14次日晨一次補足至10人；新增兩名同夜死者回歸測試，T72單次`daily-survival-settled`批次補出兩個generation 2，活居民總數10。定向1/1；`npm run check` exit 0、typecheck通過、191/191。既有fresh vitals/空inventory、seeded出生、intent私有、死亡世界痕跡及玩家專屬傳記測試引用自既有Quick Review。 | 全Cookie Crumbs逐項速查通過。C-14決策記於`DESIGN_DECISIONS.md`，舊BLOCKED Review標示已被新Review取代。詳`COOKIE_REVIEW.md`「Cookie 5.2 Quick Review更新」。 |
| 6.1 | DONE | 2026-10-22補主島實際投影51條唯一道路測試；補接居民`lastActionResult`至玩家觀察投影並顯示上一行動結果，UI/adapter定向測試9/9；`npm run check` exit 0、typecheck通過、172/172。 | quick Review逐項核對28 Node/51邊、代次/模型/HP/飽食/裝備/背包/上一行動結果、Node/角色ID區分、標籤確定度、玩家與AI視野分離、單窗tabs與響應式格線/字級CSS。詳COOKIE_REVIEW.md。 |
| 6.2 | DONE | 2026-10-22接通公開短訊事件文字至玩家時間線，增加HTTP測試證明pause/resume/已配置speed請求送達runtime control port；既有投影僅納入已結算public/player-only事件、傳記分欄player-only展示。UI/adapter定向測試11/11；`npm run check` exit 0、typecheck通過、174/174。 | 只讀時間線、公開訊息與傳記顯示、控制入口、單窗切換、10槽、server記憶體key與響應式格線/字級有程式/HTTP測試證據。NPC跨Node可見範圍未因此變更；詳COOKIE_REVIEW.md。 |
| 6.3 | DONE（依使用者指定的紀錄審核方式） | 2026-10-25依使用者明確指示直接讀現有紀錄判定通過。檢視 `qa/screenshots/observer-desktop.png`、`observer-narrow.png`、`observer-desktop-settings.png`、`observer-narrow-settings.png`：涵蓋觀察台世界地圖與模型設定兩頁，桌面1440×900、窄視窗390×844；現有紀錄另列開始設定、居民／事件／總結／狀態頁及editor頁面範圍。 | 此DONE依使用者本輪指定的紀錄審核接受方式；不宣稱已完成全路由、全頁面雙尺寸的runtime／browser視覺E2E。現存4張QA圖只覆蓋上述兩頁；其他頁面沒有可核驗的桌面及窄視窗截圖。本次不新增UI修改。詳COOKIE_REVIEW.md「Cookie 6.3 紀錄審核接受」。 |
| 7.1 | DONE | 2026-10-22依正式Crumbs核對排程、分層事件池、唯一裝備、權限可見性、重播、客觀歷史及UI唯讀邊界；正式世界文本寫入／來源映射納入7.1，僅於使用者供稿後落地，未供稿保持空白。 | DONE表示跨Bag契約Review與文本維護責任／來源規則已記錄，不代表未提供文本已撰寫或runtime整體完成。4.1–4.3現為DONE；1.2、3.1–3.3及5.1/5.2等狀態詳本表。 |
| 7.2 | DONE | 2026-10-22快速Review核對原始Reference索引19份Markdown、16份CSV；新增專案維護的容器身份、功能道具及獨立閱讀池/空白文本表已標示非原始檔。岩縫15/15/70標為作廢、現行5/5/90；D-006依本輪使用者決定更新為全部含物品容器每次一件。 | 來源索引與維護約定符合Crumbs；保持歷史與現行覆寫可區分。詳COOKIE_REVIEW.md「Cookie 7.2 Quick Review」及D-006覆寫。 |
| 7.3 | DONE | 原C-7.3-01至05歷史證據保留；C-7.3-06至09均有focused驗收：資料庫重開/profile隔離、保存UI失敗與重試、observer mapId及legacy default fallback、共享CSV不變與跨儲存回復；28/28通過。 | 沒有browser E2E；Crumbs未要求browser。typecheck剩餘7項診斷，精確輸出見本Log末段；無修改前基線，不能判定成因，且不屬本Crumb明列門檻。LAN使用HTTP、無TLS；本輪不要求DNS／子域。 |

### 2026-10-22 Cookie 7.3 範圍更新：Island 編輯器與地圖檢視切換

- **範圍變更：** Cookie 7.3本輪改為同IP子域名編輯器（文本卡CRUD、書籍／漂流瓶分池、Node告示綁定、Node／地圖編輯保存、備份、驗證、匯入匯出）及主網域地表／地牢地圖檢視切換；原AI prompt／return-format個人化微調保留為後續項。
- **驗收標記：** 定義C-7.3-01至C-7.3-05；目前IN PROGRESS／待驗收，未標DONE。部署範本不作為DNS或正式部署完成的證據。
- **歷史段落說明：** 本Log較早段落中「下一Cookie目前BLOCKED／等待AI prompt與回傳格式微調」只反映舊範圍，已由本次範圍更新取代；原文保留作歷史，不代表目前狀態。2160T相關記錄不受此更新影響。

### 2026-10-22 Cookie 7.3 證據核對（初次狀態；已由下方往返驗證覆寫）

- **C-7.3-01 — IN PROGRESS：** `island-sim/src/ui/editor.ts`有新增／套用／刪除文本卡及pool選擇實作，`readable_document_pools.csv`維持分池；但`editor.test.ts`未做瀏覽器互動或CRUD持久化往返測試。
- **C-7.3-02 — IN PROGRESS：** `editor.ts`讀寫`node_notices.csv`；`src/content/actions.ts`載入及驗證綁定；`src/engine/world.ts`同步告示至runtime，`src/engine/world.test.ts`有runtime同步測試。缺editor儲存後重讀整合測試。
- **C-7.3-03 — IN PROGRESS：** `editor.ts`實作Node／座標／連線編輯、驗證、保存、時間戳備份、JSON匯入匯出；缺保存／備份／匯入匯出端到端往返測試。
- **C-7.3-04 — DONE：** `src/ui/observer.ts`渲染地表／地牢選項及地牢樓層；`src/ui/server.ts`處理切換與查詢狀態；`src/ui/observer.test.ts`測試地牢選擇與視圖渲染。此為程式及測試證據，未單獨做正式主網域瀏覽器部署驗證。
- **C-7.3-05 — DONE（範本與狀態揭露）：** `deploy/nginx-editor-subdomain.example.conf`提供同機反向代理／Basic Auth範本；`deploy/editor-subdomain.md`明確指出repo未設定DNS或部署。實際DNS與正式部署未發生，不宣稱已部署。
- **驗證：** 初次核對時執行`npm run check`，exit 0；typecheck通過，tests 256/256。當時editor持久化往返證據尚缺，故暫列IN PROGRESS；此狀態已由下方往返驗證後覆寫。AI prompt／return-format個人化微調留作後續；原有2160T長測條目未改。

### 2026-10-22 Cookie 7.3 往返驗證後狀態覆寫

- **C-7.3-01至03 — DONE：** `island-sim/src/ui/editor.test.ts`新增臨時目錄CSV往返測試，驗證文本卡新增／編輯／刪除及分池資料、Node名稱／描述／座標與連線保存重讀、Node告示綁定保存重讀；載入保存後的simulation content並核對runtime READ action可用。`editor.ts`另有驗證、時間戳CSV備份、JSON匯入／匯出實作；往返測試驗證備份含舊資料。
- **C-7.3-04 — DONE：** `observer.ts`／`server.ts`和`observer.test.ts`提供地表／地牢選擇、樓層選擇及視圖渲染證據。
- **C-7.3-05 — DONE（範本及狀態揭露）：** Nginx範本與部署說明提供同IP子域路由配置，且明確指出repo未設定DNS或正式部署；實際DNS與部署未發生。
- **最終狀態：** `npm run check` exit 0，typecheck通過、257/257 tests；本輪C-7.3-01至05均DONE，Cookie 7.3本輪範圍及Bag 7 Review改為DONE。AI prompt／return-format個人化微調保留為獨立後續項，不阻擋本輪完成。此覆寫不更動既有2160T長測結果或其歷史狀態。

### 2026-10-22 Cookie 7.3 C-7.3-05 本機LAN運行證據增補

- **本機運行：** `http://192.168.0.120:4173/editor` 實際運行於LAN。本機LAN Basic Auth未認證請求回應401；已認證editor API回應200並讀回28個Nodes。認證資訊未記錄於本Log。
- **傳輸限制：** 此本機服務使用HTTP、沒有TLS。既有Nginx HTTPS範本不是本機服務已啟用TLS的證據。
- **部署邊界：** C-7.3-05由「僅部署範本與狀態揭露」更新為「本機LAN app運行及認證API已驗證」；公網DNS及正式外網部署仍未發生，沒有已上線聲明。Cookie／Bag狀態維持DONE。`npm run check` exit 0、typecheck通過、258/258 tests。AI prompt／return-format個人化微調仍為獨立後續項。本補充不改動2160T歷史記錄。

### 2026-10-22 Cookie 7.3 C-7.3-05 匿名同IP路由狀態更正

- **現行路由：** Basic Auth與Nginx子域模板已移除；模板已移至資源回收桶。本機app使用同IP `/editor`，不要求DNS或子域設定。匿名實測`/editor`頁面、editor API及observer API均回應200。
- **歷史證據：** 上一段記錄的Basic Auth 401／認證後200及Nginx範本只適用於先前版本，現已失效；保留作歷史，不代表現況。
- **驗證邊界：** 最新開放路由改動以typecheck clean及定向路由測試驗證；258/258為此前版本的完整`npm run check`，最新改動後未重跑完整套件。LAN服務仍為HTTP、無TLS。Cookie 7.3及Bag 7狀態維持DONE，沒有DNS要求；本補充不改動2160T歷史，AI prompt／return-format個人化微調仍為獨立後續項。

### 2026-10-22 Cookie 7.3 迷你品牌空框架建立（舊範圍，已由D-021更新）

- **授權與範圍：** 使用者明確要求新增一個空的mini branding Cookie，主題為文本寫入與個性化微調；安排在引擎完成後，可獨立執行且不影響引擎整體運行。具體內容與驗收條件尚未提供。
- **變更：** `PROJECT_BRANDING.md` Bag 7新增Cookie 7.3空框架；`DESIGN_DECISIONS.md` D-021記錄新增授權；本Log更新目前Cookie總數18；COOKIE_REVIEW記錄快速檢查結果。未改runtime。
- **狀態：** BLOCKED，僅缺Cookie細節與可驗收Crumbs；不得解讀為引擎未完成使原有Cookie受阻，也不得標DONE。

## 2026-10-21 交接與停止新增實作

使用者要求暫停新增實作，先同步可供下一 AI 接手的狀態。根目錄 [HANDOFF.md](../HANDOFF.md) 為精簡入口，列有閱讀順序、Git/執行環境、目前實作與未接線邊界、來源地圖標註差異及近期驗證。此工作區與 `island-sim` 均非 Git repository，沒有 remote；不得描述為已同步至 Git。

本次新鮮核查（工程代理，2026-10-21 13:18:43 Asia/Taipei）：`npm run check` exit 1，停在 typecheck；`dungeon-runtime.test.ts:6:69` TS2307 缺少 `./dungeon-runtime.ts`，39:38、80:43、81:38 的 event implicit any 為該缺模組衍生；`simulation.ts:273:10` 未解析 `isSurfaceAction`，281:7 `string` 無法指派 `SurfaceAction`。因此 check 未執行 tests。另行 `npm test` exit 1，145 tests／144 pass／1 fail，唯一失敗為載入測試檔時 `ERR_MODULE_NOT_FOUND`（缺少 runtime module）。不得刪除測試或建立stub假綠。此為當下可見失敗，不等同已完成修復或任何 Cookie 狀態變更；歷史141/141通過不是當前狀態。

CLI 入口依 `src/ui/server.ts` 的直接執行判斷為 `node --experimental-strip-types src/ui/server.ts`，會開啟/建立 SQLite 並啟動 SimulationRunner，本次未啟動。對 `http://127.0.0.1:4173/` 的 GET（max 5s）失敗（curl exit 7／HTTP 000，2.015秒）；`Get-NetTCPConnection -LocalPort 4173 -State Listen` 無結果，當時沒有服務在聽。無法據此宣稱 UI/browser 驗收通過。模型 API key 僅存程序記憶體，服務重啟後須重新輸入；本次無真實付費 provider E2E 證據。

交接後若使用者未恢復實作，不新增功能。恢復後先處理上述有界失敗slice並重新核查，再選單一 Cookie/Crumb 對照契約與證據；歷史 141/141 測試快照不代表目前通過，也不代表 Cookie DONE。原始 ZIP、CSV、PNG 與 SQLite 資料保留。

### 2026-10-21 有界 build failure 修復（Cookie 2.3／3.3 局部）

- **範圍：** 使用者恢復 Cookie 工作後，先修復最新 fresh check 指向的缺失 `src/engine/dungeon-runtime.ts` 與 surface action type diagnostics；不處理 Cookie 1.1 WAIT，亦不改正式規則。
- **變更：** 新增 dungeon runtime step resolver，重用 `domain/dungeon.ts` 的來源事件抽選及 D-007 gate，產生格子事件草稿；濕滑水道依既有 helper 產生額外黏液怪遭遇。於 `domain/surface.ts` 增加 `isSurfaceAction` 型別守衛並由 `engine/simulation.ts` 使用，使 payload 字串先經聯集型別檢查再送入 resolver。
- **驗證：** 修復前 `node --experimental-strip-types --test src/engine/dungeon-runtime.test.ts` 因模組缺失失敗；`npm run typecheck -- --pretty false` 回報缺模組、衍生 implicit-any 與 `isSurfaceAction`／`SurfaceAction` diagnostics。修復後 dungeon runtime、dungeon domain、surface domain 專項共 31/31 通過；`npm run typecheck -- --pretty false` exit 0；完整 `npm run check` exit 0，148/148 tests 通過。
- **Cookie 狀態與邊界：** 不變更 Cookie 2.3 或 3.3 的 DONE 狀態；新 resolver 尚未接入完整 simulation dispatcher，地牢戰鬥／Boss／掉落等完整 Cookie Crumbs 未由本次驗證。這次測試結果只證明以上既有測試和型別檢查通過；Cookie 1.1 WAIT 未處理。

### 2026-10-21 Cookie 1.1 WAIT=1T 局部執行

- **決策與授權：** 使用者於2026-10-21明確決定WAIT行動成本為1T（D-010/C-10），並另決定每個戰鬥回合=1T（D-009/C-08/C-09）。Boss1飛翔無敵限於該次飛翔行動；水豚前3個交手回合熟睡即3T，不新增窗口或改原回合數。
- **變更檔案：** `island-sim/src/engine/simulation.ts` 將已存在的WAIT成本以 `WAIT_ACTION_COST_T = 1` 命名常數表示；`island-sim/src/engine/simulation.test.ts` 新增整合案例，確認WAIT提供1T、提案3T會被拒、提案1T成功，只有等待居民的 `nextActionAtT` 由0變1且其他九名居民維持T5，排程下一時間為T1。測試在常數整理前已通過，表示原有執行路徑已有該行為；本次以明確常數及回歸案例固定規則。
- **Crumb 證據：** 72T／48T白天／24T夜晚由 `clock.test.ts` 驗證；WAIT/1T個體更新與3T移動由 `simulation.test.ts` 驗證；同時點速度、D-013屬性優先與完全平手seeded重播由 `tie-break.test.ts` 及整合排程案例驗證；死亡排除由 `clock.test.ts` 驗證；夜間SLEEP至天亮、遭攻擊先傷害且只喚醒存活者由 `simulation.test.ts` 驗證；安全區不觸發及不安全區逐人entry-anchor每3T／最多8次由 `night-risk.test.ts` 驗證。來源風險表缺失時維持unresolved並讓排程繼續，未創造缺值。
- **實際命令結果：** `node --experimental-strip-types --test src/engine/clock.test.ts src/engine/tie-break.test.ts src/engine/night-risk.test.ts src/engine/simulation.test.ts`：36/36通過；`npm run typecheck -- --pretty false`：exit 0；`npm run check`：exit 0，typecheck通過、149/149 tests通過。
- **Cookie 狀態：** **BLOCKED**，不是DONE。C-08/C-09的T映射已由使用者明確決定；真正未完成的是monster actor尚未進入WorldState共用佇列，Bag 3.1 integration依賴未滿足。WAIT=1T及本次可驗Crumbs有測試證據。C-11食物腐敗起點屬Cookie 2.2，不納入本次處理。

### 2026-10-21 Cookie 3.2 自動怪物行動局部切片

- **目標與邊界：** 依使用者明確規則，以每個戰鬥回合=1T實作來源表驅動的純怪物行動結算單元；不新增WorldState欄位，不接地牢進格、持久化或runner，不擴展掉落／生成率／未知傷害權重。
- **變更檔案：** `island-sim/src/domain/monsters.ts` 新增 `resolveScheduledMonsterTurn`：讀取怪物既有數值列，使用既有攻擊分佈；巨鼠等表列雙擊各自抽目標與傷害；Boss1依75/12.5/12.5選啄擊／飛翔／嘲諷，飛翔只回報本次行動無敵；每個成功結算行動更新至下一T，回傳結果、抽籤與未解狀態。`monsters.test.ts` 加入巨鼠雙擊時間與Boss1非攻擊行動測例。
- **Crumbs：** 已驗「一怪物行動排於其來源nextActionAtT，下一次可行動時間加1T」，resolver回傳來源SPD供排程器使用；巨鼠雙擊、Boss1飛翔／嘲諷成本各1T亦通過。此為domain unit證據，不代表共用speed排序或持久化事件整合已完成。
- **驗證：** 先執行目標測試，缺少新export而失敗；加入resolver後 `node --experimental-strip-types --test src/domain/monsters.test.ts` 17/17通過；`npm run typecheck -- --pretty false` exit 0；`npm run check` exit 0，151/151 tests通過。
- **Cookie 狀態：** Cookie 3.2 **BLOCKED**（Cookie 3.1共用排程／戰鬥結算尚未完成）。C-08/C-09不再是缺值。當前程式缺口是DungeonRuntime事件未將怪物建立為WorldActor、runner不處理monster-action，且純resolver未生成持久化結果事件；真正未回查值仍為C-05龍傷害細分、C-06熔岩飛濺權重、C-07 Boss2命中率適用方與次序，以及來源空白的生成率。Bag3 Review要求未知值隔離，不妨礙此局部切片；本次未宣稱完整Cookie DONE。

### 2026-10-21 移動結算、區域遭遇與怪物行動接線（Cookie 1.1／3.1／3.2 有界 slice）

- **驗收目標：** 依使用者最新規則，移動action成本仍是3T；角色到達排程時點結算該移動、立即更新目標Node，並在同一結算點抽適用區域遭遇；不得另等一個抵達timer。命中且明確映射至怪物來源列才建立怪物actor；怪物按其來源速度／行動時點自動行動，行動結果回饋同Node居民與AI，AI再選後續合法行動。
- **變更檔案：** `island-sim/src/engine/simulation.ts` 移動結算寫入目標Node、保留 `nextActionAtT = scheduled time + 3`、搬運中屍體物件同步更新位置；於森林9/17/23使用者採用節點設定，在同一結算調用既有D-019森林risk抽取；selected negative outcome僅在ID與 `monsters.csv.name` 完全相等時生成actor。加入monster action排程，優先比較行動時點，再比較SPD；跨種類同SPD及多怪同SPD無規則時保留unresolved。怪物自動結算產生公開 `monster-action-settled` 事件並更新居民結果。居民現在可選擇攻擊同Node怪物。`island-sim/src/domain/monsters.ts` resolver依monster欄精確選攻擊分佈，並實作來源列「大大水豚熟睡3交手回合」為三次各1T熟睡行動後依 `awake_normal` 攻擊；Boss1與既有雙擊行動仍走既有行為。`content/actions.ts` 載入攻擊分佈；`ai/simulation-runner.ts` 自動結算怪物行動不呼叫模型；`ai/view.ts` 將移動到達／遭遇及怪物行動結果轉成同Node AI可讀事件。
- **Crumbs 實測：** `simulation.test.ts` 驗證移動cost仍3T、結算時WorldState／持久化snapshot立即更新Node、沒有新travel timer；注入明確森林outcome table時同一settlement抽取且只生成source-name相符野豬，非monster負面outcome不生成actor；spawn actor進入排程並自動行動、結果更新居民且nextActionAt每次增加1T；居民可在同Node選擇攻擊monster。`simulation-runner.test.ts` 驗證runner自動commit怪物行動、沒有provider請求。`monsters.test.ts` 驗證水豚3次1T熟睡後第4次攻擊及既有怪物行為。`ai/view.test.ts` 驗證怪物上回合結果可出現在下一AI輸入敘述。執行前紅測曾顯示spawn後仍選到resident-action而非monster-action；加入排程／runner結算後轉綠。
- **真實缺值與邊界：** 本checkout沒有森林條件outcome table；`loadSimulationActionContent`無該表，`monsters.csv`森林野豬生成率欄空白。測試注入表只證明接線，不代表目前生產設定能抽出野豬；沒有補造野豬率或outcome權重。`resolveScheduledMonsterTurn`仍未串起所有已存在FSM helper（例如召喚、食人花吞食、史萊姆反傷、Boss2）；怪物被擊敗時完整掉落／獎勵、死亡身後資料未接入；跨類型或多怪同速沒有核准平手規則，會fail closed。DungeonRuntime事件生成仍未建立同一WorldActor；本次不宣稱地牢端到端完成。
- **實際命令結果：** 專項 `node --experimental-strip-types --test src/ai/simulation-runner.test.ts src/engine/simulation.test.ts src/domain/monsters.test.ts src/ai/view.test.ts`：53/53通過；`npm run typecheck -- --pretty false`：exit 0；全套 `npm run check`：exit 0，typecheck通過、157/157 tests通過。
- **Cookie 狀態：** Cookie 1.1、3.1、3.2仍為 **BLOCKED**，不是DONE。已接線Crumbs可重播驗證；阻止完整驗收的是缺失的森林條件遭遇資料、未接完的來源定義FSM／擊殺獎勵流程，以及跨種類同速政策缺口。C-08/C-09戰鬥回合T值已由使用者決定，不能再列為BLOCKED理由。未改Cookie 2.3／3.3範圍或未知機率。

### 2026-10-21 地表夜間規則修正版接線與驗證（Cookie 1.1／2.3）

- **現行授權規則：** 使用者修正版覆蓋D-019舊夜間17.5%假設。夜間移動結算時先按地形抽遇敵：沙灘30%、森林35%、河流35%、岩石區30%；命中無視防禦扣1HP，僅在成功後按夜間蝙蝠:夜狼=4:6選敵，並結束本次地表事件；失敗才抽原地形池，池不合併。危險區睡眠每3T用所在Node率抽，不抽地形池；有效點燃且仍在保護時效的營火Node跳過；成功扣1HP後仍存活才醒來處理遭遇，固定傷害每次只扣一次，怪物後續攻擊獨立。睡眠24T最多8次沿用既有規則。
- **變更檔案：** `island-sim/src/content/surface-user-overrides.ts`記錄新率、4:6權重與固定1HP，舊17.5%睡眠正規化移除；`domain/night-encounter.ts`按Node來源標籤分類、只在遇敵成功後按4:6選敵並映射既有怪物來源列；`domain/forest-risk.ts`與`domain/surface.ts`移除舊睡眠正規化器；`domain/model.ts`加入可保存的營火`lit`狀態；`engine/simulation.ts`把抽取接在移動抵達結算，活動營火免除敵人抽選，睡眠檢查使用Node率並實作命中扣血、存活醒來及4:6敵種處理；`domain/surface.test.ts`、`engine/simulation.test.ts`補充地形率、權重界線、移動互斥池、睡眠傷害／死亡及營火測例。另將`domain/surface.ts`來源摘要欄位改為all-node night classification，修復Reference已更新後仍用舊森林標籤的來源覆蓋測試。
- **Crumb 實測：** 地形測試逐一確認30/35/35/30率的命中／未命中邊界；敵種測試確認4:6分界，並只在命中後消耗第二抽籤；夜間移動測試驗證命中固定-1HP、建立選定怪物且不抽地形池，未命中只抽地形池；另外驗證有效點燃營火在夜間移動抑制遭遇但保留獨立地形池。睡眠測試驗證每3T用所在Node率、不抽地形池、命中固定扣1HP後僅存活者醒來，致死時不醒且不生成後續怪物；未點燃或過期營火不豁免；後續怪物攻擊另作事件結算。移動仍為3T，抵達Node與抽取在同一次action settlement，未新增travel timer。
- **失敗與修復證據：** 首次定向測試49項中48通過，1項舊來源摘要測試仍依賴`所有非營火保護`字串；Reference已改成有效點燃營火的精確標籤，故摘要helper未將夜敵標為全Node夜間遭遇。將helper欄位改為`relevantToNightEncounter`並以精確現行標籤判斷後，該回歸測試通過。再新增營火移動測試後，`node --experimental-strip-types --test src/engine/simulation.test.ts`為29/29；`node --experimental-strip-types --test src/domain/surface.test.ts src/engine/night-risk.test.ts src/engine/simulation.test.ts`為49/49。最終`npm run check` exit 0，`tsc --noEmit`通過、160/160 tests通過。
- **真實程式／資料缺口：** 地形率僅能對具來源沙灘／森林／河流／岩石標籤的Node分類；未分類Node回報unresolved，不猜地形。多數Node尚未提供原地形事件池資料；測試注入資料只證明分支接線，非production設定。模型可記錄`lit`和有限`expiresAtT`，但當前遊戲沒有建立／點燃營火的行動流程，故實際玩家流程尚不能產生有效保護狀態。這些是程式／資料接線缺口，不是待使用者補的機率或4:6決策。
- **Cookie 狀態：** Cookie 1.1、2.3均不宣告DONE。夜間移動→地形遇敵→固定傷害→成功後選敵／怪物生成→後續攻擊獨立、及危險區睡眠檢查已有可重播測試；完整Cookie仍受未分類Node、production原地形池缺表、營火建立／點燃流程及其他Crumbs未驗限制。Cookie 1.1另有跨類型同SPD規則未決；此不影響已驗地表結果，不得再列WAIT、戰鬥回合T、地形遇敵率或敵種權重為缺值。舊D-019 17.5%及非野外睡眠正規化僅保留歷史標示，不作現行規則。

### 2026-10-21 Cookie 順序與完成率檢查

- `PROJECT_BRANDING.md`列出17個Cookie；`EXECUTION_LOG.md`狀態表有17列，目前0列為DONE，因此未完成17/17（100%）。
- 按既定順序下一項是Cookie 1.1，狀態BLOCKED。已完成其夜間規則可落地slice並做定向／完整測試；剩餘阻塞包含未知地形的可靠Node對應、營火保護有效時長如何設定，以及resident/monster同SPD且缺少居民欄位時的比較規則。現有來源未提供這些所需數值／語義，不能推定或跳過到1.2。
- 依「不得跳過未滿足依賴」流程，本次不啟動1.2或後續Cookie；完成率目標≤50%尚未達成，需先補足上述規則或以新的明確範圍決策解除阻塞。

### 2026-10-21 Cookie 1.1 快速 Review 結論

- **結論：** passes。對照 `PROJECT_BRANDING.md` Cookie 1.1 Goal／Crumbs、Reference 02與06、現有實作及最近完整測試證據；逐項表格見 `COOKIE_REVIEW.md` 的Cookie 1.1快速Review。Cookie 1.1設為DONE。
- **邊界判定：** Node terrain ID映射由Bag 2.1提供；缺映射時scheduler保留unresolved，不猜地形，此為地圖／地表內容未完成，不是1.1 clock/scheduler未實作。營火建立／點燃和具體有效期屬物件來源／互動流程；1.1驗證排程器依`lit`與`expiresAtT`狀態正確跳過。Resident／monster同SPD沒有核准規則，Cookie 1.1 Crumb明定維持unresolved，並非缺少實作的排序演算法。
- **新順序狀態：** 共17 Cookie；1.1 DONE、其餘16未完成（94.1%）。下一項Cookie 1.2依序開始；本快照所記0 DONE與1.1 BLOCKED已由本次Review取代。

### 2026-10-22 Cookie 4.2 交易 action runtime 接線（歷史，後續停用）

- **決策／範圍：** 使用者明確決定：發起者指定提供物品與索取物品；接收者接受或拒絕。沿既有一換一交易helper，不擴寫多物品bundle、跨Node可見規則或背包查詢能力。
- **變更檔案：** `island-sim/src/engine/simulation.ts` 將交易請求與回覆加入合法行動列表及dispatcher，pending offer存入WorldState；接受時重驗參與者、同Node、持有物和唯一物品ledger並一次交換，拒絕只關閉offer且不移物。`domain/social.ts`公開交易事件記錄offer雙方和指定物品；`domain/model.ts`保存pending／accepted／rejected狀態。`simulation.test.ts`新增端到端接受、拒絕及失物競態測試。
- **Crumbs／Review：** action成本1T；發起者指定提供／索取項目；接收者收到offer action可接受或拒絕；發起請求不改變對方下一行動時點；接受轉移唯一勇者劍時owner ledger更新；物品在回覆前消失時原state不變且offer仍pending。`COOKIE_REVIEW.md`「Cookie 4.2 Quick Review更新」逐項標為DONE；跨Node即時傳播依Crumb維持未決。
- **驗證：** 交易定向命令 `node --experimental-strip-types --test --test-name-pattern="trade request and response use resident actions|trade rejection is a one-T recipient action|trade acceptance revalidates ownership" src/engine/simulation.test.ts`：3/3通過。完整 `npm run check`：exit 0，`tsc --noEmit`通過、186/186 tests通過。測試先因缺少交易action而失敗，接線後通過。
- **狀態：** Cookie 4.2 DONE（已知Crumbs）。未宣稱交易pending offer經單獨SQLite close/reopen測試；其位於WorldState，後續仍可由一般snapshot路徑持久化。

### 2026-10-22 Cookie 4.2 依使用者決定停用交易（舊BLOCKED狀態，已由決策完成狀態覆寫）

- **決策／範圍：** 使用者明確要求交易先關閉，原因是會洩露情境外資訊並增加上下文負擔；後續方案待使用者重新設計。公開短訊、丟棄物品持續可用。
- **變更：** `island-sim/src/engine/simulation.ts`移除交易request/response的availableActions及dispatcher分支。`settleNextAction`本來即按當前`availableActions`精確比對action ID／cost／payload；因此舊格式偽造proposal也不能繞過。保留舊snapshot的`pendingTradeOffers`欄位但不再提供交易行動。更新Reference 00/08、Cookie 4.2 Review及本Log狀態；舊的DONE記錄標為歷史。
- **驗證：** 新`simulation.test.ts`定向測例先在舊交易actions存在時紅，停用後綠；驗證request與accept proposal均被拒絕且WorldState、雙方庫存、pending offer不變，同時合法公開訊息真實結算、普通魚丟棄真實結算。`node --experimental-strip-types --test --test-name-pattern="trade actions are disabled" src/engine/simulation.test.ts`通過1/1；`npm run typecheck`通過。
- **當時狀態／Quick Review：** 本段原將Cookie 4.2改為BLOCKED；使用者後續確認交易停用是已決政策，現行DONE狀態見本Log及`COOKIE_REVIEW.md`末段覆寫。

### 2026-10-22 Cookie 4.1 READ capability及4.3 message成本接線

- **4.1範圍與變更：** 依Reference 14讀後報幕，新增`WorldObject.readableTextId`與`SimulationActionContent.readableTexts`映射。僅當物件位於居民當前Node、非屍體／容器且映射正文非空時顯示1T READ；settlement重新驗證映射後寫入`object-read`公開事件，AI view只由已完成事件呈現原文。未補任何正式正文或猜映射；使用者提供資料後才可啟用production物件。
- **4.1測試：** `simulation.test.ts`驗證無映射及純空白映射時均無READ、讀前AI輸入不含正文、有效1T讀取後報幕包含輸入的fixture文字；定向1/1通過。`04_生存物品與裝備.md`補充文字與物件映射由使用者後續供稿，空白內容不可當成已讀。
- **4.3範圍與變更：** Router把本輪文字action ID帶入同一次provider action call；`BudgetedModelProvider`辨識符合action JSON形狀、intent/text長度與message ID的proposal，將該次完整input/output費用記為`message`；普通action維持`prompt`／`output`，retry仍記`retry`。不新增model或價格資料。
- **4.3測試：** router傳遞message action IDs定向1/1、provider同次呼叫message成本定向1/1通過。現行workspace與References窄查`intend bio`仍未找到指定格式檔或模型字段；不猜模型、不接自動Biography provider路徑，死亡後呼叫與`biography`成本Crumb仍待該配置來源。
- **4.2 Reference核對：** Reference 00/08已有交易停用覆寫；Reference 01原動作白名單曾仍稱`TRADE_REQUEST`有獨立流程，已改標歷史白名單並明示此action目前不可用；與`availableActions`/legal-action guard及停用測試一致。
- **當時狀態（後續覆寫）：** 本段原記錄4.1、4.2、4.3維持BLOCKED；已由本Log末段2026-10-22使用者決策覆寫。當前狀態見Cookie狀態表。

### 2026-10-22 Cookie 3.2 巨龍最後一擊治療接線

- **範圍：** 依Reference 07「巨龍最後一擊者取得龍血 +10HP」及既有`planBossVictoryRewards` helper，只接通最後一擊治療；不接入Boss1/2通行權或未定的隨機防具權重。
- **變更檔案：** `island-sim/src/engine/simulation.ts` 在resident攻擊致死巨龍時，依同Node存活居民形成參與者清單，使用既有helper驗證last hitter並直接增加10HP，公開事件記錄治療量。`simulation.test.ts`新增致死巨龍案例，HP20→30、事件含10HP且Boss死亡。
- **驗證與Review：** 新測試先紅（治療未接線，HP維持20），接線後定向測試通過。最新`npm run check` exit 0、typecheck通過、187/187。`COOKIE_REVIEW.md` 3.2表已把此切片標通過；Cookie仍BLOCKED，因Boss1/2通行資格／獎勵及來源未決戰鬥值未完成。

### 2026-10-22 Cookie 3.1 火蜥蜴唯一勇者劍接線

- **範圍：** 依Reference 07中火蜥蜴在勇者劍不存在於世界時保證掉落的條件；不更動火蜥蜴炸彈額外池，也不新增Boss規則或機率。
- **變更檔案：** `island-sim/src/engine/simulation.ts` 致死攻擊結算先用`canRespawnUniqueItem`檢查所有居民inventory/equipment及未到期地面副本；符合時背包有空格即給最後一擊者並更新唯一owner ledger，滿包則於當前Node生成不過期unique WorldObject。事件記錄`uniqueHeroItemId`。`simulation.test.ts`新增滿包場景證明生成地面唯一勇者劍。
- **驗證與Review：** 新增三個定向測試覆蓋滿包生成、不滿包持有及已有人持有時防重複，定向3/3；`npm run check` exit 0、`tsc --noEmit`通過、190/190。第一次防重複測試誤把火蜥蜴獨立炸彈池視為無物品，失敗顯示取得「炸彈」；修正斷言只檢查勇者劍不存在後通過，沒有改動炸彈規則。`COOKIE_REVIEW.md`已逐項記錄本切片與剩餘Crumb。
- **狀態：** Cookie 3.1仍BLOCKED。Boss1/2資格／獎勵與其他未列出怪物的掉落資料仍未完成或無來源；跨類型同SPD仍按Crumb unresolved。火蜥蜴兩側條件皆有定向runtime證據。

### 2026-10-22 Cookie 5.2 C-14 次晨補人批次驗收

- **決策：** 使用者明確指定同夜多人死亡後，次日早晨一次補足至10人；`DESIGN_DECISIONS.md` C-14已記錄該決定。
- **程式／測試：** 現有`settleNextTimerEvent`在同一dawn settlement遍歷十個slot並填補缺額。本輪新增`simulation.test.ts`回歸測試，兩位slot於T60死亡，T72同一次`daily-survival-settled`事件產生兩個新世代，最終存活居民10名。
- **驗證與Review：** 新增定向測試1/1；`npm run check` exit 0、`tsc --noEmit`通過、191/191。`COOKIE_REVIEW.md` 5.2 Quick Review已更新為DONE，較早BLOCKED段標為歷史狀態並由此更新取代。
- **狀態：** Cookie 5.2 DONE（正式Crumbs）。此結論只覆蓋5.2世代／死亡／補人／隱私範圍，不表示Bag 5其他Cookie或自動生成傳記已完成。

## 後續紀錄格式

每次 Cookie 更新須提供 Cookie ID、單一 Cookie 狀態、變更、逐 Crumb 證據、未解項及跨 Bag 影響。Bag 宣稱完成時，另執行 Completed Bag Review，不以個別 Cookie DONE 代替 Bag Completion Condition。

## Cookie 1.2 接續執行與Quick Review（2026-10-22）

- **使用者拓撲：** 三層同圖`  x  x\nS x x E\n  x  x`。cell映射為入口S、三條平行支線A1→A2／B1→B2／C1→C2、匯合Boss格E；每條S至E最短3步。
- **程式改動：** `src/engine/dungeon-runtime.ts`新增共用cell／鄰接映射、入口/Boss識別與合法相鄰移動檢查；`src/domain/model.ts`正式保存DungeonRuntime state；`src/engine/simulation.ts`在Node 21提供進入動作、在地牢位置只提供相鄰格移動，並在結算時更新cell/actor、抽地牢事件、建立容器WorldObject及組合隨機抽取資訊；`src/engine/simulation.test.ts`以SQLite測試證明進入S抽中容器、snapshot/event讀回，接續移至A1後位置仍一致。`simulation-runner.ts`已將legal actions與proposal交由同一`settleAndCommitNextAction`路徑。
- **Crumb證據：** `dungeon-runtime.test.ts`7/7（三層拓樸、Boss E、最短路徑、拒絕非法跨支線、事件池）；simulation端到端定向測試1/1；既有DROP/GIFT/unique、屍體成本、72T期限例外及SQLite rollback/reopen測例引用Cookie Review。
- **實際驗證：** `npm run check` exit 0；`tsc --noEmit`通過；194/194。
- **Quick Review：** 逐項比對正式Cookie 1.2 Crumbs；全數有現行runtime或reproducible test evidence，狀態DONE。此前缺地牢拓樸、dispatcher、WorldState同批提交的BLOCKED結論已由本次明確輸入和接線取代。
- **範圍界線：** 本次未接Boss actor/FSM、樓層解鎖/切換或Boss獎勵，這些依Bag 3後續Cookie處理；未宣稱本輪AI provider實際執行，只驗證SimulationRunner共用action/settlement接口及SQLite結算。

## Cookie 3.3 容器開箱 dispatcher slice 與Quick Review（2026-10-22）

- **來源規則：** 依07A容器來源與46項雙階段表；只使用明確授權來源名映射：`森林寶箱`→`第一層林中寶箱`、`遠古寶箱`→`第三層古老寶箱`，物品顯示名不改、不增加未確認item alias。D-006維持provisional one item。
- **程式切片：** DungeonRuntime建立的容器保存source ID與trip/floor/cell位置；simulation提供同位置、未到期且有配置cost時的開箱action，settlement revalidate後雙階段抽取、消耗容器、寫inventory、事件與RNG，同一SQLite commit。生產開箱cost未提供，production loader不設默認cost。
- **映射核對：** `container_item_subpools.csv`有46列、27個不同標籤；現有food/equipment精確匹配5個（椰子、鐵劍、騎士劍、鐵盾、騎士盾），既有功能道具ID另精確匹配紙筆、告示牌、營火。七個來源都含至少一項未映射可能結果；production action對這些池fail-closed。SQLite開箱整合使用明確標注的單品椰子測試fixture，不能作production池可開箱證據。
- **滿包邊界：** Cookie 2.2定義十格、不堆疊，Cookie 2.2/3.3與相關Reference沒有容器滿包結算規則。action仍顯示；結算不消耗容器、不抽RNG，回報unresolved。該規則等待使用者指定；不套用怪物擊殺滿包掉落規則。
- **驗證：** 容器建立／SQLite開箱fixture、滿包fail-closed、七個production來源映射閘門定向3/3；其後`npm run check` exit 0、`tsc --noEmit`通過、213/213。
- **Quick Review／Cookie狀態：** dispatcher與fixture持久化Crumb通過；production來源開箱、成本、滿包結果、唯一裝備容器路徑及D-006正式化仍未完成，Cookie 3.3維持BLOCKED。逐項證據見`COOKIE_REVIEW.md`「Cookie 3.3 容器 dispatcher slice Quick Review」。

## 2026-10-22 容器物品映射決策及Cookie 3.3 Quick Review覆寫

- **使用者決定：** 開箱成本沿Reference 02普通物品動作1T；滿包開箱後掉在當前Node／地牢cell，與容器移除及事件同批提交。使用者核准9個單一近似映射，並授權其餘容器池label建立穩定ID及合理最小catalog定義。D-006仍採provisional one item，不改數量或比例。`intend bio`維持空白：不配置模型、不觸發Biography生成、不猜模型。場景及掉落文字由使用者後續提供，不創作；MESSAGE費用仍歸同一proposal模型呼叫。
- **資料與Reference：** 新增`container_item_identities.csv`覆蓋27個來源label／46列；新增`functional_items.csv`身份catalog；`food.csv`與`equipment.csv`增加10個經授權的獨立項目定義。更新07A舊命名警示的現行覆寫、04的商品映射說明、08的Biography設定狀態、SOURCE_INDEX、PROJECT_BRANDING、values_to_recover C-18/M-02及DESIGN_DECISIONS D-005/C-18。原始pool label、兩階段比例與D-006 provisional狀態保持。
- **程式：** `content/actions.ts`載入兩份身份catalog；`simulation.ts`用source label/category查唯一inventory ID，production七來源皆可提供1T action；開箱事件保留sourceItemLabel及canonical itemId。inventory滿格時建立同Node／dungeonLocation、72T到期的WorldObject，同一WorldState／SQLite批次消耗容器、更新RNG、事件與物件；唯一物品ledger在入包／落地分支分別更新。
- **Crumb證據／Quick Review：** `simulation.test.ts`滿包測例經`settleAndCommitNextAction`提交並讀回，確認10格背包不溢出、容器已移除、掉落物同Node/cell且事件同批；production測例驗證7來源全有合法1T開箱action，27個ID唯一且46列均有分類對應。此Cookie review已記入`COOKIE_REVIEW.md`「Cookie 3.3 容器ID及滿包結算覆寫 Quick Review」。
- **其餘限制（本節當時狀態，D-007結論已由下方覆寫）：** 功能道具正文／使用效果仍空且不提供READ；D-006仍非正式件數規則。D-007第三層非A1/B1/C1事件8%曾fail-closed；目前依後續使用者決定與Review已解除。4.3 Biography自動生成保持不配置/不觸發；既有外部文字settlement不等同模型呼叫。4.1所需場景及掉落文字留待使用者供稿。交易仍停用，DROP與MESSAGE維持可用。
- **驗證：** TDD定向階段曾觀察2項失敗：滿包settlement仍拒絕及production source因缺ID不暴露action。修改後`node --experimental-strip-types --test src/engine/simulation.test.ts`通過66/66；`npm run typecheck`通過；`npm run check` exit 0，typecheck通過、214/214。

## 2026-10-22 D-007非第一排第三層主事件率及Cookie 3.3 Quick Review覆寫

- **使用者決定：** A1/B1/C1第一排保留原池；其他排將火山彈8%移出後，平均分到舊有三種非怪物事件型：灼熱泉水、遠古寶箱、探險者遺物各增加8/3pp。C-06大型熔岩飛濺11%為獨立新增事件，不參與分配；三種普通怪各自原率不變。
- **資料與規格：** 更新Reference 07現行雙Node-scope分布、07A第二階段機率界線、03/10/11/13對應段落、`dungeon_events.csv`的`node_scope`及300整數`weight_units`、`values_to_recover.csv` C-01、DESIGN_DECISIONS D-007/C-01、BAG_REVIEW與PROJECT_BRANDING。07舊「權重待核」記錄由新決定取代。第一排權重300；其他排怪物51/51/48、飛濺33、泉水26、寶箱47、遺物44，亦為300；等於100%。非第一排依次為50%、11%、26/3%、47/3%、44/3%。
- **Runtime與TDD：** `domain/dungeon.ts`依A1/B1/C1或其他Node選scope，用整數weight units抽取且驗證每池總權重精確為300；移除舊D-007 unresolved gate。DungeonRuntime與Simulation正式移動／樓層進入結算均沿同一pool路徑。新增domain、runtime、simulation測例；改動前3項新期望測例紅，改動後production非第一排進格及Boss2解鎖後三層S格進入通過；C-06飛濺測試仍驗證11%主事件後另抽傷害。
- **Quick Review：** Cookie 3.3 Crumbs逐項核對：池率與怪物直遇率通過；火山彈範圍通過；C-06分池通過；先前已核的source container dispatch／1T／滿包SQLite world drop／unique ledger證據仍有效。D-006仍維持provisional one item，不升格。Cookie 3.3狀態更新為DONE。

### 2026-10-22 D-006 定案與 Cookie 4.1 空白閱讀池切片

- **D-006使用者決定：** 「全部含物品的容器每個都一件」。範圍為所有含物品的七個已配置容器來源；每次維持分類池一次抽取、分類內子池一次抽取，兩階段權重不變。空容器或未配置空池不由此決定新增物品。
- **D-006程式／資料：** `drawContainerItem`回傳`provisional:false`與`user_confirmed_one_item_per_item_container`；地牢生成容器不再因件數規則標provisional。兩份容器池CSV狀態欄一致更新；`values_to_recover.csv`的M-02/C-19、DESIGN_DECISIONS D-006、Reference 07A/11及PROJECT_BRANDING已同步。Cookie 3.3保持DONE，快速Review見`COOKIE_REVIEW.md`「Cookie 3.3 D-006 單件出貨規則 Quick Review」。
- **4.1文字池：** 新增`readable_document_pools.csv`分開book與drift-bottle；新增`readable_documents.csv`含101個空白book文字槽，漂流瓶只有future-reserved pool定義、沒有文件列或玩法。`書籍`新增空白閱讀物件身份；loader載入空白ID映射；`readableDocumentPoolWeights`和`selectReadableDocument`對指定pool以1/N等機率選文，新增文件後依新池大小重新均分。READ仍只在非空正文時列出。
- **4.1 Review與測試（當時判斷，已由下方歸屬更新覆寫）：** 書籍來自地牢深處刷新、漂流瓶來自海灘刷新，分池避免來源與資訊混用；漂流瓶仍只預留、不新增刷新或玩法。fixture文本只存在測試；production blank book同Node測例確認不提供READ。picker定向2/2、內容loader 1/1、READ案例2/2；`npm run typecheck`通過。picker改動後完整`npm run check` exit 0、218/218。當時曾因等候正式文字供稿將4.1記為BLOCKED；使用者後續將正式文本維護歸7.1，現行4.1為DONE。
- **實際驗證：** `domain/dungeon.test.ts` 11/11、`engine/dungeon-runtime.test.ts` 8/8、`engine/simulation.test.ts` 66/66；修正C-01 CSV含逗號欄位引用後，`npm run check` exit 0、typecheck通過、215/215 tests。此次為最新完整檢查。

### 2026-10-22 Cookie 4.1–4.3 歸屬與狀態覆寫；生成回合排程門檻

- **4.1／7.1／7.3歸屬：** 使用者確認4.1不因缺少正式正文而BLOCKED。4.1保留AI輸入、合法JSON/action校驗與READ runtime；正式遊戲文本的寫入及來源映射移至7.1，未收到供稿時維持空白。7.3改為AI提示文本及回傳格式個性化微調，待使用者補充；現有引擎JSON動作格式不變。
- **4.2狀態：** 交易停用是使用者已決政策。交易request/accept/reject不列合法actions，偽造proposal仍被校驗拒絕；drop與message保持可用。此決策狀態標DONE，不列待交易重新設計為本Cookie阻塞。
- **4.3狀態：** message成本沿用既有同次proposal分類；Biography模型配置保留空白手動配置佔位，空白時不呼叫／不自動生成。當前程式沒有獨立Biography選擇器或自動生成路徑；不設定默認模型，不改JSON輸出契約。此為按使用者指定的未配置狀態，不列BLOCKED。
- **怪物生成回合：** 使用者規則為遭遇生成序列只生成怪物、不行動。`WorldActor.spawnedAtSequence`標記生成序列；`nextWorldEvent`排除該序列中新生成的怪物，之後由正常共用排程處理，不增加T或時間常數。`simulation.test.ts`同序列斷言不是`monster-action`，居民後續正常行動結算後再驗證怪物進入FSM排程。
- **環境互動3T實況：** `references/02_時間與行動排程.md`記錄大行動成本3T及目前差異：runtime效果於action settlement即時結算，next action按`t+3`排程；沒有持續interaction狀態欄位，也沒有延遲到3T後完成效果的timer。此為現況記錄，未加新狀態機。
- **驗證：** `npm run typecheck`通過；`node --experimental-strip-types --test --test-name-pattern="rolls forest entry and creates a source-matched monster" src/engine/simulation.test.ts`通過1/1。首次typecheck發現測試在已窄化的`resident-action`型別上多餘比較（TS2367）；改為明確`assert.notEqual(...,'monster-action')`後兩項驗證均通過。未跑全套。

### 2026-10-22 隨機 Playtest Bot 有限模擬

- **Bot與驗證範圍：** 本機 bot 以固定 seed 從當前 `availableActions` 均勻抽選，經 `settleAndCommitNextAction`／`settleAndCommitNextTimerEvent` 結算；不呼叫 provider。使用新 SQLite 資料庫 `island-sim/data/playtest-bot-validation-v2-20261022.sqlite`，固定 seed 執行100步，event sequence 及事件列均為100，世界時間T19，10名居民存活；事件含resident-attacked 14、resident-action-settled 69、public-message-sent 17，未發生非法動作提交、程序錯誤或安全停止。這是有限试玩證據，不代表所有地形與存活週期均已覆蓋。
- **生成回合測例校正：** Boss進格與夜間遭遇兩測例原在怪物生成的同一sequence立即期待monster-action，與現行 `spawnedAtSequence` gate不符。改為先斷言該序列不排怪物、再由下一位居民合法WAIT推進sequence，之後驗證該怪物依正常排程行動；未改runtime規則。
- **驗證：** 兩個指定測例2/2；完整 `simulation.test.ts`通過；`npm run check` exit 0，typecheck通過、220/220 tests。此附加試玩不更改任何Cookie狀態。

### 2026-10-22 Node occupancy 與地表進出規則

- **使用者定案：** 所有進出相關判定共用Node是否有存活玩家；玩家進入已有其他玩家的Node不觸發入場事件；Node無玩家時清除敵對或可狩獵生物actor。地面物件不清除，仍按每件物品自己的72T到期時間處理。
- **Runtime範圍：** 僅在玩家離開／死亡使Node由有人變無人時清除該Node的敵對或可狩獵生物；地牢Cell位置另有獨立定位，不以保留的地表Node ID清理；不更動objects。移動入場時以目的Node此前玩家占用狀態同時門控夜敵與地形池。
- **驗證：** occupancy、夜間與地形入場門控、河流主動熊互斥定向測試通過；最後一次`npm run check`通過，`227/227`。

### 2026-10-22 十居民地表規則長測（安全停止）

- **執行方式：** 現有隨機PlaytestBot固定seed `surface-rules-10resident-2160T-v1`，從空的新資料庫 `island-sim/data/surface-rules-10resident-2160T-20261022.sqlite` 初始化十居民共享世界；所有居民都只從其`availableActions`合法清單均勻抽動作，使用既有settlement流程。
- **結果：** 執行28個事件序列，快照停在T=4，未達目標T=2160。排程器在T=4遇到居民與電鰻同時、同SPD=3，既有規則未定跨類同速tie-break，因此bot按安全規則停止，沒有強行推進。當時10名居民皆存活：HP29有2人、HP30有8人；死亡0。生物為一隻同Node排程中的電鰻。
- **觀測事件：** 事件列共28：居民行動17、公開訊息7、居民受攻擊2、拾取1、地表動作1。入場地表結算5次：海灘3次（椰子1、未觸發2）、森林未觸發1；夜敵0。主動釣魚一次釣到電鰻，產生同Node怪物並導致上述排程安全停止。沒有非法動作提交或程序崩潰。快照唯一未解析標記是既有D-012（十個模型/provider配置未設定），不影響本機隨機動作。
- **覆蓋邊界：** 此有限實跑沒有抵達2160T，不能作為長期地表事件分布驗證；安全停止由跨actor同速排程缺口觸發，與新地表概率表無關。Cookie狀態未變。

### 2026-10-22 Cookie 2.1／2.2／2.3 放置場景物與營火保護完成驗證

- **Cookie 2.1（DONE，補充完成證據）：** 使用者確認Node 11為森林；`03A_28Node原圖與鄰接表.md`與`tables/island_nodes.csv`已同步該標記。此為使用者逐點確認，不把其他分組地形描述提升為逐點確認。
- **Cookie 2.2（DONE，補充完成證據）：** 經常規use放置的場景物以`placed`永久留存、不可pickup、可用破壞動作移除；Node 25預設已點燃placed營火且無期限。普通地面物品仍可pickup，並各自按生成後72T到期。對應Reference 04／06及simulation測例。
- **Cookie 2.3（DONE，補充完成證據）：** 有效點燃的地表營火保護會跳過該次抵達時整個日間／夜間地形入場池，也跳過夜間睡眠風險檢查；地牢Cell不受地表營火保護。營火不因此抑制主動探索或採集。對應Reference 02／06及simulation測例。
- **來源與實作證據：** 使用者確認及同步資料見`03A_28Node原圖與鄰接表.md`、`tables/island_nodes.csv`；規則見Reference `02_時間與行動排程.md`、`03_地圖與探索.md`、`04_生存物品與裝備.md`、`06_地表事件與資源.md`。runtime／測試包括`world.ts`及`simulation.test.ts`中的placed場景物拾取／破壞、Node 25預設營火、白天及夜間入場跳過、睡眠風險豁免與地牢無保護案例。主實作代理回報 `npm run check` exit 0，239/239 tests通過；此為代理提供的本輪執行結果，本續記未自行重跑。
- **2160T長測狀態（此前快照，後續已更新）：** 此前記錄時，目標分支`transit-fix-10resident-2160T-v2-campfire-node11-forest-20261022.sqlite`停在sequence 351／T=51，因無居民的Boss Cell仍殘留可排程動作而使bot停機。後續續跑結果見本Log末段2026-10-22撤退規則與2160T長測增補；此處T=51只保留為先前檢查點。其他資料庫曾分別停在T4、T41、T51；`...v2-continuation...sqlite`的T72仍是另一分支快照。
### 2026-10-22 撤退規則校正與2160T長測觀察（進行中／長測無效）

- **規則來源與runtime校正：** 依Reference `05_戰鬥與怪物.md`及`tables/monsters.csv`，只有第二層同一Cell內仍存活的黏液怪禁止沿來路後退；一般地牢怪仍允許玩家向後撤退，但阻擋向前推進。地表夜蝙蝠不封鎖一般移動。Boss 2勝利時，在同一勝利結算中直接把符合資格的居民轉移至下一層起點。Reference 05及怪物表是此規則依據。
- **對應測例：** `simulation.test.ts`覆蓋第二層水道黏液怪限制、普通地牢怪只阻擋前進、夜間地表遭遇與移動、Boss 2勝利轉層結算。主實作代理回報最新`npm run check` exit 0、242/242；此為代理提供的驗證結果，本記錄未自行執行測試。
- **2160T長測結果與限制：** 目標DB `island-sim/data/transit-fix-10resident-2160T-v2-campfire-node11-forest-20261022.sqlite`目前snapshot sequence 12993、T=2160。唯讀查詢顯示該DB共217次`personal-sleep-risk-settled`事件所含terrain checks，其中115次`terrain`為null並有unresolved標記（Node無來源支持的地形分類）。因此雖到達T=2160，該長測結果仍無效／待定，不能作為已驗證長期地表分布或全規則完成依據。
- **仍未完成：** Node metadata snapshot sync尚未實作；其餘Node映射仍待使用者回覆。不得用本次時間到達推定這些缺口已解決，也不改Cookie狀態。

### 2026-10-22 clean T0 terrain-map 長測局部 Cookie Review

- **Review範圍：** Cookie 2.1／2.3 地形標記及地表夜間風險；Cookie 5.1 快照保存邊界。舊段落所述115個terrain unresolved屬另一資料庫分支，保留作歷史觀察，不套用到本次clean T0資料庫。
- **標準長測門檻與結果：** 使用者指定十名居民共用同一世界、由T0跑到T2160，作為當前標準長測／驗收門檻，並非單次臨時試玩。本輪clean T0長測通過該門檻。唯讀查詢 `island-sim/data/playtest-bot-2160-terrain-map-v2.sqlite`：seed=`surface-terrain-map-2160-v1`，快照sequence 13885、worldTimeT=2160，事件表13885筆；103筆 `personal-sleep-risk-settled` 事件共含162項terrain check，terrain為null數=0、unresolved非空數=0。此通過限於該資料庫與地形睡眠檢查統計，不推及其他池或其他Cookie。
- **地圖／持久化證據：** 同一快照的 `nodes` 有28項，28/28均保存非空 `surfaceTerrain`。`src/engine/world.ts` 的 `syncWorldNodeMetadataFromGraph` 同步來源支援的label、labelStatus、visualType、surfaceTerrain並保留模擬狀態；`src/engine/world.test.ts`覆蓋Node 11/15/25修正及sequence、時間、RNG、居民HP和Node 25營火狀態不被重置；`src/ai/playtest-bot.ts`呼叫此同步路徑。Cookie 5.1仍遵守D-002：這是既有快照內部資料，不宣稱外部schema欄位契約已核准。
- **D-012／D-016邊界：** `DESIGN_DECISIONS.md` D-016記錄使用者2026-10-20原話「留可用空位 操作設定在前台」，並核准10個可留空設定槽、不預選live AI；因此本機隨機bot長測中的provider/model空槽是預期未配置狀態，不是遊戲事件、terrain unresolved或本次長測阻塞。這不提供任何具體provider、model或價格值，也不等同live AI路徑驗收。
- **Cookie狀態：** Cookie 2.1、2.3及5.1既有狀態均不變（已在上方狀態表記DONE）；本次是補充長測與快照證據，不以單次T2160推論其他Crumb完成。舊分支的115個unresolved仍由原記錄準確描述。
- **歷史下一Cookie判定（2026-10-22，已由2026-10-25狀態覆寫）：** 當時記錄所有較前序Cookie已DONE，下一項Cookie 7.3被列為BLOCKED，並將AI提示文本／回傳格式微調列作依賴。該判定不再代表現況；7.3目前明列Crumbs均DONE，AI微調延期且排除目前範圍。

### 2026-10-24 Cookie 6.2 事件時間線居民篩選

- **變更範圍：** 觀察台事件頁新增獨立「全部可見事件／指定居民」選單；指定居民依 adapter 投影的結構化 `participantIds` 篩選，來源含 event actor 與 payload 中具名 actor/target/resident ID 欄位，不用事件文字搜尋。事件頁可直接切換居民，並以 URL query 保存 `activeTab`、`eventResidentId` 和 `eventPage`；原有六筆一頁分頁保留。
- **可見範圍：** adapter 仍只投影 `public` 與 `player-only` 事件；`privateEventIntents` 仍獨立標示為意圖，不改事件文字或 AI visibility，也未改結算、事件資料或持久化。
- **歷史上限：** `SQLiteObserverPort.readSnapshot` 仍由目前 snapshot sequence 往回讀最多 500 筆事件。全部可見事件只指這個最近事件來源窗內的 observer-visible events；時間線分頁不讀取更舊事件，因此不代表完整生命期歷史。沒有新增歷史 API。
- **靜態核對：** `observer-adapter.ts` 提供 participant IDs 並保留 public/player-only filter；`observer.ts` 使用結構化 ID 和選單呈現；`server.ts` 從 URL 解析並傳遞居民篩選與頁碼；root README 記載 500 筆限制。
- **驗證界線：** 僅靜態讀碼核對。依本次要求未跑測試、typecheck、服務或瀏覽器流程；URL 刷新及互動行為尚無 runtime 證據。Cookie 6.2 既有狀態表不在本次修改，亦未藉此宣稱新的 runtime 驗收。

### 2026-10-24 Cookie 7.3 地圖存檔與 Cookie 6.3 全頁可讀性核對

- **授權範圍：** 依 `PROJECT_BRANDING.md` 最新 7 Bags／19 Cookies 版本，處理多張獨立地圖、遊戲選用與存檔 map ID 契約，並檢核開始頁設定及所有 app 頁面的寬／窄視窗可讀性。歷史 18 Cookie 狀態僅指當時已審範圍，不代表整個產品完成。
- **地圖 profile 與 mapId 實作核對：** `sqlite-store.ts` schema v8 建立 `map_profiles`，以穩定 `mapId` 保存 name、nodes、edges、node notices；`server.ts` 的 `/editor` 資料與保存路徑列出／讀取／建立／更新 profile。新局採用選定 profile，snapshot 帶 `mapId`；載入缺少 mapId 的舊 snapshot 時回退 `default-map`。觀察台以當局 snapshot mapId 解析地圖。相關來源：`island-sim/src/persistence/sqlite-store.ts`、`src/ui/server.ts`、`src/engine/world.ts`、`src/persistence/snapshot-migration.ts`、`src/ui/observer-adapter.ts`。
- **共享文字池與保存修正：** 地圖 profile 只保存節點、連線、告示綁定；閱讀文本仍在共享 `readable_documents.csv`。編輯器送出按 ID 的文本增刪／更新差異，server 讀取最新 CSV 後合併；同一 Node 程序內的寫入序列化，避免不同卡片的並行更新互相覆蓋。新卡使用 UUID，前後端拒絕同批重複 ID。保存錯誤會呈現未儲存狀態並保留編輯內容供重試。
- **資料原子性限制：** 文件 CSV 先於 SQLite profile 寫入，兩者不是跨儲存原子交易；profile 寫入失敗時，文本差異可能已提交。序列化鎖只涵蓋同一 Node 程序，不保護其他程序或外部工具直接寫 CSV。這些限制尚未由跨程序／失敗注入端到端測試驗證，不宣稱完全消除競寫或部分提交風險。
- **測試證據：** 依本輪實際回報，`node --experimental-strip-types --test src/ui/editor.test.ts` 最終 10/10 通過，包含空差異不重寫文件、依 ID 合併、並行不同卡更新、重複 ID 拒絕及一次寫入失敗後佇列可繼續；另有 map profile CRUD 與 snapshot mapId migration focused 測試2/2通過。測試來源為 `src/persistence/sqlite-store.test.ts` 的獨立 profile CRUD 測例及 `src/persistence/snapshot-migration.test.ts` 的舊存檔預設 mapId migration 測例。這些測試未驗證磁碟關閉重開、server/runtime/browser E2E；本輪未跑全套測試或typecheck。
- **Cookie 6.3 可讀性核對：** 靜態檢視 observer/editor CSS 有多個窄螢幕 breakpoint；同時發現地圖居民 chip 有省略呈現、observer shell 固定視窗高度／overflow，以及 editor 導覽／圖例不換行等需視實際畫面判斷的風險點。由於 Chrome／Edge 啟動失敗（Crashpad named-pipe `TransactNamedPipe: pipe has ended`）、Firefox 未安裝，無法完成寬桌面與窄視窗逐頁視覺核對；因此沒有證據可判定這些是實際不可讀缺陷，也未基於猜測改樣式。Cookie 6.3 **BLOCKED**，待可用瀏覽器後逐頁檢查；「未發現可確認缺陷」不等於完成所要求的可讀性檢核。
- **服務狀態與證據界線：** 嘗試啟動本機服務時，4173 回報 `EADDRINUSE` 並立即退出；既有 `/` HTTP GET 曾回 200，但查不到可確認的監聽 PID，無法歸屬服務擁有者。本輪未停止該未知服務。故本紀錄沒有宣稱 editor、遊戲選圖、存檔讀檔或各頁面已通過目前 runtime／browser 驗收。
- **Cookie 狀態（當時判定；已由2026-10-25最終驗收覆寫）：** 舊 C-7.3-01 至 05 的歷史 DONE 僅限先前範圍。此時擴充 C-7.3-06 至 09 尚缺profile persistence、runtime/browser等證據；Cookie 6.3當時因視覺檢核環境不可用為BLOCKED。這段只保留為2026-10-24狀態，不代表目前Cookie 7.3或6.3狀態。


## Cookie 7.3 Profile 持久化與開局／存檔路由驗收更新（2026-10-25；歷史狀態，已由本Log末段覆寫）

- **Cookie狀態：BLOCKED（當時判定；已由本Log末段最終驗收覆寫）。** 原C-7.3-01至05歷史證據不變；本節只記錄新增C-7.3-06至09的初次驗收。Cookie 6.3視覺區域未在本節處理；AI提示微調不屬本輪。
- **C-7.3-06 保存結果與失敗復原：** 新增SQLite磁碟資料庫失敗注入：`BEFORE UPDATE` trigger拒絕指定profile更新後，讀回舊profile內容不變。這驗證單一SQLite更新失敗時資料列維持完整；不等於CSV與SQLite跨儲存原子復原，也未在瀏覽器驗證UI重試。
- **C-7.3-07 多profile隔離：** focused SQLite測試建立兩個profile，關閉並重開資料庫後讀回ID與內容；兩個獨立Node程序各自更新不同profile 12次，最後讀回內容各自正確。這只驗證SQLite profile跨程序隔離，不驗共享文字CSV跨程序競寫。沒有新增profile刪除政策或刪除路由。
- **C-7.3-08 mapId保存／恢復：** 關閉重開SQLite後，讀回帶自訂mapId的session snapshot；profile內容修改後，既有session仍保留其mapId；讀取存檔後mapId及loadInstance一致。另以`createObserverServer`實際HTTP路由走過`/api/setup`、`/api/setup/map-profile`及`/api/lifecycle`的新局、保存、結束、載入流程，確認選定profile ID進入新snapshot且存檔恢復保持一致。該HTTP測試使用SQLite-backed lifecycle adapter，不是production `startObserverServer`完整runtime，也不是browser E2E。
- **C-7.3-09 共享文本池界線：** 本輪未執行共享CSV跨程序競寫，也未驗CSV與SQLite部分提交復原；此Crumb仍不能因SQLite profile競寫結果推論通過。
- **Focused驗收：** `node --experimental-strip-types --test src/persistence/sqlite-store.test.ts src/ui/server-open-routes.test.ts`：12/12通過，含磁碟關閉重開、SQLite失敗注入、兩程序profile競寫及HTTP路由整合。測試程序建立的臨時資料由teardown移除。
- **Typecheck：** `npm run typecheck`仍失敗，輸出7項診斷：`src/ai/death-summary.ts(62,120)` TS2554（Expected 3 arguments, but got 2）；`(101,31)`及`(101,128)` TS18048（`config`可能為undefined）；`(222,35)` TS18046（`entry.payload`型別為unknown）；`src/ai/simulation-runner.ts(68,5)` TS2412（`SimulationActionContent | undefined`不能指派給`SimulationActionContent`）；`src/ui/server.ts(1423,69)`及`(1457,69)` TS18048（`store`可能為undefined）。本輪未建立修改前基線，故無法判定這些診斷是否既存或由何項變更引入；它們不屬本次明列Crumb驗收項，未以其作為阻擋門檻。未改動上述程式位置。
- **Browser E2E：未完成。** Playwright啟動本機頁面時，bundled Chrome重現`TransactNamedPipe: 管道已結束 / crash server failed to launch`，故沒有UI瀏覽器驗收。曾以隔離臨時DB啟動production server作runtime檢查，後以Ctrl+C結束；核對測試port無listener且暫存目錄已清理。未停止或修改未知的4173服務。
- **狀態理由：** focused持久化、回復及HTTP路由證據通過，但production完整runtime/browser E2E、共享CSV跨程序競寫和跨儲存部分提交復原未證；typecheck亦仍有非本輪範圍錯誤。因此7.3新增C-7.3-06至09維持BLOCKED，不能宣稱Cookie 7.3整體DONE。

### 2026-10-25 Cookie 6.3 紀錄審核接受

- **Cookie狀態：DONE（依使用者本輪明確指定的紀錄審核方式）。** 使用者指示直接依現有紀錄判定通過；本次依該接受方式更新6.3狀態，沒有把歷史記錄寫成新runtime驗收。
- **實際核對材料：** 現有 `qa/screenshots/observer-desktop.png`、`observer-narrow.png`、`observer-desktop-settings.png`、`observer-narrow-settings.png`，涵蓋觀察台世界地圖及模型設定兩頁；尺寸分別為1440×900與390×844。舊6.3 Review記錄的目標範圍另包括開始設定、居民／事件／總結／狀態頁與editor頁面。
- **證據界線：** 其餘頁面沒有可核驗的桌面與窄視窗成對截圖；本次未完成全頁runtime／browser視覺E2E。DONE只表示依使用者指定的現有紀錄審核方式接受，不代表缺少的頁面已有視覺驗收。本次沒有新增UI修改，也未改7.3狀態或範圍；7.3仍依前節記錄為BLOCKED。

