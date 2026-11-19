// عامل خلفي واحد تتشاركه كل تبويبات الوضع التجريبي، فلا تتعارض الكتابة على قاعدة المتصفح.
import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';

void worker({
  async init() {
    try {
      return await PGlite.create('idb://misdar-demo-v2');
    } catch {
      return await PGlite.create();
    }
  },
});
