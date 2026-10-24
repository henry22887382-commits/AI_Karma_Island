import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_INPUT_TOKENS = 8000;
const DEFAULT_MAX_CONTEXT_CHARACTERS = 8000;

export type ModelSlotConfig = {
  readonly slotId: number;
  readonly provider: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly fallbackModels: readonly string[];
  readonly inputUsdPerMillion: number | null;
  readonly outputUsdPerMillion: number | null;
  readonly maxInputTokens: number | null;
  readonly maxContextCharacters: number;
  readonly maxOutputTokens: number | null;
  readonly modelSizeB: number | null;
  readonly sizeAtLeast8BConfirmed: boolean;
  readonly styleDescription: string | null;
  readonly updatedAt: string | null;
  readonly credentialRef: string;
};

export type ModelSlotInput = Omit<ModelSlotConfig, 'updatedAt' | 'credentialRef' | 'maxOutputTokens' | 'maxContextCharacters'> & {
  /** Legacy input accepted for source compatibility; new settings never read or write it. */
  readonly maxOutputTokens?: number | null;
  /** Optional for old callers; omitted values preserve the historical 8000-character budget. */
  readonly maxContextCharacters?: number;
};

export type SummarizerConfig = { readonly modelSlotId: number | null; readonly prompt: string; readonly updatedAt: string | null };
export type SummarizerInput = Pick<SummarizerConfig, 'modelSlotId' | 'prompt'>;
export type DeathSummaryRecord = { readonly summaryId: string; readonly sessionId: string | null; readonly sourceSaveId: string | null; readonly loadInstanceId: string | null; readonly residentId: string; readonly displayName: string; readonly status: 'pending' | 'running' | 'complete' | 'failed'; readonly text: string | null; readonly error: string | null; readonly updatedAt: string };

