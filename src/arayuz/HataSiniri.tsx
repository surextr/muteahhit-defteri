import { Component, type ErrorInfo, type ReactNode } from 'react';

// Bir ekran beklenmedik bir hatayla çökerse beyaz sayfa yerine açıklama ve "Yeniden yükle" gösterilir.
// Kayıtlar cihazda durduğu için yeniden yüklemek veri kaybettirmez.

export class HataSiniri extends Component<{ children: ReactNode }, { hata: Error | null }> {
  state: { hata: Error | null } = { hata: null };

  static getDerivedStateFromError(hata: Error) {
    return { hata };
  }

  componentDidCatch(hata: Error, bilgi: ErrorInfo) {
    console.error('Ekran çöktü:', hata, bilgi.componentStack);
  }

  render() {
    if (!this.state.hata) return this.props.children;
    return (
      <main className="sayfa" role="alert">
        <section className="kart">
          <h1>Bir şeyler ters gitti</h1>
          <p>Bu ekran beklenmedik bir hatayla kapandı. Kayıtlarınız cihazda duruyor; sayfayı yeniden yükleyip devam edebilirsiniz.</p>
          <p className="soluk kucuk">Ayrıntı: {this.state.hata.message || 'bilinmeyen hata'}</p>
          <div className="dugmeler">
            <button type="button" onClick={() => window.location.reload()}>
              Yeniden yükle
            </button>
            <button
              type="button"
              className="ikincil"
              onClick={() => {
                window.location.hash = '#/projeler';
                window.location.reload();
              }}
            >
              Ana ekrana dön
            </button>
          </div>
        </section>
      </main>
    );
  }
}
