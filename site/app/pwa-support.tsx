'use client';

import {useEffect} from 'react';

export default function PwaSupport() {
  useEffect(() => {
    if (document.getElementById('lumanest-pwa-script')) return;
    const script = document.createElement('script');
    script.id = 'lumanest-pwa-script'; script.src = '/pwa-install.js'; script.defer = true;
    document.body.appendChild(script);
  }, []);
  return null;
}
