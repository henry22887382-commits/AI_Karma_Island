# Bag Review｜輪迴島執行前局部審查

> **現行狀態覆寫（2026-10-25）：** 共7 Bags／19 Cookies。Cookie 6.3依使用者指定的紀錄審核方式DONE；Cookie 7.3原範圍及新增profile／mapId Crumbs均DONE，直接證據與限制見`COOKIE_REVIEW.md`及`EXECUTION_LOG.md`。未做browser E2E，不宣稱該項已驗；typecheck剩餘7項診斷沒有修改前基線，不能判定其成因。Bag 4中4.1、4.2、4.3的決策與狀態維持DONE。7.1維護正式遊戲文本；AI提示／回傳格式個人化微調為7.3之外的後續項。原2026-10-22「18 Cookies／18 DONE」僅為當時狀態，保留於歷史記錄。

**審查日期：** 2026-10-20  
**授權依據：** 使用者明確指示「執行cookie」；範圍按 `PROJECT_BRANDING.md` 現有 7 Bags／17 Cookies。  
**審查方法：** 依 Cookie Review 檢查 Bag Label 九欄、Cookie/Crumbs、依賴、Rotten Conditions、跨 Bag 契約及目前已知證據。此文件是局部執行前 Review；不代表實作完成。

## 跨 Bag 依賴與介面檢查

計畫存在循環依賴：Bag 1 需要 Bags 2–4 的領域動作與 Bag 5 持久化；Bag 2/3 又需要 Bag 1 的排程／結算與 Bag 5 儲存；Bag 5 接收 Bags 1–4 事件。計畫定義了責任邊界，但沒有逐項固定的程式介面。工程可用純領域 handler、狀態 reducer 與交易式 store adapter 分層打破循環，並讓世界核心控制時鐘及原子結算；這是實作拆分，不改正式遊戲規則。

Implement_foundation 提供的待落地介面草案：`WorldState(seed/rngState/schemaVersion/contentVersion)`、`ActionProposal(actor/action/cost/payload)`、純 reducer 回傳 `{state, events, draws, unresolved}`、以及 `commit(expectedVersion, ...)` 原子儲存。此為執行中的內部工程契約，須以實際程式及呼叫證據核對；不視為 D-002 的正式外部 schema 核准。

## Bag 1：世界核心、時間與排程

**結論：** 可開始排程／結算骨架。WAIT 1T 已由使用者於 2026-10-21 決定；夜間睡眠和風險規則已由使用者定義，實作及測試證據按 Cookie Crumbs 核對。

