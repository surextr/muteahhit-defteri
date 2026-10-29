import { describe, expect, it } from 'vitest';
import { karekodCoz, tarihOku, tevkifatOrani, tutarliMi, tutarOku, ublCoz, xmlOku } from './eFatura';

describe('karekod', () => {
  it('GİB e-Arşiv karekodunu okur', () => {
    const t = karekodCoz(
      JSON.stringify({
        vkntckn: '1234567890',
        avkntckn: '9876543210',
        senaryo: 'EARSIVFATURA',
        tip: 'SATIS',
        tarih: '2026-10-15',
        no: 'ABC2026000000123',
        ettn: 'aaaa-bbbb',
        parabirimi: 'TRY',
        malhizmettoplam: '1100',
        'kdvmatrah(20)': '1000',
        'hesaplanankdv(20)': '200',
        'kdvmatrah(10)': '100.00',
        'hesaplanankdv(10)': '10.00',
        vergidahil: '1310',
        odenecek: '1310',
      }),
    );
    expect(t).toMatchObject({
      kaynak: 'karekod',
      satici: { vergiNo: '1234567890' },
      aliciVergiNo: '9876543210',
      faturaNo: 'ABC2026000000123',
      tarih: '2026-10-15',
      iade: false,
      kdvler: [
        { oran: 20, matrah: 100000, kdv: 20000 },
        { oran: 10, matrah: 10000, kdv: 1000 },
      ],
      tevkifat: 0,
      odenecek: 131000,
    });
    expect(tutarliMi(t!)).toBeNull();
  });

  it('tevkifatlı, iade ve gün-ay-yıl tarihli karekod', () => {
    const t = karekodCoz('{"VKNTCKN":"11111111111","TIP":"IADE","TARIH":"05.03.2026","NO":"X1","KDVMATRAH(20)":"1.000,00","HESAPLANANKDV(20)":"200,00","HESAPLANANKDVTEVKIFAT(20)":"140,00","ODENECEK":"1.060,00"}');
    expect(t).toMatchObject({ iade: true, tarih: '2026-03-05', tevkifat: 14000, odenecek: 106000 });
    expect(tevkifatOrani(14000, 20000)).toEqual({ pay: 7, payda: 10 });
    expect(tutarliMi(t!)).toBeNull();
    expect(tutarliMi({ ...t!, odenecek: 200000 })).toContain('tutmuyor');
  });

  it('fatura olmayan karekod okunmaz', () => {
    expect(karekodCoz('https://ornek.com')).toBeNull();
    expect(karekodCoz('{"a":1}')).toBeNull();
  });
});

describe('yardımcılar', () => {
  it('tutar ve tarih', () => {
    expect(tutarOku('1.234,56')).toBe(123456);
    expect(tutarOku('1,234.56')).toBe(123456);
    expect(tutarOku('850')).toBe(85000);
    expect(tutarOku('abc')).toBeNull();
    expect(tarihOku('2026-01-02T10:00')).toBe('2026-01-02');
    expect(tarihOku('2/1/2026')).toBe('2026-01-02');
    expect(tevkifatOrani(10000, 20000)).toEqual({ pay: 5, payda: 10 });
    expect(tevkifatOrani(1234, 20000)).toBeNull();
  });

  it('xml: ad alanı, öznitelik, CDATA, bozuk belge', () => {
    const k = xmlOku('<?xml version="1.0"?><a:x xmlns:a="u"><a:y z="1 &gt; 0">A &amp; B</a:y><w/><![CDATA[<c>]]></a:x>');
    expect(k).toMatchObject({ ad: 'x', metin: '<c>', cocuklar: [{ ad: 'y', oz: { z: '1 > 0' }, metin: 'A & B' }, { ad: 'w' }] });
    expect(xmlOku('<a><b></a>')).toBeNull();
  });
});

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>DMR2026000000045</cbc:ID>
  <cbc:UUID>1f0e-77</cbc:UUID>
  <cbc:IssueDate>2026-10-20</cbc:IssueDate>
  <cbc:InvoiceTypeCode>TEVKIFAT</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
    <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0123</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Korkuteli Demir Ltd. Şti.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Sanayi Cad.</cbc:StreetName><cbc:BuildingNumber>5</cbc:BuildingNumber><cbc:CitySubdivisionName>Korkuteli</cbc:CitySubdivisionName><cbc:CityName>Antalya</cbc:CityName></cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Korkuteli</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:Contact><cbc:Telephone>0242 111 22 33</cbc:Telephone></cac:Contact>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">9876543210</cbc:ID></cac:PartyIdentification>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">2000.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">10000.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">2000.00</cbc:TaxAmount><cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">1400.00</cbc:TaxAmount></cac:WithholdingTaxTotal>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="TRY">10600.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="TNE">0.5</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">10000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal><cbc:Percent>20</cbc:Percent></cac:TaxSubtotal></cac:TaxTotal>
    <cac:WithholdingTaxTotal><cac:TaxSubtotal><cbc:Percent>70</cbc:Percent></cac:TaxSubtotal></cac:WithholdingTaxTotal>
    <cac:Item><cbc:Name>Nervürlü demir Ø12</cbc:Name></cac:Item>
  </cac:InvoiceLine>
</Invoice>`;

describe('UBL', () => {
  it('satıcı, satırlar, KDV ve tevkifat okunur', () => {
    const t = ublCoz(UBL);
    expect(t).toMatchObject({
      kaynak: 'xml',
      satici: {
        vergiNo: '1234567890',
        ad: 'Korkuteli Demir Ltd. Şti.',
        adres: 'Sanayi Cad. No: 5 Korkuteli Antalya',
        telefon: '0242 111 22 33',
        vergiDairesi: 'Korkuteli',
      },
      aliciVergiNo: '9876543210',
      faturaNo: 'DMR2026000000045',
      tarih: '2026-10-20',
      iade: false,
      kdvler: [{ oran: 20, matrah: 1000000, kdv: 200000 }],
      tevkifat: 140000,
      odenecek: 1060000,
      satirlar: [{ ad: 'Nervürlü demir Ø12', miktar: 0.5, birim: 'TNE', tutar: 1000000, kdvOrani: 20, tevkifat: { pay: 7, payda: 10 } }],
    });
    expect(tutarliMi(t!)).toBeNull();
  });

  it('fatura olmayan XML okunmaz', () => {
    expect(ublCoz('<DespatchAdvice><ID>1</ID></DespatchAdvice>')).toBeNull();
    expect(ublCoz('bozuk')).toBeNull();
  });
});
