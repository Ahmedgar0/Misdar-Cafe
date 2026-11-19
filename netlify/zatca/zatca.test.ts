// اختبارات مكتبة الفوترة الإلكترونية مقابل ثلاثة مراجع مستقلة:
// openssl لطلب الشهادة، ومكتبة C14N القياسية لتجزئة الفاتورة، والمكتبة المرجعية zatca-xml-js لبنية التوقيع.
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { XmlCanonicalizer } from 'xmldsigjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { summarize, tokenToCert } from './api';
import { buildCsr, generateKey } from './csr';
import {
  INITIAL_PIH, certInfo, decodeTlv, invoiceHash, invoiceTemplate, pureInvoice, signInvoice, signedPropertiesHash, verifySignature,
  type ZatcaInvoice,
} from './invoice';

const require = createRequire(import.meta.url);
const ref = require('zatca-xml-js/lib/zatca/signing');
const refProps = require('zatca-xml-js/lib/zatca/templates/ubl_extension_signed_properties_template');
const { Certificate } = require('@fidm/x509');

const dir = mkdtempSync(join(tmpdir(), 'zatca-'));
let key = '';
let cert = '';

beforeAll(() => {
  // شهادة اختبار موقّعة ذاتياً بمنحنى secp256k1 ومُصدِر بصيغة شهادات الهيئة
  key = generateKey();
  writeFileSync(join(dir, 'key.pem'), key);
  execFileSync('openssl', ['req', '-x509', '-new', '-key', join(dir, 'key.pem'), '-sha256', '-days', '30',
    '-subj', '/DC=local/DC=gov/DC=extgazt/CN=TSZEINVOICE-SubCA-1', '-out', join(dir, 'cert.pem')]);
  // الهيئة ترسل الشهادة سطراً واحداً بترميز base64، فنستخدمها بالشكل نفسه
  cert = readFileSync(join(dir, 'cert.pem'), 'utf8').replace(/-----[^-]+-----|\s/g, '');
});

const seller = {
  name: 'مؤسسة مسدار للقهوة', vatNumber: '300000000000003', crNumber: '1010101010',
  address: { street: 'طريق الملك فهد', building: '1234', district: 'العليا', city: 'الرياض', postal: '12345' },
};

function sample(over: Partial<ZatcaInvoice> = {}): ZatcaInvoice {
  return {
    uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be', number: 'INV-000001', type: 'invoice',
    issuedAt: new Date('2026-11-19T11:40:40Z'), icv: 1, pih: INITIAL_PIH, seller, vatRate: 15,
    lines: [{ name: 'شاي أحمر · كبير', qty: 3, ex: 7.83, vat: 1.17 }, { name: 'كوكيز & <قطعة>', qty: 1, ex: 4.35, vat: 0.65 }],
    discountEx: 0, totalEx: 12.18, vatAmount: 1.83, rounding: -0.01, total: 14, paymentMeans: '10',
    ...over,
  };
}