- **Bag Label：** 九欄齊備；責任範圍是時間、排程、事件派發及共用結算邊界。
- **Cookies／Crumbs：** 1.1覆蓋72T日界、48/24晝夜、1T/3T個體等待、SPD同時刻優先、死亡退出、夜間至天亮睡眠及逐人不安全區睡眠風險；安全區睡眠不觸發額外風險，不存在獨立全域固定8次風險。睡眠中受攻擊先結算傷害／死亡，存活才醒。1.2覆蓋原子授獎、唯一物件、到期與抽取紀錄。
- **來源解讀更正（2026-10-20）：** 前一版依 ZIP 將「每夜8次」解讀成獨立全域固定計時器，並保留雙層 global＋睡眠風險，現已被使用者明確更正，不再作為現行規則或反駁使用者的依據。使用者原文：「沒有這項 8來自24/3 指的是睡著時會有共8次判定」。現行規則按 D-010：不存在獨立全域固定8次；額外風險只在居民睡於不安全區域時逐人觸發，以各人入區判定時點為錨每3T一次，睡滿24T共8次；一般進區／探索觸發保留。SLEEP 僅夜間可用並持續至天亮（原文「晚上才能睡覺 睡到天亮」）。
- **依賴與契約：** 領域 Cookies 提供 ActionProposal/handler，核心處理時間與 reducer，Bag 5 store adapter 接收已結算狀態／事件；這可避免包間直接互相 import。具體呼叫及交易結果待實作證據。
- **已澄清睡眠規則（2026-10-20；17.5%部分已於2026-10-21覆寫）：** 使用者裁定不設獨立全域固定8次；安全區睡眠不觸發額外風險；危險區睡眠逐人每3T一次、完整夜最多8次；SLEEP僅夜間至天亮；受攻擊先結算傷害／死亡，存活才醒。原先非野外睡眠按17.5%正規化已作廢。現行修正版：危險區睡眠每3T用所在Node地形率判定，不抽地形池；有效點燃營火保護Node跳過；命中先固定扣1HP，存活才醒並處理遭遇。
- **必要待決：** C-10已決WAIT=1T；C-08/C-09戰鬥回合=1T。2026-10-21 Cookie 1.1快速Review已逐Crumb通過並設DONE；跨類型同SPD依該Crumb維持unresolved，不要求新增規則。Cookie 2.3／3.1／3.2仍未完成：部分Node地形分類和原地形池資料缺失、營火互動未接入、完整FSM及其他Crumbs尚未驗證。
- **排序／round 決策（D-013/D-014）：** 同SPD順序及正數`.5` round half up均已由使用者裁定；tie-break helper/clock接線、round跨語言測試仍需實際證據。C-11一般食物腐敗起點屬Bag 2.2，不阻止時鐘骨架。
- **Rotten Conditions：** 不存在；目前缺口是局部未知，不推翻 Bag 目標。
- **驗收狀態：** Bag 1執行前Review允許依現有界線實作。Cookie 1.1現已通過逐Crumb快速Review；缺失Node地形映射留由Bag 2.1/2.3提供，未解跨類型同SPD依Cookie1.1 Crumb保留unresolved。Cookie 1.2舊Review於2026-10-21未通過；2026-10-22拓樸及主流程Quick Review已更新為DONE，詳本檔末段與COOKIE_REVIEW.md。

## Bag 2：主島地圖、生存與地表探索

**結論：** 通過有界執行前審查；明確來源值可實作，未知場景與規則須保留 unresolved。

- **Bag Label：** 九欄齊備；負責地圖、物品／裝備及地表探索，禁止從像素推導距離、臆分椰子 Node、合併名稱或混合機率池。
- **Cookies／Crumbs：** 2.1 可核對 28 Node／51 邊／連通、外圈閉環與 15↔25；2.2 的生命值、背包、物品例外與 72T 期限有明確範圍；2.3 的釣魚、岩縫、森林、河流及椰子已知值分池記錄。
- **依賴與契約：** 由 Bag 1 移動／結算 handler、Bag 3 戰鬥 handler、Bag 5 內容／狀態存取提供；Node/物品定義由本 Bag 擁有。介面待工程證據確認。
- **已採用的互動點設定及來源等級：** 使用者明確採用魚站2/10/14、椰子1/8/13（初始0、每日+1、上限3）、森林9/17/23、石堆6/19/22、河流24。crosswalk確認森林／石堆／河流可依Reference分組文字與Node序列對應，非原圖逐點文字標名；魚站與椰子點位則以使用者採用設定為依據，不宣稱是地圖直標。可依核准設定作為執行值，來源標籤需保留來源差異。
- **待決與最小受影響範圍：** M-01 / D-003、D-004仍限制稱名與Reference逐點證據，不撤銷使用者對互動點執行值的明確採用。D-015出生點Node 1/8/13是獨立決定，依seed隨機且不沿用；C-03/C-04、D-005/C-18只影響指定物品別名／缺值；C-11、C-16只影響食物腐敗或椰子丟棄後生命週期。可依來源與已採用設定實作，不可虛構來源標記。
- **已定義事件值：** 森林白天原地形池保留15%觸發／負面35%；夜間地形遇敵新規則先行，沙灘30%、森林35%、河流35%、岩石區30%。命中固定扣1HP、按蝙蝠:狼=4:6選敵並結束本次地表事件；未命中才抽原地形池，因此森林原夜間25%×70%僅是遇敵未命中後的原池。睡眠每3T用所在Node率、不抽地形池；有效點燃營火豁免。主動採莓90/10仍獨立。原17.5%睡眠正規化與夜間同池比例調整說法均已覆寫。
- **屍體行動成本：** 使用者已採用每拿一件物品1T、搬起1T、放下1T；跨Node仍以原移動3T結算、不另加搬運時間。
- **Rotten Conditions：** 不存在；各項未知已可隔離。
- **驗收狀態：** Review 通過有界執行；實作及驗收證據待補，Cookie 2.1–2.3 均未證 DONE。

