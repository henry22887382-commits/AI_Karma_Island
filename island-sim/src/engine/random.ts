import type { RandomDraw } from '../domain/model.ts';

export class SeededRandom {
  #state: number;

  constructor(stateHex: string) {
    if (!/^[0-9a-f]{8}$/i.test(stateHex)) throw new Error('RNG state must be eight hexadecimal characters.');
    this.#state = Number.parseInt(stateHex, 16) >>> 0;
    if (this.#state === 0) throw new Error('Xorshift RNG state cannot be zero.');
  }

  get stateHex(): string {
    return this.#state.toString(16).padStart(8, '0');
  }

  next(sourceId: string): RandomDraw {
    const stateBefore = this.stateHex;
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    const stateAfter = this.stateHex;
    return {
      sourceId,
      stateBefore,
      stateAfter,
      value: this.#state / 0x1_0000_0000,
    };
  }
}

export function seedToState(seed: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seed)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  if (hash === 0) hash = 0x6d2b79f5;
  return hash.toString(16).padStart(8, '0');
}
