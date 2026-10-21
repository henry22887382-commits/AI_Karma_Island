import { readFile } from 'node:fs/promises';

export interface CsvRow {
  readonly [column: string]: string;
}

export async function readCsv(path: URL): Promise<readonly CsvRow[]> {
  const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
  return parseCsv(text);
}

export function parseCsv(input: string): readonly CsvRow[] {
  const matrix = parseMatrix(input);
  const [header, ...rows] = matrix;
  if (header === undefined || header.length === 0) return [];
  const columns = header.map((name) => name.trim());
  if (new Set(columns).size !== columns.length || columns.some((name) => name.length === 0)) {
    throw new Error('CSV header must contain unique, non-empty column names.');
  }

  return rows.filter((row) => !(row.length === 1 && row[0] === '')).map((row, rowIndex) => {
    if (row.length !== columns.length) {
      throw new Error(`CSV row ${rowIndex + 2} has ${row.length} cells; expected ${columns.length}.`);
    }
    return Object.fromEntries(columns.map((column, columnIndex) => [column, row[columnIndex] ?? '']));
  });
}

function parseMatrix(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? '';
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('CSV ended inside a quoted cell.');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