## Bag 3：戰鬥、地牢與掉落

**結論：** 通過有界執行前審查；來源已定值可落地，戰鬥缺口、區外事件權重與 provisional 掉落不得自行補定。

- **Bag Label：** 九欄齊備；普通戰鬥／Boss／事件與掉落同域，但主事件與額外掉落分池，唯一物件受核心原子檢查。
- **Cookies／Crumbs：** 3.1 覆蓋傷害、速度、撤退及多人互動；3.2 覆蓋已知怪物分佈／技能及 Boss 條件；3.3 覆蓋三層主事件、附加掉落、七容器池及唯一勇者物件。
- **依賴與契約：** Bag 1 排程／原子 reducer、Bag 2 防具與物件、Bag 5 事件記錄；透過純戰鬥／掉落 handler 回傳抽取結果與 unresolved 供核心結算。
- **已決策與最小受影響範圍（2026-10-22更新）：** C-05–C-07戰鬥規則已由使用者補充並同步Reference／CSV；runtime及測例Review證據見`COOKIE_REVIEW.md` 583–641、692–701。C-08/C-09戰鬥回合=1T已決。D-007/C-01已核准並接線；D-005/C-18容器映射已核准；D-006/C-19所有含物品容器每次出一件已核准並接線。其他未提供的生成率等資料仍維持明確待查，不擴大成整個Bag阻塞。
- **Rotten Conditions：** 不存在；Bag Label 明確允許將缺值隔離，而不阻止其他已知部分。
- **驗收狀態：** Review 通過有界執行。已有共用排程與自動怪物行動的可驗證切片；Cookie 3.1/3.2仍未完整驗收（跨類型同SPD、完整FSM與擊殺/獎勵結算缺口），3.3未證DONE。未知機率／傷害值仍依原界線隔離。

## Bag 5：持久化、客觀歷史與居民身後資料

**結論：** 通過限縮範圍的執行前審查；可建置內部、版本化、可逆 store/reducer scaffolding；尚未核准任何正式外部 schema 欄位契約。

- **Bag Label：** 九欄齊備；客觀事件／快照與個人上下文、intent、玩家傳記分離；UI 僅查詢不可寫入。
- **Cookies／Crumbs：** 5.1 涵蓋恢復、抽取重播與客觀歷史；5.2 涵蓋世代、intent、私人上下文及傳記權限。
- **依賴與契約：** Bag 1 reducer／已結算事件與 Bags 2–4 事件、Bag 6 查詢；`expectedVersion` 交易草案可作內部暫定接合點。Bag 5 資料生命週期尚須以實際程式及恢復證據驗證。
- **D-002 邊界：** D-002 仍維持待具體 schema 提案及核准；本次授權只允許內部 versioned implementation detail 用於執行，不把欄位名稱、遷移策略或事件版本升成正式外部契約。需後續 Review 檢查是否仍滿足 Bag 5 Crumbs。
- **待決與最小受影響範圍：** schema 外部化或對其他 Bag 作為穩定契約之前，須回到 D-002；C-14已由使用者決定次日晨一次補足至10人並經Cookie 5.2測試，不再構成Bag 5未決項。
- **Rotten Conditions：** 不存在；以內部版本化方式隔離未知，不假設未核准 schema。
- **驗收狀態：** Review通過限縮範圍執行。2026-10-22 Cookie 5.1 quick Review已DONE：SQLite快照/事件原子持久化、磁碟重啟/RNG抽取重播、交換物品/永久屍體/到期狀態/公開文字讀回測試通過；內部schema未外部化，D-002仍待審。Cookie 5.2已DONE：C-14依使用者次晨一次補足至10人的決定完成測例與Quick Review。

## Bag 4：AI Router、合法動作與居民交流

