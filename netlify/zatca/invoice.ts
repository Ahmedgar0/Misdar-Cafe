// فاتورة UBL 2.1 المبسطة وإشعاراتها حسب مواصفات الهيئة، مع التجزئة والتوقيع ورمز QR.
//
// الفاتورة تُكتب نصاً بصيغة قانونية جاهزة (C14N): لا وسوم ذاتية الإغلاق في الجزء المجزّأ، والسمات بترتيبها القانوني،
// وكل النطاقات معرّفة على العنصر الجذر. لذلك تجزئة الفاتورة = تجزئة النص نفسه بعد حذف العناصر الثلاثة التي
// تستثنيها الهيئة (UBLExtensions و cac:Signature ومرجع QR) مع إبقاء المسافات حولها، تماماً كما تفعل تحويلات XPath.
import { X509Certificate, createHash, createSign, createVerify } from 'node:crypto';
import { children, read } from './der';

export type DocType = 'invoice' | 'credit_note' | 'debit_note';

export interface Address { street: string; building: string; district: string; city: string; postal: string; additional?: string }

export interface ZatcaLine { name: string; qty: number; ex: number; vat: number }

export interface ZatcaInvoice {
  uuid: string;
  number: string;
  type: DocType;
  issuedAt: Date;
  icv: number;
  pih: string;
  refNumber?: string;   // للإشعارات: رقم الفاتورة الأصلية
  reason?: string;      // للإشعارات: سبب الإصدار
  seller: { name: string; vatNumber: string; crNumber: string; address: Address };
  vatRate: number;      // 15
  lines: ZatcaLine[];
  discountEx: number;
  totalEx: number;
  vatAmount: number;
  rounding: number;
  total: number;
  paymentMeans: '10' | '30' | '42' | '48';   // 10 نقد، 48 بطاقة
}

