import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { ibanBicim, telBicim, tutarBicim, tutarBitir } from '../hesap/bicim';

// Biçimli giriş alanları: tutar, telefon, IBAN. Bütün ekranlar bunları kullanır; biçim tek yerde.

type GirdiOzellikleri = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>;

interface BicimliOzellikler extends GirdiOzellikleri {
  value: string;
  onChange: (deger: string) => void;
}

/**
 * Yazarken biçimlenen alan. İmleç, "anlamlı" karakter (rakam, virgül…) sayısına göre korunur;
 * ayırıcı (nokta, boşluk) silinmek istenirse önündeki anlamlı karakter silinir, imleç takılmaz.
 */
function BicimliGirdi(props: BicimliOzellikler & { bicimle: (m: string) => string; anlamli: RegExp; tip: string; mod: InputHTMLAttributes<HTMLInputElement>['inputMode'] }) {
  const { value, onChange, bicimle, anlamli, tip, mod, ...geri } = props;
  const ref = useRef<HTMLInputElement>(null);
  const imlec = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (imlec.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(imlec.current, imlec.current);
    }
    imlec.current = null;
  }, [value]);

  return (
    <input
      {...geri}
      ref={ref}
      type={tip}
      inputMode={mod}
      value={value}
      onChange={(e) => {
        let ham = e.target.value;
        let konum = e.target.selectionStart ?? ham.length;
        const silme = (e.nativeEvent as InputEvent).inputType === 'deleteContentBackward';
        // Yalnızca bir ayırıcı silindiyse, ondan önceki anlamlı karakteri sil.
        if (silme && ham.length === value.length - 1) {
          const silinen = value[konum];
          if (silinen !== undefined && !anlamli.test(silinen) && konum > 0) {
            ham = ham.slice(0, konum - 1) + ham.slice(konum);
            konum -= 1;
          }
        }
        const once = [...ham.slice(0, konum)].filter((h) => anlamli.test(h)).length;
        const yeni = bicimle(ham);
        let p = 0;
        for (let n = 0; p < yeni.length && n < once; p++) if (anlamli.test(yeni[p]!)) n++;
        imlec.current = p;
        onChange(yeni);
      }}
    />
  );
}

/** Tutar: nokta binlik, virgül kuruş; alandan çıkınca kuruş tamamlanır. Değer tlOku ile okunur. */
export function TutarGirdisi({ eksiOlabilir = false, onBlur, ...p }: BicimliOzellikler & { eksiOlabilir?: boolean }) {
  return (
    <BicimliGirdi
      {...p}
      tip="text"
      mod="decimal"
      anlamli={eksiOlabilir ? /[\d,-]/ : /[\d,]/}
      bicimle={(m) => tutarBicim(m, eksiOlabilir)}
      onBlur={(e) => {
        const bitmis = tutarBitir(p.value, eksiOlabilir);
        if (bitmis !== p.value) p.onChange(bitmis);
        onBlur?.(e);
      }}
    />
  );
}

/** Telefon: alandan çıkınca "0 532 111 22 33". */
export function TelefonGirdisi({ onBlur, ...p }: BicimliOzellikler) {
  return (
    <input
      {...p}
      type="tel"
      inputMode="tel"
      onChange={(e) => p.onChange(e.target.value)}
      onBlur={(e) => {
        const b = telBicim(p.value);
        if (b !== p.value) p.onChange(b);
        onBlur?.(e);
      }}
    />
  );
}

/** IBAN: "TR" kendiliğinden, dörderli gruplar, en çok 26 karakter. */
export function IbanGirdisi(p: BicimliOzellikler) {
  return (
    <BicimliGirdi
      {...p}
      tip="text"
      mod="numeric"
      anlamli={/\d/}
      bicimle={ibanBicim}
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      maxLength={32}
    />
  );
}
