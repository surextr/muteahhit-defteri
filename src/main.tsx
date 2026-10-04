import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { HataSiniri } from './arayuz/HataSiniri';
import { onayDonusunuIsle } from './bulut/yapayZeka';
import './stil.css';

// E-posta onay bağlantısından dönüldüyse adres sayfa yönlendirmesini bozmasın.
onayDonusunuIsle();

createRoot(document.getElementById('kok')!).render(
  <StrictMode>
    <HataSiniri>
      <App />
    </HataSiniri>
  </StrictMode>,
);