**結論：** Bag Label 與已知來源邊界足以審查；獨立 Router/社交模組可按已知契約先行開發，跨 Bag 接線與依賴其他 Bag 的 Crumbs 需待上游介面和實際輸出到位。

- **Bag Label：** 九欄齊備；模型只提交合法動作，世界核心結算；交流耗時且不鎖住居民。
- **Cookies／Crumbs：** 4.1 要求 action ID allowlist、字數上限、隱藏資訊界線、錯誤輸出行為；4.2 要求非同步公開訊息與原子交易；4.3 要求重試／備援與成本上限。
- **必要依賴：** Bag 1 已結算結果與時間成本、Bags 2–3 的合法 action ID/成本清單、Bag 5 的個人上下文與客觀歷史查詢。Implement_observer_ai 的報告確認目前 workspace 只有規劃文件，以上沒有實作/API 輸出可依賴。
- **已知來源約束：** Reference 14（依工程代理定位）要求 action ID 白名單、`intent` ≤30、`text` ≤50、無效 schema/ID 不重試且愣神 1T；傳輸最多 2 次重試不耗遊戲時間，主要模型 3 次呼叫失敗後備援，fallback 成功 10 次後探測 primary，成本紀錄涵蓋提示／輸出／重試／訊息／傳記並設每月硬上限。以上實作仍需按指定 Reference 原表核對。
- **待決與最小受影響範圍：** D-008/C-02限制4.2跨Node可見範圍；D-016已指定10個前台可留空模型槽及key記憶體邊界，但具體模型／價格值由使用者設定。D-012尚有fallback及成本細節不能用預設值宣稱通過。
- **Rotten Conditions：** 不存在；未知值可隔離。D-008限制跨Node可見行為；模型設定方向已定，但live配置、成本與fallback Crumbs仍需驗收。
- **驗收狀態（歷史初審）：** 可建立獨立模組和局部驗證；當時4.1–4.3尚無執行證據。現況已由本檔開頭狀態覆寫及`COOKIE_REVIEW.md`最新Quick Review更新：4.1–4.3均DONE。

## Bag 6：觀察者 UI 與世界回顧

**結論：** Bag Label 與只讀權限邊界可審查；獨立 UI 模組可依明確 Crumbs 與暫定 query interface 開發，接線與整合 Crumbs 需待 Bag 1/2/5 產物和權限查詢契約到位。

- **Bag Label：** 九欄齊備；資訊需可讀且唯讀，僅暫停／恢復／調速作世界控制，不得代替居民行動。
- **Cookies／Crumbs：** 6.1 涵蓋來源道路、角色觀察及資料確定度；6.2 涵蓋客觀事件、玩家專屬傳記與控制入口。
- **必要依賴：** Bag 2.1 地圖、Bag 5.1/5.2 玩家權限化投影、Bag 1 時鐘與控制請求。Implement_observer_ai 確認目前沒有相應 API/輸出。
- **待決與最小受影響範圍：** D-008/C-02限制跨Node短訊呈現。D-011/D-017已指定單窗切換頁、資訊壓縮、動態格子／字體試作；需以實際原型與browser驗收，未指定美術細節不擴寫。
- **娛樂 UI 品質檢視：** 玩家需能清楚區分 Node、居民及世界時間線；地圖道路要按 51 邊呈現；居民只讀資訊不能洩漏回 AI；可見缺值應保留確定度標記。這些是已有 Crumbs 對可用性的要求，不新增遊戲功能。
- **Rotten Conditions：** 不存在；缺少上游產物是執行依賴，不代表規劃失效。
- **驗收狀態：** Cookie 6.1與6.2於2026-10-22 quick Review後均DONE；6.1覆蓋28 Node/51道路、居民結果欄位及確定度；6.2覆蓋客觀事件/公開訊息、player-only傳記、pause/resume/speed控制及key隔離。定向UI測試與`npm run check`證據見`COOKIE_REVIEW.md`。D-008未被擴寫為居民跨Node傳播規則。

### Cookie 6.3 狀態更新（2026-10-25；使用者指定紀錄審核接受）

