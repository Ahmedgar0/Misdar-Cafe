// القائمة الأولية للوضع التجريبي. نفس البيانات مزروعة في supabase/schema.sql.
import type { Menu, Size } from './types';

const sz = (...pairs: [string, number | null][]): Size[] => pairs.map(([label, price]) => ({ label, price }));
const opts = (...labels: string[]) => labels.map((label) => ({ label, price: 0 }));

export function seedMenu(): Menu {
  const sugar = 'g-sugar', milk = 'g-milk', ice = 'g-ice';
  const sudani = 'c-sudani', coffee = 'c-coffee', sweets = 'c-sweets';
  const base = { description: '', hot: true, cold: false, groupIds: [] as string[], noteTitle: '', available: true, freeCupEligible: false };
  let n = 0;
  const it = (id: string, categoryId: string, name: string, sizes: Size[], extra: Partial<typeof base> = {}) =>
    ({ ...base, ...extra, id, categoryId, name, sizes, sort: n++ });

  return {
    settings: { stampMin: 6, stampsForFree: 3, pointsPerRiyal: 1, pointsPerRiyalDiscount: 20, deliveryEnabled: false },
    categories: [
      { id: sudani, name: 'القهوة السودانية والشاي', sort: 0, visible: true },
      { id: coffee, name: 'القهوة', sort: 1, visible: true },
      { id: sweets, name: 'الحلويات', sort: 2, visible: true },
    ],
    groups: [
      { id: sugar, name: 'السكر', multi: false, coldOnly: false, defaultIndex: 2, options: opts('بدون سكر', 'سكر خفيف', 'سكر متوسط', 'سكر زيادة') },
      { id: milk, name: 'الحليب', multi: false, coldOnly: false, defaultIndex: 0, options: opts('حليب كامل الدسم', 'حليب قليل الدسم', 'حليب شوفان') },
      { id: ice, name: 'الثلج', multi: false, coldOnly: true, defaultIndex: 0, options: opts('ثلج عادي', 'ثلج قليل', 'بدون ثلج') },
    ],
    items: [
      it('i-jebena', sudani, 'قهوة سودانية', sz(['كوب', 5], ['كوب كبير', 7], ['جبنة صغيرة', null], ['جبنة متوسطة', null], ['جبنة كبيرة', null]),
        { description: 'جبنة', groupIds: [sugar], noteTitle: 'صف قهوتك', freeCupEligible: true }),
      it('i-tea-red', sudani, 'شاي أحمر', sz(['عادي', 3], ['كبير', 5]), { groupIds: [sugar] }),
      it('i-tea-muqannan', sudani, 'شاي مقنن', sz(['عادي', 5], ['كبير', 7]), { groupIds: [sugar] }),
      it('i-tea-milk', sudani, 'شاي بالحليب', sz(['عادي', 5], ['كبير', 7]), { groupIds: [sugar] }),
      it('i-espresso', coffee, 'إسبريسو', sz(['عادي', 4])),
      it('i-cod', coffee, 'قهوة اليوم', sz(['عادي', 4], ['كبير', 7]), { cold: true, groupIds: [sugar, ice], freeCupEligible: true }),
      it('i-nescafe', coffee, 'نسكافيه', sz(['عادي', 7], ['كبير', 9]), { groupIds: [sugar] }),
      it('i-cappuccino', coffee, 'كابتشينو', sz(['عادي', 7], ['كبير', 9]), { groupIds: [sugar, milk] }),
      it('i-latte', coffee, 'لاتيه', sz(['عادي', 7], ['كبير', 9]), { groupIds: [sugar, milk] }),
      it('i-spanish', coffee, 'سبانيش لاتيه', sz(['عادي', 7], ['كبير', 9]), { cold: true, groupIds: [milk, ice] }),
      it('i-americano', coffee, 'أمريكانو', sz(['عادي', 8], ['كبير', 10]), { groupIds: [sugar] }),
      it('i-matcha', coffee, 'ماتشا', sz(['عادي', 10]), { groupIds: [sugar, milk] }),
      it('i-luqaimat', sweets, 'لقيمات', sz(['صغير', 5], ['متوسط', 10], ['كبير', 15]), { hot: false }),
      it('i-cookies', sweets, 'كوكيز', sz(['عادي', 5]), { hot: false }),
      it('i-madeeda', sweets, 'مديدة', sz(['عادي', 5], ['كبير', 7]), { hot: false }),
    ],
  };
}
