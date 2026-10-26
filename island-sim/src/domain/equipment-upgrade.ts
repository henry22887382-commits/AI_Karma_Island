import { canonicalInventoryItemId } from './item-identity.ts';

/** Explicit one-tier paths keep weapons and armor within their own model families. */
const NEXT_TIER_BY_ITEM: Readonly<Record<string, string>> = {
  '破損木劍': '鐵劍',
  '鐵劍': '騎士劍',
  '木矛': '鐵矛',
  '鐵矛': '騎士矛',
  '木級雙手武器': '鐵級雙手武器',
  '鐵級雙手武器': '騎士級雙手武器',
  '簡易盾': '鐵盾',
  '鐵盾': '騎士盾',
  '布衣': '鎖甲上衣',
  '鎖甲上衣': '騎士上衣',
  '普通下衣低階': '普通下衣中階',
  '普通下衣中階': '騎士下衣',
  '布下裝': '鎖甲下裝',
  '鎖甲下裝': '騎士下裝',
  '簡易重甲上衣': '鐵重甲上衣',
  '鐵重甲上衣': '騎士重甲上衣',
  '簡易重甲下衣': '鐵重甲下衣',
  '鐵重甲下衣': '騎士重甲下衣',
};

export function nextEquipmentUpgrade(itemId: string): string | null {
  return NEXT_TIER_BY_ITEM[canonicalInventoryItemId(itemId)] ?? null;
}