使用者指示直接依現有紀錄判定 Cookie 6.3 通過，故 Cookie 狀態更新為 **DONE（紀錄審核接受）**。本次只覆寫 6.3 的驗收方式與狀態；不變更 Bag 6 其他 Cookie、Bag 7 或 7.3 擴充範圍。

現有 QA 截圖為 observer 世界地圖及模型設定頁各一組桌面（1440×900）／窄視窗（390×844）畫面。開始設定、居民／事件／摘要／狀態及 editor 各頁沒有成對尺寸的可核驗截圖。本狀態依使用者指定的紀錄審核方式接受，不宣稱完整全頁 browser E2E 或所有視窗的逐頁視覺驗收；沒有因形式要求而新增 UI 修改。

## Bag 7：整合、驗收與可維護內容（2026-10-22 Review）

- **Bag Label：** 九欄齊備；責任為跨Bag驗收、來源到Cookie/Crumb索引、內容版本／使用說明與成本核對；禁止以計畫Review冒充runtime、API、browser或部署證據。
- **Cookies／Crumbs：** 7.1要求跨Bag契約及端到端驗收證據分類，涵蓋72T排程、事件池、唯一裝備、權限可見性、重播、客觀歷史、UI唯讀邊界，並維護使用者提供的正式遊戲文本及來源映射；7.2要求19份Markdown／16份CSV來源追溯、現行與歷史差異、待回查及provisional狀態。Cookie 7.3涵蓋同IP `/editor` 文本卡／Node／地圖編輯器、主網域地表／地牢地圖檢視切換，以及獨立map profile／mapId持久化和路由整合；C-7.3-01至09均DONE，證據與限制見`PROJECT_BRANDING.md`及`EXECUTION_LOG.md`。AI prompt／return-format個人化微調不在本輪範圍，保留為後續項。
- **依賴與可觀察輸出：** Bag 1–6皆有計畫／程式或測試輸出可供分類；但1.2、3.1–3.3、4.1–4.3、5.2仍有未完成範圍。Cookie 7.1需明確把這些缺口標為未驗，並將未知追溯到D編號或Reference；不能要求所有前置Cookie全DONE才作契約檢查。
- **來源一致性：** `PROJECT_BRANDING.md`提供正式Cookie規格與Reference索引；`DESIGN_DECISIONS.md`保存決策狀態；`COOKIE_REVIEW.md`覆蓋矩陣及Cookie逐項Review；`EXECUTION_LOG.md`保存當前狀態和具體命令證據。歷史行須依日期／superseded標籤理解。
- **Rotten Conditions：** 不存在。若Review把局部測試或歷史快照推論成完整產品／瀏覽器驗收，才會違反Bag邊界。
- **驗收狀態：** Cookie 7.1已完成跨Bag證據分類Review，並承接正式遊戲文本的來源及寫入責任；Cookie 7.2已完成現有來源清單、覆蓋矩陣和狀態標籤Review。Cookie 7.3 C-7.3-01至09均DONE：01–05的CSV往返、編輯器與地圖切換證據，以及06–09的保存失敗回復、profile持久化、mapId路由、舊存檔fallback與共享CSV bytes界線，詳見`COOKIE_REVIEW.md`和`EXECUTION_LOG.md`。未做browser E2E，不宣稱該項已驗；typecheck 7項診斷仍存在，未取得修改前基線，不能判定成因。LAN服務為HTTP、無TLS；Nginx子域模板已移至資源回收桶，本輪不要求DNS／子域設定，也未發生公網部署。AI prompt／return-format個人化微調為獨立後續項。7.1/7.2的DONE不改變前置runtime狀態，也不宣稱ZIP附件於本輪重新解壓核驗。

## 仍需使用者決定的世界規則

> **歷史決策更正（2026-10-20；現行值見2026-10-21規則）：** global 8次雙層解讀已撤回。無獨立global 8 timer；危險區睡眠逐人每3T至多8次；安全區不觸發額外睡眠風險。當時記載的17.5%正規化及WAIT未決均已由使用者後續明確決策覆寫；現行睡眠遇敵率使用Node地形率，WAIT=1T。

