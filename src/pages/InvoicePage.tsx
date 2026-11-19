import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PrintHost, Receipt, printInvoice, useInvoiceQr } from '../components/Receipt';
import { Loading } from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/pricing';
import type { Invoice } from '../lib/types';

/** صفحة الفاتورة العامة: يفتحها العميل من رابط الطلب أو من رمز QR غير الموقّع */
export function InvoicePage() {
  const { id = '' } = useParams();
  const [inv, setInv] = useState<Invoice | null | undefined>(undefined);
  const [error, setError] = useState('');
  const qr = useInvoiceQr(inv ?? null);
  useEffect(() => {
    api.getInvoice(id).then(setInv).catch((e) => { setError(errorText(e)); setInv(null); });
  }, [id]);
  if (inv === undefined) return <Loading />;
  return (
    <div className="invoice-page">
      {inv ? (
        <>
          <div className="row no-print" style={{ marginBottom: 16 }}>
            <Link to="/" className="btn btn-plain">مسدار</Link>
            <button type="button" className="btn btn-ink" onClick={() => printInvoice(inv, 'a4')}>طباعة أو حفظ PDF</button>
          </div>
          <Receipt inv={inv} size="a4" qr={qr} />
          <PrintHost />
        </>
      ) : <div className="error" role="alert">{error || 'لم نجد هذه الفاتورة.'}</div>}
    </div>
  );
}
