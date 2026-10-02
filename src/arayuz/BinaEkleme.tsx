import { useEffect, useRef, useState } from 'react';
import { tamSayiOku } from '../hesap/sayi';
import { blokEkle, katEkle, type KatGirdisi } from '../servisler/bina';
import { blokGirdisiCikar, type ProjeYapisi } from '../servisler/proje';
import type { Blok } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { BlokAlanlari, blokFormu, blokFormunaCevir, blokGirdisi, type BlokFormu } from './BlokFormu';
import { gorunurYap } from './Kroki';

// Var olan projeye sonradan blok ve bloğa kat ekleme. Mevcut bölüm numaraları değişmez.

export function KatEkleFormu(props: { blok: Blok; onEklendi: (mesaj: string) => Promise<void>; onVazgec: () => void }) {
  const { depo, servis } = useUygulama();
  const [tur, setTur] = useState<KatGirdisi['tur']>('normal');
  const [sayi, setSayi] = useState('');
  const [tip, setTip] = useState<KatGirdisi['bolumTipi']>('dukkan');
  const [kopyala, setKopyala] = useState(true);
  const [hatalar, setHatalar] = useState<string[]>([]);

  async function ekle() {
    const bolumSayisi = sayi.trim() === '' ? Number.NaN : (tamSayiOku(sayi) ?? Number.NaN);
    try {
      const kat = await katEkle(depo, servis, props.blok.id, {
        tur,
        bolumSayisi,
        bolumTipi: tur === 'bodrum' ? tip : 'daire',
        ozellikleriKopyala: kopyala,
      });
      await props.onEklendi(`${props.blok.ad} Blok'a ${kat.ad} eklendi.`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <div className="kalem-formu">
      <div className="iki-sutun">
        <Alan etiket="Nereye">
          <select value={tur} onChange={(e) => setTur(e.target.value as KatGirdisi['tur'])}>
            <option value="normal">Üste normal kat</option>
            <option value="cati">Çatı katı</option>
            <option value="bodrum">Alta bodrum</option>
          </select>
        </Alan>
        <Alan etiket={tur === 'bodrum' ? 'Bölüm sayısı' : 'Daire sayısı'}>
          <input value={sayi} inputMode="numeric" onChange={(e) => setSayi(e.target.value)} />
        </Alan>
      </div>
      {tur === 'bodrum' && (
        <Alan etiket="Bölümler" aciklama="Satılacak bölüm yoksa 0 yazın; otopark ve sığınak ortak alandır.">
          <select value={tip} onChange={(e) => setTip(e.target.value as KatGirdisi['bolumTipi'])}>
            <option value="dukkan">Dükkan / depo</option>
            <option value="daire">Daire</option>
          </select>
        </Alan>
      )}
      {tur === 'normal' && (
        <label className="onay-kutusu">
          <input type="checkbox" checked={kopyala} onChange={(e) => setKopyala(e.target.checked)} />
          <span>Alttaki katın daire özellikleri (oda tipi, m², cephe) aynı hatta kopyalansın</span>
        </label>
      )}
      <p className="soluk kucuk">Var olan numaralar değişmez; yeni bölümler bloktaki son numaradan devam eder.</p>
      <Hatalar hatalar={hatalar} />
      <div className="dugmeler">
        <button type="button" onClick={() => void ekle()}>
          Kat ekle
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

const BLOK_HARFLERI = 'ABCDEFGHIJKLMNOPRSTUVYZ';

export function BlokEkleFormu(props: { yapi: ProjeYapisi; onEklendi: (mesaj: string) => Promise<void>; onVazgec: () => void }) {
  const { depo, servis } = useUygulama();
  const mevcut = props.yapi.bloklar;
  const [form, setForm] = useState<BlokFormu>(() => {
    const kullanilan = new Set(mevcut.map((b) => b.blok.ad.toLocaleUpperCase('tr-TR')));
    return blokFormu([...BLOK_HARFLERI].find((h) => !kullanilan.has(h)) ?? '');
  });
  const [kaynakId, setKaynakId] = useState('');
  const [ozellikKopyala, setOzellikKopyala] = useState(true);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);
  const kutuRef = useRef<HTMLDivElement>(null);
  useEffect(() => gorunurYap(kutuRef.current), []);

  function kaynakSec(id: string) {
    setKaynakId(id);
    const k = mevcut.find((b) => b.blok.id === id);
    if (k) setForm({ ...blokFormunaCevir(blokGirdisiCikar(k)), ad: form.ad });
  }

  async function ekle() {
    setIslemde(true);
    try {
      const blok = await blokEkle(depo, servis, props.yapi.proje.id, blokGirdisi(form), kaynakId && ozellikKopyala ? kaynakId : null);
      await props.onEklendi(`${blok.ad} Blok eklendi.`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  return (
    <div ref={kutuRef} className="kalem-formu">
      <h3>Blok ekle</h3>
      <Alan etiket="Şu blokla aynı olsun" aciklama="Kat ve daire sayıları ile bina özellikleri kopyalanır; sonra değiştirebilirsiniz.">
        <select value={kaynakId} onChange={(e) => kaynakSec(e.target.value)}>
          <option value="">Seçin</option>
          {mevcut.map((b) => (
            <option key={b.blok.id} value={b.blok.id}>
              {b.blok.ad} Blok
            </option>
          ))}
        </select>
      </Alan>
      {kaynakId && (
        <label className="onay-kutusu">
          <input type="checkbox" checked={ozellikKopyala} onChange={(e) => setOzellikKopyala(e.target.checked)} />
          <span>Daire özellikleri de (oda tipi, m², cephe, eklentiler) kat ve hat sırasıyla kopyalansın</span>
        </label>
      )}
      <BlokAlanlari form={form} onDegisti={setForm} />
      <Hatalar hatalar={hatalar} />
      <div className="dugmeler">
        <button type="button" onClick={() => void ekle()} disabled={islemde}>
          {islemde ? 'Ekleniyor…' : 'Bloğu ekle'}
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec} disabled={islemde}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