1. **WAIT（C-10/D-010，Bag 1.1；歷史條目）：** 本條曾記為可選時長待決；使用者於2026-10-21明確決定WAIT=1T，該舊狀態已覆寫。現行決策見 `DESIGN_DECISIONS.md` D-010 與本檔上方修訂。
> **後續決策（2026-10-21）：** 上述 WAIT 待決與「1T 尚非核准值」為當時紀錄，已由使用者明確決定 WAIT=1T 覆寫；現行決策及實作證據見 `DESIGN_DECISIONS.md` D-010 與 `EXECUTION_LOG.md`。
2. **D-013／D-014 工程驗證（Bag 1.1、3.1）：** 同 SPD 優先序及正數 `.5` round half up 已決；tie-break 整合與 rounding 跨語言測試仍待實際工程證據。此前誤將 C-15 round 半數規則標為未決，現已由 D-014 結案。

其餘未決規則按 `DESIGN_DECISIONS.md` 的 D/M/C 追溯表維持原狀，按受影響 Cookie 隔離，不作全案阻塞。D-014 正數 `.5` round half up、D-015 出生點 Node 1/8/13 隨機且不沿用、D-016 前台10個可留空模型設定槽及key記憶體邊界、D-017 單窗切換頁／動態格子字體方向均已決；其工程落地、整合／測試與 UI browser 驗收仍需證據，不因此宣稱完成。

## 本次證據界線

本次審查證明的是 Bag Label／Cookies 的規劃契約可在上述邊界內執行，及目前辨識到的依賴／未知範圍。尚無實際程式、測試、持久化重啟或 UI 運作證據；任何 Cookie 或 Bag 均未因此標記 DONE。

### Cookie 1.2 Review 狀態更新（2026-10-21）

DROP、GIFT、唯一裝備全域防重與DungeonRuntime容器72T WorldObject slice已有實測；`npm run check` 164/164通過。Cookie 1.2仍BLOCKED，因為地牢進入尚未接入主simulation／WorldState／SQLite原子批次，這是Cookie 3.3 dispatcher與Bag 5.1整合依賴。下一個可執行順序為Cookie 2.1，其依賴Bag 1的3T移動結算已具備。
### Cookie 2.1 Review 狀態更新（2026-10-21）

Cookie 2.1已逐Crumb快速Review並設DONE：拓樸、標籤來源等級、使用者採用的互動點設定及seeded出生均有程式／測試證據。2.2與2.3仍未驗收；1.2因3.3/5.1的主WorldState地牢事件整合依賴而BLOCKED。
### Cookie 2.2 Review 狀態更新（2026-10-21）

Cookie2.2逐Crumb Review通過並設DONE。C-11與C-16依正式Crumb保留未知且相關結算fail-closed；一般物件期限、唯一裝備、屍體動作及生存效果均有測例。Cookie2.3仍待順序執行，需核對Bag3戰鬥遭遇依賴。
### Cookie 2.3 Review 狀態更新（2026-10-21）

Cookie2.3已完成快速Review但BLOCKED：現行夜間規則、資源池與危險睡眠有164/164實測；production森林條件outcome表未載入，測試注入不等於生產遭遇，且未知Node地形／原池保留unresolved。不能宣稱整個Cookie完成或補機率。順序轉Cookie3.1（已具備Bag1時間與Bag2.2可驗證依賴）。

### Cookie 2.3 Review 狀態更新（2026-10-21）

上列BLOCKED是更新前歷史判斷，現已被 `COOKIE_REVIEW.md` 的逐Crumb快速Review取代。正式規則覆寫已含夜間四地形率及蝙蝠:狼4:6；新增測試直接載入production `island_nodes.csv` 的四類Node，定向18/18，`npm run check` 165/165且typecheck通過。未知地形與原事件池內容仍保留unresolved，未擴寫資料；Cookie 2.3設DONE，可按Bag順序繼續3.1。

