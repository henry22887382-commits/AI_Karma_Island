/** Confirmed legacy item labels mapped to the inventory and equipment catalog name. */
export function canonicalInventoryItemId(itemId: string): string {
  if (itemId === '普通皮革下衣') return '布下裝';
  if (itemId === '雙手巨劍') return '鐵級雙手武器';
  if (itemId === '藍鰭／黑鮪魚') return '藍鰭/黑鮪魚';
  return itemId;
}
