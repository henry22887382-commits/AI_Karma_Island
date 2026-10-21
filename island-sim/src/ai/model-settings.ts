import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export type ModelSlotConfig = {
  readonly slotId: number;
  readonly provider: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly fallbackModels: readonly string[];
  readonly inputUsdPerMillion: number | null;
  readonly outputUsdPerMillion: number | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly modelSizeB: number | null;
  readonly sizeAtLeast8BConfirmed: boolean;
  readonly styleDescription: string | null;
  readonly updatedAt: string | null;
  readonly credentialRef: string;
};

export type ModelSlotInput = Omit<ModelSlotConfig, 'updatedAt' | 'credentialRef'>;

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
        max_output_tokens INTEGER,
        model_size_b REAL,
        size_at_least_8b_confirmed INTEGER NOT NULL DEFAULT 0,
        style_description TEXT,
        updated_at TEXT,
        credential_ref TEXT
      ) STRICT;
    `);
    const columns = new Set((this.database.prepare('PRAGMA table_info(model_slots)').all() as unknown as readonly { readonly name: string }[]).map(({ name }) => name));
    if (!columns.has('credential_ref')) this.database.exec('ALTER TABLE model_slots ADD COLUMN credential_ref TEXT;');
    if (!columns.has('model_size_b')) this.database.exec('ALTER TABLE model_slots ADD COLUMN model_size_b REAL;');
    if (!columns.has('size_at_least_8b_confirmed')) this.database.exec('ALTER TABLE model_slots ADD COLUMN size_at_least_8b_confirmed INTEGER NOT NULL DEFAULT 0;');
    if (!columns.has('style_description')) this.database.exec('ALTER TABLE model_slots ADD COLUMN style_description TEXT;');
    const insert = this.database.prepare('INSERT OR IGNORE INTO model_slots(slot_id, fallback_models_json) VALUES (?, ?)');
    for (let slotId = 1; slotId <= 10; slotId += 1) insert.run(slotId, '[]');
    const rows = this.database.prepare('SELECT slot_id FROM model_slots WHERE credential_ref IS NULL OR credential_ref = ?').all('') as unknown as readonly { readonly slot_id: number }[];
    const updateRef = this.database.prepare('UPDATE model_slots SET credential_ref=? WHERE slot_id=?');
    for (const row of rows) updateRef.run(randomUUID(), row.slot_id);
  }

  static open(path: string): ModelSettingsStore {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    return new ModelSettingsStore(new DatabaseSync(path));
  }

  readSlots(): readonly ModelSlotConfig[] {
    const rows = this.database.prepare(`SELECT slot_id,provider,base_url,model,fallback_models_json,input_usd_per_million,
      output_usd_per_million,max_input_tokens,max_output_tokens,model_size_b,size_at_least_8b_confirmed,style_description,updated_at,credential_ref FROM model_slots ORDER BY slot_id`).all() as unknown as readonly SlotRow[];
    return rows.map((row) => ({
      slotId: row.slot_id,
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      fallbackModels: JSON.parse(row.fallback_models_json) as readonly string[],
      inputUsdPerMillion: row.input_usd_per_million,
      outputUsdPerMillion: row.output_usd_per_million,
      maxInputTokens: row.max_input_tokens,
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
    const sameRevision = isSameSlotConfig(previous, input);
    const credentialRef = sameRevision ? previous.credentialRef : randomUUID();
    const revisionTime = sameRevision ? previous.updatedAt : updatedAt;
    this.database.prepare(`UPDATE model_slots SET provider=?,base_url=?,model=?,fallback_models_json=?,input_usd_per_million=?,
      output_usd_per_million=?,max_input_tokens=?,max_output_tokens=?,model_size_b=?,size_at_least_8b_confirmed=?,style_description=?,updated_at=?,credential_ref=? WHERE slot_id=?`).run(
      input.provider, input.baseUrl, input.model, JSON.stringify(input.fallbackModels), input.inputUsdPerMillion,
      input.outputUsdPerMillion, input.maxInputTokens, input.maxOutputTokens, input.modelSizeB, Number(input.sizeAtLeast8BConfirmed), input.styleDescription, revisionTime, credentialRef, input.slotId,
    );
    const saved = this.readSlots().find(({ slotId }) => slotId === input.slotId);
    if (!saved) throw new Error(`Model slot ${input.slotId} was not saved.`);
    return saved;
  }

  close(): void { this.database.close(); }
}

export class ProcessModelSecrets {
  private readonly secrets = new Map<string, string>();

  set(credentialRef: string, secret: string | undefined, clear = false): void {
    if (clear) this.secrets.delete(credentialRef);
    else if (secret !== undefined && secret.length > 0) this.secrets.set(credentialRef, secret);
  }

  has(credentialRef: string): boolean { return this.secrets.has(credentialRef); }

  getForCredential(credentialRef: string): string | undefined { return this.secrets.get(credentialRef); }

  copy(fromCredentialRef: string, toCredentialRef: string): boolean {
    const secret = this.secrets.get(fromCredentialRef);
    if (secret === undefined) return false;
    this.secrets.set(toCredentialRef, secret);
    return true;
  }

  clearAll(): void { this.secrets.clear(); }
}

export function isModelSlotReady(config: ModelSlotConfig, secretConfigured: boolean): boolean {
  return Boolean(
    config.provider && config.baseUrl && config.model && config.credentialRef && secretConfigured
    && config.inputUsdPerMillion !== null && config.outputUsdPerMillion !== null
    && config.maxInputTokens !== null && config.maxOutputTokens !== null
    && config.sizeAtLeast8BConfirmed && !(config.modelSizeB !== null && config.modelSizeB < 8),
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
  for (const [label, value] of [['輸入 token 上限', input.maxInputTokens], ['輸出 token 上限', input.maxOutputTokens]] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`${label}必須是正整數。`);
  }
  if (input.modelSizeB !== null && (!Number.isFinite(input.modelSizeB) || input.modelSizeB < 0)) throw new RangeError('模型規模聲明必須是非負十進位數（B）。');
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
  readonly max_output_tokens: number | null;
  readonly model_size_b: number | null;
  readonly size_at_least_8b_confirmed: number;
  readonly style_description: string | null;
  readonly updated_at: string | null;
  readonly credential_ref: string | null;
};

function isSameSlotConfig(previous: ModelSlotConfig, next: ModelSlotInput): boolean {
  return previous.provider === next.provider && previous.baseUrl === next.baseUrl && previous.model === next.model
    && previous.inputUsdPerMillion === next.inputUsdPerMillion && previous.outputUsdPerMillion === next.outputUsdPerMillion
    && previous.maxInputTokens === next.maxInputTokens && previous.maxOutputTokens === next.maxOutputTokens
    && previous.modelSizeB === next.modelSizeB && previous.sizeAtLeast8BConfirmed === next.sizeAtLeast8BConfirmed && previous.styleDescription === next.styleDescription
    && JSON.stringify(previous.fallbackModels) === JSON.stringify(next.fallbackModels);
}
