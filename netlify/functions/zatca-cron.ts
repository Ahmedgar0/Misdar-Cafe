// مهمة مجدولة كل 10 دقائق: توقيع الفواتير المعلّقة وإبلاغ الهيئة بها قبل مهلة الـ 24 ساعة.
import type { Config } from '@netlify/functions';
import { serviceClient } from '../lib/server';
import { reportSigned, signPending } from '../zatca/service';

export default async () => {
  const sb = serviceClient();
  const signed = await signPending(sb);
  const reported = await reportSigned(sb, 200);
  console.log('zatca-cron', JSON.stringify({ ...signed, ...reported }));
  return new Response('ok');
};

export const config: Config = { schedule: '*/10 * * * *' };
