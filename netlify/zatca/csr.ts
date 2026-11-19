// توليد المفتاح وطلب توقيع الشهادة (CSR) حسب مواصفات الهيئة، دون الاعتماد على openssl في الخادم.
import { createPublicKey, createSign, generateKeyPairSync } from 'node:crypto';
import { bitString, ctx, int, octet, oid, printable, seq, set, utf8 } from './der';

export type ZatcaEnv = 'sandbox' | 'simulation' | 'production';

export const CERT_TEMPLATE: Record<ZatcaEnv, string> = {
  sandbox: 'TSTZATCA-Code-Signing',
  simulation: 'PREZATCA-Code-Signing',
  production: 'ZATCA-Code-Signing',
};

export interface CsrInput {
  env: ZatcaEnv;
  vatNumber: string;        // 15 رقماً يبدأ وينتهي بـ 3
  orgName: string;          // اسم المكلّف
  branchName: string;       // اسم الفرع
  commonName: string;       // معرّف الجهاز
  serial: string;           // 1-اسم الحل|2-الطراز|3-الرقم التسلسلي
  location: string;         // عنوان الفرع
  industry: string;         // النشاط
  invoiceTypes?: string;    // 0100 = مبسطة فقط
}

export function generateKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return privateKey.export({ type: 'sec1', format: 'pem' }).toString();
}

const attr = (o: string, value: Buffer) => set(seq(oid(o), value));

export function buildCsr(privateKeyPem: string, c: CsrInput): string {
  if (!/^3\d{13}3$/.test(c.vatNumber)) throw new Error('VAT_NUMBER');
  const spki = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });

  const subject = seq(
    attr('2.5.4.6', printable('SA')),
    attr('2.5.4.11', utf8(c.branchName)),
    attr('2.5.4.10', utf8(c.orgName)),
    attr('2.5.4.3', utf8(c.commonName)),
  );
  const dirName = seq(
    attr('2.5.4.4', utf8(c.serial)),                         // SN
    attr('0.9.2342.19200300.100.1.1', utf8(c.vatNumber)),    // UID
    attr('2.5.4.12', utf8(c.invoiceTypes ?? '0100')),        // title
    attr('2.5.4.26', utf8(c.location)),                      // registeredAddress
    attr('2.5.4.15', utf8(c.industry)),                      // businessCategory
  );
  const extensions = seq(
    seq(oid('1.3.6.1.4.1.311.20.2'), octet(printable(CERT_TEMPLATE[c.env]))),
    seq(oid('2.5.29.17'), octet(seq(ctx(4, dirName)))),
  );
  const info = seq(
    int(0),
    subject,
    Buffer.from(spki),
    ctx(0, seq(oid('1.2.840.113549.1.9.14'), set(extensions))),
  );
  const signer = createSign('sha256');
  signer.update(info);
  const signature = signer.sign(privateKeyPem);
  const der = seq(info, seq(oid('1.2.840.10045.4.3.2')), bitString(signature));
  const b64 = der.toString('base64').replace(/.{64}/g, '$&\n').replace(/\n$/, '');
  return `-----BEGIN CERTIFICATE REQUEST-----\n${b64}\n-----END CERTIFICATE REQUEST-----\n`;
}