describe('طلب الشهادة', () => {
  it('يتحقق منه openssl ويحمل قالب البيئة وحقول الهيئة', () => {
    const csr = buildCsr(key, {
      env: 'sandbox', vatNumber: '300000000000003', orgName: 'Misdar Cafe', branchName: 'Riyadh Branch',
      commonName: 'Misdar-POS-1', serial: '1-Misdar|2-Web|3-abc', location: 'Riyadh', industry: 'Food',
    });
    writeFileSync(join(dir, 'req.csr'), csr);
    const text = execFileSync('openssl', ['req', '-in', join(dir, 'req.csr'), '-verify', '-noout', '-text'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(text).toContain('TSTZATCA-Code-Signing');
    expect(text).toMatch(/Subject: C\s?=\s?SA, OU\s?=\s?Riyadh Branch, O\s?=\s?Misdar Cafe, CN\s?=\s?Misdar-POS-1/);
    expect(text).toMatch(/SN\s?=\s?1-Misdar\|2-Web\|3-abc/);
    expect(text).toMatch(/UID\s?=\s?300000000000003/);
    expect(text).toMatch(/title\s?=\s?0100/);
    expect(text).toMatch(/ASN1 OID: secp256k1/);
    // المفتاح العام في الطلب هو مفتاح الجهاز
    const pub = execFileSync('openssl', ['req', '-in', join(dir, 'req.csr'), '-pubkey', '-noout'], { encoding: 'utf8' });
    expect(createPublicKey(pub).export({ type: 'spki', format: 'der' }).equals(createPublicKey(key).export({ type: 'spki', format: 'der' }))).toBe(true);
    expect(() => buildCsr(key, { env: 'sandbox', vatNumber: '123' } as never)).toThrow('VAT_NUMBER');
  });
});

describe('تجزئة الفاتورة', () => {
  it('تطابق C14N القياسي بعد حذف العناصر الثلاثة من المستند', () => {
    const signed = signInvoice(sample({ discountEx: 1.74, totalEx: 10.44, vatAmount: 1.57, rounding: -0.01, total: 12 }), cert, key);
    const doc = new DOMParser().parseFromString(signed.xml, 'text/xml');
    const root = doc.documentElement as any;
    const drop = (el: any) => el.parentNode.removeChild(el);
    drop(root.getElementsByTagName('ext:UBLExtensions')[0]);
    drop(root.getElementsByTagName('cac:Signature')[0]);
    const refs = Array.from(root.getElementsByTagName('cac:AdditionalDocumentReference')) as any[];
    drop(refs.find((r) => r.getElementsByTagName('cbc:ID')[0].textContent === 'QR'));
    const c14n = new XmlCanonicalizer(false, false).Canonicalize(doc as any);
    expect(c14n).toBe(pureInvoice(invoiceTemplate(sample({ discountEx: 1.74, totalEx: 10.44, vatAmount: 1.57, rounding: -0.01, total: 12 }))));
    expect(createHash('sha256').update(c14n).digest('base64')).toBe(signed.hash);
  });

  it('PIH الأولي يطابق مواصفات الهيئة وقيمة قاعدة البيانات', () => {
    expect(INITIAL_PIH).toBe('NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==');
    const sql = readFileSync(new URL('../../supabase/002_admin_pos.sql', import.meta.url), 'utf8');
    expect(sql).toContain(INITIAL_PIH);
  });

  it('أي تغيير في المبلغ أو التسلسل يغيّر التجزئة، والتوقيت والتوقيع لا يغيّرانها', () => {
    const base = invoiceHash(invoiceTemplate(sample()));
    expect(invoiceHash(invoiceTemplate(sample({ total: 15 })))).not.toBe(base);
    expect(invoiceHash(invoiceTemplate(sample({ icv: 2 })))).not.toBe(base);
    const a = signInvoice(sample(), cert, key, new Date('2026-11-19T12:00:00Z'));
    const b = signInvoice(sample(), cert, key, new Date('2026-11-19T13:00:00Z'));
    expect(a.hash).toBe(base);
    expect(b.hash).toBe(base);
  });
});

describe('التوقيع', () => {
  it('يتحقق بالمفتاح العام للشهادة', () => {
    const s = signInvoice(sample(), cert, key);
    expect(verifySignature(s.hash, s.signature, cert)).toBe(true);
    expect(verifySignature(invoiceHash(invoiceTemplate(sample({ total: 99 }))), s.signature, cert)).toBe(false);
  });

  it('بيانات الشهادة وتجزئة الخصائص الموقّعة تطابق المكتبة المرجعية', () => {
    const mine = certInfo(cert);
    const theirs = ref.getCertificateInfo(cert);
    expect(mine.hash).toBe(theirs.hash);
    expect(mine.issuer).toBe(theirs.issuer);
    expect(mine.issuer).toBe('CN=TSZEINVOICE-SubCA-1, DC=extgazt, DC=gov, DC=local');
    expect(mine.serial).toBe(theirs.serial_number);
    const ts = '2026-11-19T11:44:32Z';
    const theirProps = refProps.defaultUBLExtensionsSignedPropertiesForSigning({
      sign_timestamp: ts, certificate_hash: theirs.hash, certificate_issuer: theirs.issuer, certificate_serial_number: theirs.serial_number,
    });
    const theirHash = Buffer.from(createHash('sha256').update(theirProps).digest('hex')).toString('base64');
    expect(signedPropertiesHash(ts, mine)).toBe(theirHash);
  });

  it('كتلة الخصائص الموقّعة داخل المستند تطابق مخرجات المكتبة المرجعية حرفياً', () => {
    const s = signInvoice(sample(), cert, key, new Date('2026-11-19T11:44:32Z'));
    const block = (x: string) => x.slice(x.indexOf('<xades:SignedProperties'), x.indexOf('</xades:QualifyingProperties>'));
    const theirs = ref.generateSignedXMLString({
      invoice_xml: new (require('zatca-xml-js/lib/parser').XMLDocument)(readFileSync(require.resolve('zatca-xml-js/lib/samples/index.js'), 'utf8').length ? signInvoiceRefDoc() : ''),
      certificate_string: cert, private_key_string: key,
    }).signed_invoice_string.replace(/<xades:SigningTime>[^<]+</, '<xades:SigningTime>2026-11-19T11:44:32Z<');
    expect(block(s.xml)).toBe(block(theirs));
  });
});

function signInvoiceRefDoc(): string {
  const { ZATCASimplifiedTaxInvoice } = require('zatca-xml-js');
  const inv = new ZATCASimplifiedTaxInvoice({ props: {
    egs_info: { uuid: 'x', CRN_number: '1', VAT_name: 'x', VAT_number: '300000000000003',
      location: { city: 'x', city_subdivision: 'x', street: 'x', plot_identification: '0000', building: '1234', postal_zone: '12345' } },
    invoice_counter_number: 1, invoice_serial_number: 'x', issue_date: '2026-11-19', issue_time: '14:40:40', previous_invoice_hash: INITIAL_PIH,
    line_items: [{ id: '1', name: 'x', quantity: 1, tax_exclusive_price: 1, VAT_percent: 0.15 }] } });
  return inv.getXML().toString({ no_header: false });
}

describe('رمز QR', () => {
  it('تسعة وسوم بالقيم الصحيحة', () => {
    const s = signInvoice(sample(), cert, key);
    const t = decodeTlv(s.qr);
    expect(t).toHaveLength(9);
    expect(t[0].toString()).toBe('مؤسسة مسدار للقهوة');
    expect(t[1].toString()).toBe('300000000000003');
    expect(t[2].toString()).toBe('2026-11-19T14:40:40Z');
    expect(t[3].toString()).toBe('14.01');
    expect(t[4].toString()).toBe('1.83');
    expect(t[5].toString()).toBe(s.hash);
    expect(t[6].toString()).toBe(s.signature);
    const fidm = Certificate.fromPEM(Buffer.from(readFileSync(join(dir, 'cert.pem'), 'utf8')));
    expect(t[7].equals(fidm.publicKeyRaw)).toBe(true);
    expect(t[8].equals(fidm.signature)).toBe(true);
    expect(s.xml).toContain(`>${s.qr}</cbc:EmbeddedDocumentBinaryObject>`);
  });
});

describe('بنية المستند', () => {
  it('إشعار الدائن يحمل المرجع والسبب، والمستند صالح البنية', () => {
    const s = signInvoice(sample({ type: 'credit_note', number: 'INV-CN-000002', refNumber: 'INV-000001', reason: 'طلب خاطئ' }), cert, key);
    expect(s.xml).toContain('<cbc:InvoiceTypeCode name="0200000">381</cbc:InvoiceTypeCode>');
    expect(s.xml).toMatch(/<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>INV-000001<\/cbc:ID>/);
    expect(s.xml).toContain('<cbc:InstructionNote>طلب خاطئ</cbc:InstructionNote>');
    const errors: string[] = [];
    new DOMParser({ onError: (_l: string, m: string) => errors.push(m) } as never).parseFromString(s.xml, 'text/xml');
    expect(errors).toEqual([]);
    // الرموز الخاصة مهرّبة
    expect(s.xml).toContain('<cbc:Name>كوكيز &amp; &lt;قطعة&gt;</cbc:Name>');
  });

  it('المبالغ: السعر × الكمية = صافي البند، والإجمالي متسق', () => {
    const xml = invoiceTemplate(sample());
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">2.61</cbc:PriceAmount>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">12.18</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">14.01</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableRoundingAmount currencyID="SAR">-0.01</cbc:PayableRoundingAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">14.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:IssueTime>14:40:40</cbc:IssueTime>');
  });
});

describe('واجهة الهيئة', () => {
  it('تفك الشهادة المرمّزة مرتين وتلخّص الأخطاء', () => {
    expect(tokenToCert(Buffer.from(cert).toString('base64'))).toBe(cert);
    expect(summarize({ validationResults: { errorMessages: [{ code: 'BR-KSA-37', message: 'building' }], warningMessages: [] } }))
      .toEqual({ errors: ['BR-KSA-37: building'], warnings: [] });
  });
});

// يمنع تحذير المتغير غير المستخدم في بعض البيئات
void generateKeyPairSync;