export class ModelSettingsStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS model_slots (
        slot_id INTEGER PRIMARY KEY CHECK (slot_id BETWEEN 1 AND 10),
        provider TEXT,
        base_url TEXT,
        model TEXT,
        fallback_models_json TEXT NOT NULL CHECK (json_valid(fallback_models_json)),
        input_usd_per_million REAL,
        output_usd_per_million REAL,
        max_input_tokens INTEGER,
        max_context_characters INTEGER NOT NULL DEFAULT 8000,
        max_output_tokens INTEGER,
        model_size_b REAL,
        size_at_least_8b_confirmed INTEGER NOT NULL DEFAULT 0,
        style_description TEXT,
        updated_at TEXT,
        credential_ref TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS summarizer_settings (singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1), provider TEXT, base_url TEXT, model TEXT, max_input_tokens INTEGER NOT NULL DEFAULT 8000, prompt TEXT NOT NULL DEFAULT '', updated_at TEXT, credential_ref TEXT, model_slot_id INTEGER);
      CREATE TABLE IF NOT EXISTS death_summaries (summary_id TEXT PRIMARY KEY, session_id TEXT, source_save_id TEXT, load_instance_id TEXT, resident_id TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','running','complete','failed')), text TEXT, error TEXT, updated_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS credentials (credential_ref TEXT PRIMARY KEY, secret TEXT NOT NULL) STRICT;
      INSERT OR IGNORE INTO summarizer_settings(singleton_id, max_input_tokens, prompt) VALUES (1, 8000, '請用繁體中文，以故事體總結這位居民的一生與重要行動。');
    `);
    const columns = new Set((this.database.prepare('PRAGMA table_info(model_slots)').all() as unknown as readonly { readonly name: string }[]).map(({ name }) => name));
    if (!columns.has('max_context_characters')) this.database.exec('ALTER TABLE model_slots ADD COLUMN max_context_characters INTEGER NOT NULL DEFAULT 8000;');
    if (!columns.has('credential_ref')) this.database.exec('ALTER TABLE model_slots ADD COLUMN credential_ref TEXT;');
    if (!columns.has('model_size_b')) this.database.exec('ALTER TABLE model_slots ADD COLUMN model_size_b REAL;');
    if (!columns.has('size_at_least_8b_confirmed')) this.database.exec('ALTER TABLE model_slots ADD COLUMN size_at_least_8b_confirmed INTEGER NOT NULL DEFAULT 0;');
    if (!columns.has('style_description')) this.database.exec('ALTER TABLE model_slots ADD COLUMN style_description TEXT;');
    const insert = this.database.prepare('INSERT OR IGNORE INTO model_slots(slot_id, fallback_models_json) VALUES (?, ?)');
    for (let slotId = 1; slotId <= 10; slotId += 1) insert.run(slotId, '[]');
    const rows = this.database.prepare('SELECT slot_id FROM model_slots WHERE credential_ref IS NULL OR credential_ref = ?').all('') as unknown as readonly { readonly slot_id: number }[];
    const updateRef = this.database.prepare('UPDATE model_slots SET credential_ref=? WHERE slot_id=?');
    for (const row of rows) updateRef.run(randomUUID(), row.slot_id);
    const summarizerColumns = new Set((this.database.prepare('PRAGMA table_info(summarizer_settings)').all() as unknown as readonly { readonly name: string }[]).map(({ name }) => name));
    if (!summarizerColumns.has('model_slot_id')) this.database.exec('ALTER TABLE summarizer_settings ADD COLUMN model_slot_id INTEGER;');
    const deathSummaryColumns = new Set((this.database.prepare('PRAGMA table_info(death_summaries)').all() as unknown as readonly { readonly name: string }[]).map(({ name }) => name));
    if (!deathSummaryColumns.has('session_id')) this.database.exec('ALTER TABLE death_summaries ADD COLUMN session_id TEXT;');
    if (!deathSummaryColumns.has('source_save_id')) this.database.exec('ALTER TABLE death_summaries ADD COLUMN source_save_id TEXT;');
    if (!deathSummaryColumns.has('load_instance_id')) this.database.exec('ALTER TABLE death_summaries ADD COLUMN load_instance_id TEXT;');
    this.database.exec(`UPDATE summarizer_settings
      SET model_slot_id=(SELECT slot_id FROM model_slots
        WHERE model_slots.provider=summarizer_settings.provider
          AND model_slots.base_url=summarizer_settings.base_url
          AND model_slots.model=summarizer_settings.model
        ORDER BY slot_id LIMIT 1)
      WHERE model_slot_id IS NULL AND provider IS NOT NULL AND base_url IS NOT NULL AND model IS NOT NULL`);
  }

  readSummarizer(): SummarizerConfig { return this.database.prepare('SELECT model_slot_id as modelSlotId,prompt,updated_at as updatedAt FROM summarizer_settings WHERE singleton_id=1').get() as SummarizerConfig; }
  readCredentials(): readonly { readonly credentialRef: string; readonly secret: string }[] { return this.database.prepare('SELECT credential_ref as credentialRef,secret FROM credentials').all() as unknown as readonly { readonly credentialRef: string; readonly secret: string }[]; }
  writeCredential(credentialRef: string, secret: string): void { this.database.prepare('INSERT INTO credentials(credential_ref,secret) VALUES (?,?) ON CONFLICT(credential_ref) DO UPDATE SET secret=excluded.secret').run(credentialRef, secret); }
  deleteCredential(credentialRef: string): void { this.database.prepare('DELETE FROM credentials WHERE credential_ref=?').run(credentialRef); }
  deleteAllCredentials(): void { this.database.exec('DELETE FROM credentials'); }
  saveSummarizer(input: SummarizerInput, updatedAt = new Date().toISOString()): SummarizerConfig {
    if (input.modelSlotId !== null && (!Number.isSafeInteger(input.modelSlotId) || !this.readSlots().some(({ slotId }) => slotId === input.modelSlotId))) throw new RangeError('總結者必須選擇已存在的模型卡。');
    if (input.prompt.length > 4000) throw new RangeError('總結者指示最多 4000 字。');
    const previous = this.readSummarizer();
    const same = previous.modelSlotId === input.modelSlotId && previous.prompt === input.prompt;
    this.database.prepare('UPDATE summarizer_settings SET model_slot_id=?,prompt=?,updated_at=? WHERE singleton_id=1').run(input.modelSlotId,input.prompt,same ? previous.updatedAt : updatedAt);
    return this.readSummarizer();
  }
  listDeathSummaries(): readonly DeathSummaryRecord[] {
    return this.database.prepare('SELECT summary_id as summaryId,session_id as sessionId,source_save_id as sourceSaveId,load_instance_id as loadInstanceId,resident_id as residentId,display_name as displayName,status,text,error,updated_at as updatedAt FROM death_summaries ORDER BY updated_at DESC').all() as unknown as readonly DeathSummaryRecord[];
  }
  deathSummaryRetryTarget(summaryId: string, residentId: string): { readonly status: DeathSummaryRecord['status']; readonly sessionId: string | null; readonly sourceSaveId: string | null; readonly loadInstanceId: string | null } | null {
    const row = this.database.prepare('SELECT status,session_id as sessionId,source_save_id as sourceSaveId,load_instance_id as loadInstanceId FROM death_summaries WHERE summary_id=? AND resident_id=?').get(summaryId, residentId) as { status: DeathSummaryRecord['status']; sessionId: string | null; sourceSaveId: string | null; loadInstanceId: string | null } | undefined;
    return row ?? null;
  }
  deathSummaryIdForIdentity(sessionId: string, sourceSaveId: string | null, loadInstanceId: string | null, residentId: string): string | null {
    const rows = this.database.prepare('SELECT summary_id as summaryId FROM death_summaries WHERE session_id=? AND source_save_id IS ? AND load_instance_id IS ? AND resident_id=?').all(sessionId, sourceSaveId, loadInstanceId, residentId) as unknown as readonly { readonly summaryId: string }[];
    return rows.length === 1 ? rows[0]!.summaryId : null;
  }
  deathSummaryStatus(summaryId: string, residentId: string): DeathSummaryRecord['status'] | null {
    const row = this.database.prepare('SELECT status FROM death_summaries WHERE summary_id=? AND resident_id=?').get(summaryId, residentId) as { status: DeathSummaryRecord['status'] } | undefined;
    return row?.status ?? null;
  }
  retryFailedDeathSummary(summaryId: string, sessionId: string, sourceSaveId: string | null, loadInstanceId: string, residentId: string): boolean {
    return this.database.prepare("UPDATE death_summaries SET status='pending',error=NULL,updated_at=? WHERE summary_id=? AND session_id=? AND source_save_id IS ? AND load_instance_id=? AND resident_id=? AND status='failed'").run(new Date().toISOString(), summaryId, sessionId, sourceSaveId, loadInstanceId, residentId).changes === 1;
  }
  ensureDeathSummary(summaryId: string, sessionId: string, sourceSaveId: string | null, loadInstanceId: string | null, residentId: string, displayName: string): void { this.database.prepare("INSERT OR IGNORE INTO death_summaries(summary_id,session_id,source_save_id,load_instance_id,resident_id,display_name,status,updated_at) VALUES (?,?,?,?,?,?,'pending',?)").run(summaryId,sessionId,sourceSaveId,loadInstanceId,residentId,displayName,new Date().toISOString()); }
  startDeathSummary(summaryId: string, sessionId: string, sourceSaveId: string | null, loadInstanceId: string | null, residentId: string): boolean { return this.database.prepare("UPDATE death_summaries SET status='running',error=NULL,updated_at=? WHERE summary_id=? AND session_id=? AND source_save_id IS ? AND load_instance_id IS ? AND resident_id=? AND status='pending'").run(new Date().toISOString(),summaryId,sessionId,sourceSaveId,loadInstanceId,residentId).changes === 1; }
  requeueInterruptedDeathSummaries(): void { this.database.prepare("UPDATE death_summaries SET status='pending',error='伺服器在摘要完成前重新啟動；已排回重試。',updated_at=? WHERE status='running'").run(new Date().toISOString()); }
  finishDeathSummary(summaryId: string, sessionId: string, sourceSaveId: string | null, loadInstanceId: string | null, residentId: string, text: string): void { this.database.prepare("UPDATE death_summaries SET status='complete',text=?,error=NULL,updated_at=? WHERE summary_id=? AND session_id=? AND source_save_id IS ? AND load_instance_id IS ? AND resident_id=? AND status='running'").run(text,new Date().toISOString(),summaryId,sessionId,sourceSaveId,loadInstanceId,residentId); }
  failDeathSummary(summaryId: string, sessionId: string, sourceSaveId: string | null, loadInstanceId: string | null, residentId: string, error: string): void { this.database.prepare("UPDATE death_summaries SET status='failed',error=?,updated_at=? WHERE summary_id=? AND session_id=? AND source_save_id IS ? AND load_instance_id IS ? AND resident_id=? AND status='running'").run(error.slice(0,1000),new Date().toISOString(),summaryId,sessionId,sourceSaveId,loadInstanceId,residentId); }

  static open(path: string): ModelSettingsStore {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    return new ModelSettingsStore(new DatabaseSync(path));
  }

  readSlots(): readonly ModelSlotConfig[] {
    const rows = this.database.prepare(`SELECT slot_id,provider,base_url,model,fallback_models_json,input_usd_per_million,
      output_usd_per_million,max_input_tokens,max_context_characters,max_output_tokens,model_size_b,size_at_least_8b_confirmed,style_description,updated_at,credential_ref FROM model_slots ORDER BY slot_id`).all() as unknown as readonly SlotRow[];
    return rows.map((row) => ({
      slotId: row.slot_id,
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      fallbackModels: JSON.parse(row.fallback_models_json) as readonly string[],
      inputUsdPerMillion: row.input_usd_per_million,
      outputUsdPerMillion: row.output_usd_per_million,
      maxInputTokens: row.max_input_tokens ?? DEFAULT_MAX_INPUT_TOKENS,
      maxContextCharacters: row.max_context_characters ?? DEFAULT_MAX_CONTEXT_CHARACTERS,
      maxOutputTokens: row.max_output_tokens,
      modelSizeB: row.model_size_b,
      sizeAtLeast8BConfirmed: row.size_at_least_8b_confirmed === 1,
      styleDescription: row.style_description,
      updatedAt: row.updated_at,
      credentialRef: row.credential_ref ?? '',
    }));
  }

  saveSlot(input: ModelSlotInput, updatedAt = new Date().toISOString()): ModelSlotConfig {
    validateSlot(input);
    const previous = this.readSlots().find(({ slotId }) => slotId === input.slotId);
    if (!previous) throw new Error(`Model slot ${input.slotId} does not exist.`);
    if (input.provider !== null && input.model !== null) {
      const duplicate = this.readSlots().find((slot) => slot.slotId !== input.slotId
        && slot.provider === input.provider && slot.model === input.model);
      if (duplicate) throw new Error(`主模型 ${input.provider}/${input.model} 已配置於槽位 ${duplicate.slotId}。`);
    }
    const maxContextCharacters = input.maxContextCharacters ?? DEFAULT_MAX_CONTEXT_CHARACTERS;
    const sameRevision = isSameSlotConfig(previous, input, maxContextCharacters);
    const credentialRef = sameRevision ? previous.credentialRef : randomUUID();
    const revisionTime = sameRevision ? previous.updatedAt : updatedAt;
    this.database.prepare(`UPDATE model_slots SET provider=?,base_url=?,model=?,fallback_models_json=?,input_usd_per_million=?,
      output_usd_per_million=?,max_input_tokens=?,max_context_characters=?,model_size_b=?,size_at_least_8b_confirmed=?,style_description=?,updated_at=?,credential_ref=? WHERE slot_id=?`).run(
      input.provider, input.baseUrl, input.model, JSON.stringify(input.fallbackModels), input.inputUsdPerMillion,
      input.outputUsdPerMillion, input.maxInputTokens, maxContextCharacters, input.modelSizeB, Number(input.sizeAtLeast8BConfirmed), input.styleDescription, revisionTime, credentialRef, input.slotId,
    );
    const saved = this.readSlots().find(({ slotId }) => slotId === input.slotId);
    if (!saved) throw new Error(`Model slot ${input.slotId} was not saved.`);
    return saved;
  }

  close(): void { this.database.close(); }
}

export class ProcessModelSecrets {
  private readonly secrets = new Map<string, string>();
  private settings?: ModelSettingsStore;

  constructor(settings?: ModelSettingsStore) { if (settings) this.bind(settings); }

  bind(settings: ModelSettingsStore): void {
    this.settings = settings;
    this.secrets.clear();
    for (const credential of settings.readCredentials()) this.secrets.set(credential.credentialRef, credential.secret);
  }

  set(credentialRef: string, secret: string | undefined, clear = false): void {
    if (clear) { this.secrets.delete(credentialRef); this.settings?.deleteCredential(credentialRef); }
    else if (secret !== undefined && secret.length > 0) { this.secrets.set(credentialRef, secret); this.settings?.writeCredential(credentialRef, secret); }
  }

  has(credentialRef: string): boolean { return this.secrets.has(credentialRef); }

  getForCredential(credentialRef: string): string | undefined { return this.secrets.get(credentialRef); }

  copy(fromCredentialRef: string, toCredentialRef: string): boolean {
    const secret = this.secrets.get(fromCredentialRef);
    if (secret === undefined) return false;
    this.secrets.set(toCredentialRef, secret);
    this.settings?.writeCredential(toCredentialRef, secret);
    this.secrets.delete(fromCredentialRef);
    this.settings?.deleteCredential(fromCredentialRef);
    return true;
  }

  clearAll(): void { this.secrets.clear(); this.settings?.deleteAllCredentials(); }
}

export function isModelSlotReady(config: ModelSlotConfig, secretConfigured: boolean): boolean {
  return Boolean(
    config.provider && config.baseUrl && config.model && config.credentialRef && secretConfigured
    && config.maxInputTokens !== null,
  );
}

function validateSlot(input: ModelSlotInput): void {
  if (!Number.isInteger(input.slotId) || input.slotId < 1 || input.slotId > 10) throw new RangeError('模型槽位必須為 1–10。');
  const strings = [input.provider, input.baseUrl, input.model, ...input.fallbackModels];
  if (strings.some((value) => value !== null && value.length > 500)) throw new RangeError('設定文字欄位過長。');
  if (input.baseUrl !== null) {
    const url = new URL(input.baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('遠端 Provider Base URL 必須使用 HTTPS；本機測試可用 localhost。');
  }
  for (const [label, value] of [['輸入價格', input.inputUsdPerMillion], ['輸出價格', input.outputUsdPerMillion]] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new RangeError(`${label}必須是非負數。`);
  }
  for (const [label, value] of [['輸入 token 上限', input.maxInputTokens]] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`${label}必須是正整數。`);
  }
  const maxContextCharacters = input.maxContextCharacters ?? DEFAULT_MAX_CONTEXT_CHARACTERS;
  if (!Number.isSafeInteger(maxContextCharacters) || maxContextCharacters < 1) throw new RangeError('上下文字元上限必須是正整數。');
  if (input.styleDescription !== null && input.styleDescription.length > 160) throw new RangeError('風格描述最多 160 字。');
  if (new Set(input.fallbackModels).size !== input.fallbackModels.length) throw new Error('備援模型 ID 不可重複。');
}

type SlotRow = {
  readonly slot_id: number;
  readonly provider: string | null;
  readonly base_url: string | null;
  readonly model: string | null;
  readonly fallback_models_json: string;
  readonly input_usd_per_million: number | null;
  readonly output_usd_per_million: number | null;
  readonly max_input_tokens: number | null;
  readonly max_context_characters: number | null;
  readonly max_output_tokens: number | null;
  readonly model_size_b: number | null;
  readonly size_at_least_8b_confirmed: number;
  readonly style_description: string | null;
  readonly updated_at: string | null;
  readonly credential_ref: string | null;
};

function isSameSlotConfig(previous: ModelSlotConfig, next: ModelSlotInput, maxContextCharacters: number): boolean {
  return previous.provider === next.provider && previous.baseUrl === next.baseUrl && previous.model === next.model
    && previous.inputUsdPerMillion === next.inputUsdPerMillion && previous.outputUsdPerMillion === next.outputUsdPerMillion
    && previous.maxInputTokens === next.maxInputTokens
    && previous.maxContextCharacters === maxContextCharacters
    && previous.modelSizeB === next.modelSizeB && previous.sizeAtLeast8BConfirmed === next.sizeAtLeast8BConfirmed && previous.styleDescription === next.styleDescription
    && JSON.stringify(previous.fallbackModels) === JSON.stringify(next.fallbackModels);
}
