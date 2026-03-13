const COLUMNS = 'ABCDEFGHIJKLMNO';

export function toCoordinate(row: number, col: number): string {
  const column = COLUMNS[col] ?? '?';
  return `${column}${row + 1}`;
}

export function moveToNotation(
  word: string,
  row: number,
  col: number,
  direction: 'across' | 'down',
): string {
  const base = toCoordinate(row, col);
  const arrow = direction === 'across' ? '→' : '↓';
  return `${word} ${base} ${arrow}`;
}