const TYPE_CODE: Record<DocType, string> = { invoice: '388', credit_note: '381', debit_note: '383' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const price = (n: number) => {
  const s = n.toFixed(6).replace(/0+$/, '');
  return s.endsWith('.') ? s + '00' : s.split('.')[1].length < 2 ? s + '0' : s;
};
const amt = (tag: string, n: number, f = money) => `<cbc:${tag} currencyID="SAR">${f(n)}</cbc:${tag}>`;

/** التاريخ والوقت بتوقيت الرياض */
export function riyadhParts(d: Date): { date: string; time: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}:${g('second')}` };
}

const UBL_EXT = '\u0000UBL\u0000';
const QR_REF = '\u0000QR\u0000';
const SIG_REF = '\u0000SIG\u0000';

/** قالب الفاتورة مع ثلاث علامات لمواضع العناصر المستثناة من التجزئة */
export function invoiceTemplate(inv: ZatcaInvoice): string {
  const { date, time } = riyadhParts(inv.issuedAt);
  const r = money(inv.vatRate);
  const sumLines = inv.lines.reduce((a, l) => a + l.ex, 0);
  const taxCat = (indent: string) => [
    `${indent}<cbc:ID>S</cbc:ID>`,
    `${indent}<cbc:Percent>${r}</cbc:Percent>`,
    `${indent}<cac:TaxScheme>`,
    `${indent}    <cbc:ID>VAT</cbc:ID>`,
    `${indent}</cac:TaxScheme>`,
  ].join('\n');
  const a = inv.seller.address;
  const isNote = inv.type !== 'invoice';

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">');
  out.push(`    ${UBL_EXT}`);
  out.push('    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>');
  out.push(`    <cbc:ID>${esc(inv.number)}</cbc:ID>`);
  out.push(`    <cbc:UUID>${inv.uuid}</cbc:UUID>`);
  out.push(`    <cbc:IssueDate>${date}</cbc:IssueDate>`);
  out.push(`    <cbc:IssueTime>${time}</cbc:IssueTime>`);
  out.push(`    <cbc:InvoiceTypeCode name="0200000">${TYPE_CODE[inv.type]}</cbc:InvoiceTypeCode>`);
  out.push('    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>');
  out.push('    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>');
  if (isNote) {
    out.push('    <cac:BillingReference>');
    out.push('        <cac:InvoiceDocumentReference>');
    out.push(`            <cbc:ID>${esc(inv.refNumber ?? '')}</cbc:ID>`);
    out.push('        </cac:InvoiceDocumentReference>');
    out.push('    </cac:BillingReference>');
  }
  out.push('    <cac:AdditionalDocumentReference>');
  out.push('        <cbc:ID>ICV</cbc:ID>');
  out.push(`        <cbc:UUID>${inv.icv}</cbc:UUID>`);
  out.push('    </cac:AdditionalDocumentReference>');
  out.push('    <cac:AdditionalDocumentReference>');
  out.push('        <cbc:ID>PIH</cbc:ID>');
  out.push('        <cac:Attachment>');
  out.push(`            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${inv.pih}</cbc:EmbeddedDocumentBinaryObject>`);
  out.push('        </cac:Attachment>');
  out.push('    </cac:AdditionalDocumentReference>');
  out.push(`    ${QR_REF}`);
  out.push(`    ${SIG_REF}`);
  out.push('    <cac:AccountingSupplierParty>');
  out.push('        <cac:Party>');
  out.push('            <cac:PartyIdentification>');
  out.push(`                <cbc:ID schemeID="CRN">${esc(inv.seller.crNumber)}</cbc:ID>`);
  out.push('            </cac:PartyIdentification>');
  out.push('            <cac:PostalAddress>');
  out.push(`                <cbc:StreetName>${esc(a.street)}</cbc:StreetName>`);
  if (a.additional) out.push(`                <cbc:AdditionalStreetName>${esc(a.additional)}</cbc:AdditionalStreetName>`);
  out.push(`                <cbc:BuildingNumber>${esc(a.building)}</cbc:BuildingNumber>`);
  out.push(`                <cbc:CitySubdivisionName>${esc(a.district)}</cbc:CitySubdivisionName>`);
  out.push(`                <cbc:CityName>${esc(a.city)}</cbc:CityName>`);
  out.push(`                <cbc:PostalZone>${esc(a.postal)}</cbc:PostalZone>`);
  out.push('                <cac:Country>');
  out.push('                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>');
  out.push('                </cac:Country>');
  out.push('            </cac:PostalAddress>');
  out.push('            <cac:PartyTaxScheme>');
  out.push(`                <cbc:CompanyID>${esc(inv.seller.vatNumber)}</cbc:CompanyID>`);
  out.push('                <cac:TaxScheme>');
  out.push('                    <cbc:ID>VAT</cbc:ID>');
  out.push('                </cac:TaxScheme>');
  out.push('            </cac:PartyTaxScheme>');
  out.push('            <cac:PartyLegalEntity>');
  out.push(`                <cbc:RegistrationName>${esc(inv.seller.name)}</cbc:RegistrationName>`);
  out.push('            </cac:PartyLegalEntity>');
  out.push('        </cac:Party>');
  out.push('    </cac:AccountingSupplierParty>');
  out.push('    <cac:AccountingCustomerParty></cac:AccountingCustomerParty>');
  out.push('    <cac:PaymentMeans>');
  out.push(`        <cbc:PaymentMeansCode>${inv.paymentMeans}</cbc:PaymentMeansCode>`);
  if (isNote) out.push(`        <cbc:InstructionNote>${esc(inv.reason || 'استرجاع')}</cbc:InstructionNote>`);
  out.push('    </cac:PaymentMeans>');
  if (inv.discountEx > 0) {
    out.push('    <cac:AllowanceCharge>');
    out.push('        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>');
    out.push('        <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>');
    out.push(`        ${amt('Amount', inv.discountEx)}`);
    out.push('        <cac:TaxCategory>');
    out.push('            <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID>');
    out.push(`            <cbc:Percent>${r}</cbc:Percent>`);
    out.push('            <cac:TaxScheme>');
    out.push('                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>');
    out.push('            </cac:TaxScheme>');
    out.push('        </cac:TaxCategory>');
    out.push('    </cac:AllowanceCharge>');
  }
  out.push('    <cac:TaxTotal>');
  out.push(`        ${amt('TaxAmount', inv.vatAmount)}`);
  out.push('    </cac:TaxTotal>');
  out.push('    <cac:TaxTotal>');
  out.push(`        ${amt('TaxAmount', inv.vatAmount)}`);
  out.push('        <cac:TaxSubtotal>');
  out.push(`            ${amt('TaxableAmount', inv.totalEx)}`);
  out.push(`            ${amt('TaxAmount', inv.vatAmount)}`);
  out.push('            <cac:TaxCategory>');
  out.push('                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID>');
  out.push(`                <cbc:Percent>${r}</cbc:Percent>`);
  out.push('                <cac:TaxScheme>');
  out.push('                    <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>');
  out.push('                </cac:TaxScheme>');
  out.push('            </cac:TaxCategory>');
  out.push('        </cac:TaxSubtotal>');
  out.push('    </cac:TaxTotal>');
  out.push('    <cac:LegalMonetaryTotal>');
  out.push(`        ${amt('LineExtensionAmount', sumLines)}`);
  out.push(`        ${amt('TaxExclusiveAmount', inv.totalEx)}`);
  out.push(`        ${amt('TaxInclusiveAmount', inv.totalEx + inv.vatAmount)}`);
  out.push(`        ${amt('AllowanceTotalAmount', inv.discountEx)}`);
  out.push(`        ${amt('PrepaidAmount', 0)}`);
  if (Math.round(inv.rounding * 100) !== 0) out.push(`        ${amt('PayableRoundingAmount', inv.rounding)}`);
  out.push(`        ${amt('PayableAmount', inv.total)}`);
  out.push('    </cac:LegalMonetaryTotal>');
  inv.lines.forEach((l, i) => {
    out.push('    <cac:InvoiceLine>');
    out.push(`        <cbc:ID>${i + 1}</cbc:ID>`);
    out.push(`        <cbc:InvoicedQuantity unitCode="PCE">${l.qty}</cbc:InvoicedQuantity>`);
    out.push(`        ${amt('LineExtensionAmount', l.ex)}`);
    out.push('        <cac:TaxTotal>');
    out.push(`            ${amt('TaxAmount', l.vat)}`);
    out.push(`            ${amt('RoundingAmount', l.ex + l.vat)}`);
    out.push('        </cac:TaxTotal>');
    out.push('        <cac:Item>');
    out.push(`            <cbc:Name>${esc(l.name)}</cbc:Name>`);
    out.push('            <cac:ClassifiedTaxCategory>');
    out.push(taxCat('                '));
    out.push('            </cac:ClassifiedTaxCategory>');
    out.push('        </cac:Item>');
    out.push('        <cac:Price>');
    out.push(`            ${amt('PriceAmount', l.qty ? l.ex / l.qty : 0, price)}`);
    out.push('        </cac:Price>');
    out.push('    </cac:InvoiceLine>');
  });
  out.push('</Invoice>');
  return out.join('\n');
}

/** النص القانوني المجزّأ: من العنصر الجذر حتى نهايته، دون العناصر الثلاثة المستثناة */
export function pureInvoice(template: string): string {
  const body = template.slice(template.indexOf('<Invoice'));
  return body.replace(UBL_EXT, '').replace(QR_REF, '').replace(SIG_REF, '');
}

export const invoiceHash = (template: string) => createHash('sha256').update(pureInvoice(template), 'utf8').digest('base64');

// ─────────── الشهادة ───────────

export interface CertInfo { body: string; hash: string; issuer: string; serial: string; publicKey: Buffer; signature: Buffer }

export function certBody(cert: string): string {
  return cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

export function certInfo(cert: string): CertInfo {
  const body = certBody(cert);
  const pem = `-----BEGIN CERTIFICATE-----\n${body.replace(/.{64}/g, '$&\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----`;
  const x = new X509Certificate(pem);
  const der = Buffer.from(body, 'base64');
  const sigBits = children(read(der))[2];
  return {
    body,
    // الهيئة تجزّئ نص الشهادة بترميز base64، ثم ترمّز الناتج الست عشري بـ base64
    hash: Buffer.from(createHash('sha256').update(body).digest('hex')).toString('base64'),
    issuer: x.issuer.split('\n').reverse().join(', '),
    serial: BigInt('0x' + x.serialNumber).toString(10),
    publicKey: x.publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    signature: sigBits.body.subarray(1),
  };
}

// ─────────── التوقيع ───────────

const SIGNED_PROPS_FOR_HASH = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>SET_SIGN_TIMESTAMP</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_HASH</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_ISSUER</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_SERIAL_NUMBER</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;

const SIGNED_PROPS_IN_DOC = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>SET_SIGN_TIMESTAMP</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                                    <ds:DigestValue>SET_CERTIFICATE_HASH</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName>SET_CERTIFICATE_ISSUER</ds:X509IssuerName>
                                                    <ds:X509SerialNumber>SET_CERTIFICATE_SERIAL_NUMBER</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;

function fillProps(t: string, ts: string, c: CertInfo): string {
  return t.replace('SET_SIGN_TIMESTAMP', ts).replace('SET_CERTIFICATE_HASH', c.hash)
    .replace('SET_CERTIFICATE_ISSUER', esc(c.issuer)).replace('SET_CERTIFICATE_SERIAL_NUMBER', c.serial);
}

export function signedPropertiesHash(ts: string, c: CertInfo): string {
  const hex = createHash('sha256').update(fillProps(SIGNED_PROPS_FOR_HASH, ts, c), 'utf8').digest('hex');
  return Buffer.from(hex).toString('base64');
}

function ublExtension(hash: string, propsHash: string, signature: string, c: CertInfo, ts: string): string {
  return `<ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>
                <sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">
                    <sac:SignatureInformation>
                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
                            <ds:SignedInfo>
                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>
                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>
                                <ds:Reference Id="invoiceSignedData" URI="">
                                    <ds:Transforms>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>
                                    </ds:Transforms>
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                    <ds:DigestValue>${hash}</ds:DigestValue>
                                </ds:Reference>
                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                    <ds:DigestValue>${propsHash}</ds:DigestValue>
                                </ds:Reference>
                            </ds:SignedInfo>
                            <ds:SignatureValue>${signature}</ds:SignatureValue>
                            <ds:KeyInfo>
                                <ds:X509Data>
                                    <ds:X509Certificate>${c.body}</ds:X509Certificate>
                                </ds:X509Data>
                            </ds:KeyInfo>
                            <ds:Object>
                            <xades:QualifyingProperties Target="signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
                                ${fillProps(SIGNED_PROPS_IN_DOC, ts, c)}
                            </xades:QualifyingProperties>
                            </ds:Object>
                        </ds:Signature>
                    </sac:SignatureInformation>
                </sig:UBLDocumentSignatures>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`;
}

// ─────────── رمز QR ───────────

export function tlv(values: (string | Buffer)[]): Buffer {
  return Buffer.concat(values.map((v, i) => {
    const b = typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
    if (b.length > 255) throw new Error('QR_TAG_TOO_LONG');
    return Buffer.concat([Buffer.from([i + 1, b.length]), b]);
  }));
}

export function decodeTlv(b64: string): Buffer[] {
  const b = Buffer.from(b64, 'base64');
  const out: Buffer[] = [];
  for (let i = 0; i < b.length;) {
    const len = b[i + 1];
    out.push(b.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

export interface Signed { xml: string; hash: string; qr: string; signature: string; signedPropertiesHash: string; timestamp: string }

/** يوقّع الفاتورة بمفتاح الجهاز وشهادته، ويعيد XML النهائي والتجزئة ورمز QR */
export function signInvoice(inv: ZatcaInvoice, certificate: string, privateKeyPem: string, signingTime = new Date()): Signed {
  const template = invoiceTemplate(inv);
  const hash = invoiceHash(template);
  const c = certInfo(certificate);

  const signer = createSign('sha256');
  signer.update(Buffer.from(hash, 'base64'));
  const signature = signer.sign(privateKeyPem).toString('base64');

  const ts = signingTime.toISOString().slice(0, 19) + 'Z';
  const propsHash = signedPropertiesHash(ts, c);

  const { date, time } = riyadhParts(inv.issuedAt);
  const qr = tlv([
    inv.seller.name,
    inv.seller.vatNumber,
    `${date}T${time}Z`,
    money(inv.totalEx + inv.vatAmount),
    money(inv.vatAmount),
    hash,
    signature,
    c.publicKey,
    c.signature,
  ]).toString('base64');

  const qrRef = `<cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>`;
  const sigRef = `<cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>`;

  const xml = template
    .replace(UBL_EXT, ublExtension(hash, propsHash, signature, c, ts))
    .replace(QR_REF, qrRef)
    .replace(SIG_REF, sigRef);
  return { xml, hash, qr, signature, signedPropertiesHash: propsHash, timestamp: ts };
}

/** يتحقق محلياً من توقيع الفاتورة بالمفتاح العام للشهادة */
export function verifySignature(hash: string, signature: string, certificate: string): boolean {
  const v = createVerify('sha256');
  v.update(Buffer.from(hash, 'base64'));
  const pem = `-----BEGIN CERTIFICATE-----\n${certBody(certificate)}\n-----END CERTIFICATE-----`;
  return v.verify(new X509Certificate(pem).publicKey, Buffer.from(signature, 'base64'));
}

/** قيمة PIH الأولى: تجزئة SHA-256 للرقم 0 بترميز base64 للنص الست عشري */
export const INITIAL_PIH = Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64');
