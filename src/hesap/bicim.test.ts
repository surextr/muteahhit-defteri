import { describe, expect, it } from 'vitest';
import { ibanBicim, telBicim, tutarBicim, tutarBitir } from './bicim';
import { tlOku } from './para';

describe('tutar', () => {
  it.each([
    ['1250000', '1.250.000'],
    ['1250000,5', '1.250.000,5'],
    ['1.250.000,567', '1.250.000,56'],
    ['0012', '12'],
    [',5', '0,5'],
    ['12a3', '123'],
    ['-500', '500'],
  ])('%s → %s', (girdi, cikti) => expect(tutarBicim(girdi)).toBe(cikti));

  it('eksi tutar istenirse korunur', () => {
    expect(tutarBicim('-12500', true)).toBe('-12.500');
  });

  it('bitirince kuruş tamamlanır; sonuç tlOku ile okunur', () => {
    expect(tutarBitir('12,5')).toBe('12,50');
    expect(tutarBitir('12,')).toBe('12');
    expect(tutarBitir('-')).toBe('');
    expect(tlOku(tutarBitir('1250000,5'))).toBe(125_000_050);
  });
});

describe('telefon', () => {
  it.each([
    ['05321112233', '0 532 111 22 33'],
    ['5321112233', '0 532 111 22 33'],
    ['+90 532 111 22 33', '0 532 111 22 33'],
    ['0 (242) 123 45 67', '0 242 123 45 67'],
    ['444 1 234', '444 1 234'],
    ['', ''],
  ])('%s → %s', (girdi, cikti) => expect(telBicim(girdi)).toBe(cikti));
});

describe('IBAN', () => {
  it.each([
    ['330006100519786457841326', 'TR33 0006 1005 1978 6457 8413 26'],
    ['TR330006100519786457841326', 'TR33 0006 1005 1978 6457 8413 26'],
    ['tr33 0006 1005 1978 6457 8413 26', 'TR33 0006 1005 1978 6457 8413 26'],
    ['TRTR33', 'TR33'],
    ['TR33000610051978645784132699', 'TR33 0006 1005 1978 6457 8413 26'],
    ['3', 'TR3'],
    ['T', 'TR'],
    ['', ''],
  ])('%s → %s', (girdi, cikti) => expect(ibanBicim(girdi)).toBe(cikti));

  it('TR dahil 26 karakteri geçmez', () => {
    expect(ibanBicim('9'.repeat(40)).replace(/\s/g, '')).toHaveLength(26);
  });
});