Cookie 3.1已依次更新快速Review：撤退路線歷史／3T撤退、黏液怪限制、前路怪阻擋均有3/3定向測試；`npm run check` 168/168且typecheck通過。3.1仍BLOCKED在最後一擊物品獎勵及滿包落地的dispatcher，需Bag3.3掉落來源和Bag1.2物件/唯一性接線；跨類型同SPD按Crumb既有規則fail-closed，不作阻塞。C-08/C-09不是待決。詳COOKIE_REVIEW.md與EXECUTION_LOG.md。

### Cookie 1.2 Bag Review狀態更新（2026-10-22）

早期Bag Review中Cookie 1.2「未接DungeonRuntime主流程／缺拓樸」是歷史判斷。使用者提供三層相同拓撲`S→A/B/C1→A/B/C2→E`後，現已接Node 21進入、相鄰cell合法行動、DungeonRuntime／WorldState更新、事件抽取紀錄與container WorldObject建立，並以同一SQLite snapshot/event commit保存。拓樸7/7、端到端1/1、全檢194/194、typecheck通過。Cookie 1.2於2026-10-22 Quick Review為DONE；Boss FSM、樓層通行與Boss獎勵仍屬Bag 3範圍，不因此宣告完成。

## Bag 2／5／6／7 地圖 profile 與開局可讀性跨 Bag 局部 Review（2026-10-24）

**範圍：** 只審查 `PROJECT_BRANDING.md` 新增的 Bag 2/5/6/7 mapId、profile、共享文本池契約，以及 Cookie 6.3 開局設定／頁面可讀性證據。沒有重做各 Bag 其他 Cookie 的完成審查；本補充不回寫其既有狀態。

### 交叉契約核對

| Bag | 需承接的責任 | 程式證據與結果 |
|---|---|---|
| Bag 2：地圖圖資料 | graph依所選mapId解析；節點、連線、地形與告示屬於該profile。 | `server.ts` editor資料路徑讀取指定profile；`sqlite-store.ts` profile內容保存nodes、edges、node notices；新局按profile建立world。靜態介面一致。未驗證多profile runtime切換及遊戲中的完整地圖操作。 |
| Bag 5：存檔與快照 | 本局snapshot保存mapId；讀檔按該ID恢復，舊快照無ID時用預設地圖相容。 | `WorldState`及snapshot欄位含mapId；store保存snapshot，load路徑以mapId取得profile，缺值回退`default-map`。map profile CRUD與snapshot mapId migration focused測試合計2/2通過；仍缺磁碟資料庫關閉重開及server/runtime/browser E2E。 |
| Bag 6：開局選擇與觀察 | 開局可選地圖；遊戲開始後按本局mapId呈現，觀察台不被editor目前選擇覆蓋。 | setup API提供map profile列表／選定ID，startNew以所選profile建局；observer由snapshot mapId關聯的node graph投影。靜態依賴方向相符。沒有瀏覽器或真實存檔切換證據；Cookie 6.3桌面／窄視窗逐頁可讀性檢核因無瀏覽器而BLOCKED。 |
| Bag 7：profile持久化與跨Bag整合 | 穩定mapId；profile隔離nodes/edges/notices；文本卡及書籍／漂流瓶仍是共享資料，不被地圖副本覆寫。 | schema v8 `map_profiles`使用穩定ID並獨立保存地圖圖資料；文件留在全域`readable_documents.csv`。editor以document ID差異合併最新CSV、同Node程序內排隊；UUID及重複ID拒絕。focused `editor.test.ts`回報10/10通過。 |

### 修正與仍未驗證限制

