import { groupApplies } from './pricing';
import type { CartLine, Menu, Order, OrderLine, Pickup, Service, Temp } from './types';

export const sar = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2)) + ' ر.س';
export const tempLabel = (t: Temp | null): string => (t === 'hot' ? 'ساخن' : t === 'cold' ? 'بارد' : '');

export const PICKUP_LABEL: Record<Pickup, string> = {
  now: 'الآن', '15': 'بعد 15 دقيقة', '30': 'بعد 30 دقيقة', arrive: 'عند وصولي',
};

export function serviceSummary(s: Service): string {
  if (s.type === 'dinein') {
    if (s.table != null) return 'محلي · طاولة ' + s.table;
    return s.later ? 'محلي · عند وصولك' : 'محلي · حدد طاولتك';
  }
  return 'سفري · الاستلام ' + PICKUP_LABEL[s.pickup];
}

export function orderWhere(o: Order): string {
  if (o.serviceType === 'dinein') return o.table != null ? 'محلي · طاولة ' + o.table : 'محلي · بانتظار الوصول';
  return 'سفري · ' + PICKUP_LABEL[o.pickup];
}

export interface LineView {
  title: string;
  meta: string;
  unit: number;
}

/** وصف سطر السلة من القائمة الحالية. يعيد null إن حُذف الصنف أو لم يعد صالحاً */
export function describeCartLine(menu: Menu, l: CartLine): LineView | null {
  const item = menu.items.find((i) => i.id === l.itemId);
  if (!item || !item.available) return null;
  const size = item.sizes[l.sizeIndex];
  if (!size || size.price == null) return null;
  const temp = item.hot && item.cold ? l.temp : null;
  let unit = size.price;
  const meta: string[] = [];
  if (temp) meta.push(tempLabel(temp));
  for (const c of l.choices) {
    const g = menu.groups.find((x) => x.id === c.groupId);
    if (!g || !groupApplies(item, g, temp)) continue;
    for (const i of g.multi ? c.optionIndexes : c.optionIndexes.slice(0, 1)) {
      const o = g.options[i];
      if (!o) return null;
      unit += o.price || 0;
      meta.push(o.label);
    }
  }
  if (item.noteTitle && l.note.trim()) meta.push('الوصف: ' + l.note.trim());
  return { title: item.sizes.length > 1 ? item.name + ' · ' + size.label : item.name, meta: meta.join('، '), unit };
}

export function describeOrderLine(l: OrderLine): { title: string; meta: string } {
  const meta: string[] = [];
  if (l.temp) meta.push(tempLabel(l.temp));
  l.choices.forEach((c) => meta.push(...c.labels));
  if (l.note) meta.push('الوصف: ' + l.note);
  const name = l.sizeLabel ? l.name + ' · ' + l.sizeLabel : l.name;
  return { title: l.qty > 1 ? name + ' × ' + l.qty : name, meta: meta.join('، ') };
}

export function stampMessage(stamps: number, need: number): string {
  const left = need - stamps;
  if (left <= 0) return 'كوبك المجاني جاهز في طلبك القادم';
  if (left === 1) return 'باقي طلب واحد لكوبك المجاني';
  if (left === 2) return 'باقي طلبان لكوبك المجاني';
  return 'باقي ' + left + ' طلبات لكوبك المجاني';
}

export function timeAgo(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'الآن';
  if (m < 60) return 'قبل ' + m + ' د';
  const h = Math.round(m / 60);
  if (h < 24) return 'قبل ' + h + ' س';
  return new Date(iso).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
}
