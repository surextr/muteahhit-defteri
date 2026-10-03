import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { onayDonusunuIsle } from './bulut/yapayZeka';
import './stil.css';

// E-posta onay bağlantısından dönüldüyse adres sayfa yönlendirmesini bozmasın.
onayDonusunuIsle();

createRoot(document.getElementById('kok')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