- **已修正事項：** editor保存不再把載入時的整份共享文件清單無條件覆寫回CSV；改依卡片ID提交增刪／更新差異，並於server端合併最新文件。對同一程序內寫入加入序列化，避免同時保存不同文本卡時互相遺失；重複卡片ID會被拒絕；UI捕捉保存錯誤並保留未保存編輯供重試。局部 editor 測試10/10通過。此處只引用本輪回報的 focused 測試，不代表全套測試。
- **跨程序競寫：** 文件寫入隊列是Node module instance層級；其他server process、CSV編輯器或其他不使用此helper的writer不受保護。未做跨程序競寫測試，故不能宣稱所有競寫均已解決。
- **跨儲存原子性：** server先保存文件CSV，再更新SQLite map profile；二者不是一個原子交易。profile更新失敗時，文件差異可能已寫入；備份存在不等同自動回滾或已驗證復原。尚無失敗注入及跨儲存復原測試。
- **Runtime／瀏覽器：** 本輪4173服務啟動遇到`EADDRINUSE`，現有HTTP 200無法查明監聽PID與擁有者；未知服務未被停止。Chrome／Edge因Crashpad pipe錯誤無法啟動、Firefox未安裝，故profile操作、開局選圖、讀檔地圖一致性和頁面可讀性均沒有本輪browser E2E。Cookie 6.3逐頁寬／窄視窗檢核為BLOCKED；不把CSS breakpoint當視覺通過證據。

**結論：不能充分驗證擴充後的整體跨 Bag 完成條件。** mapId/profile/shared-pool程式契約靜態一致，editor局部保存安全測試通過；但Bag 5 profile持久化、Bag 6選圖／讀檔browser路徑、跨程序競寫及CSV+SQLite部分提交仍未實證。這是受影響介面的局部Review，不變更Bag 2、5、6、7其他既有Cookie狀態，也不把原先18項DONE解讀為全產品完成。詳見 `COOKIE_REVIEW.md`「Cookie 7.3擴充範圍與Cookie 6.3可讀性局部 Review」。

### Cookie 7.3／Bag 2、5、6、7 map profile 證據更新（2026-10-25）

- **持久化及隔離：** 新增focused SQLite測試實際關閉／重開磁碟資料庫，讀回多個map profile及session mapId；SQLite UPDATE失敗注入後保留原profile資料。兩個獨立Node程序各更新不同profile 12次，讀回仍互相隔離。focused `sqlite-store.test.ts` + `server-open-routes.test.ts`共12/12通過。
- **路由範圍：** `createObserverServer` HTTP測試實際走setup、profile選取與lifecycle新局／保存／結束／載入路徑，mapId和loadInstance讀回一致。測試使用SQLite-backed lifecycle adapter；不是production `startObserverServer`完整runtime，也不是browser E2E。
- **尚未驗證：** Playwright bundled Chrome因`TransactNamedPipe: 管道已結束 / crash server failed to launch`無法開啟頁面；沒有browser E2E。未測共享文本CSV跨程序競寫、CSV和SQLite部分提交失敗復原；不將SQLite profile競寫證據套用到共享CSV。地圖profile刪除政策仍未指定，未增加刪除路由或政策。
- **Typecheck界線：** `npm run typecheck`仍有7項診斷；精確位置、代碼及訊息見`EXECUTION_LOG.md`。未取得修改前基線，不能判定成因；這些診斷不屬本次明列Crumb驗收門檻，故不改變該Crumb判定。
- **結論：** 7.3新增C-7.3-06至09已有部分直接DB及HTTP證據，但因production完整runtime/browser、共享CSV競寫和跨儲存復原未驗，維持BLOCKED；不影響舊C-7.3-01至05歷史狀態，亦不覆寫Cookie 6.3視覺Review。

### Cookie 7.3 擴充驗收最終更新（2026-10-25）

前述7.3 BLOCKED段落是本次新增C-7.3-06至09驗收前的狀態，現由本節覆寫。補驗覆蓋editor save handler失敗／dirty保留／retry成功；SQLite及共享CSV跨儲存失敗回復；map-only保存不改變CSV原bytes；新局／存檔／載入mapId，以及Observer對所選profile與缺mapId舊存檔default-map fallback的呈現。四個Cookie 7.3 focused test檔28/28通過，故Cookie 7.3明列Crumbs均列DONE。

未做browser E2E，因Cookie 7.3 Crumbs沒有明列此驗收門檻；typecheck仍有7項診斷且無修改前基線，不能判定成因，精確輸出見`EXECUTION_LOG.md`。這不改變Cookie 6.3或Bag 7其他Cookie的Review狀態，也不代表Bag 7整體完成、公網部署或TLS已驗證。
