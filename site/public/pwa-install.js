(() => {
  if (!window.isSecureContext || document.getElementById('lumanest-install')) return;
  if (!['lumanest.tv', 'portal.lumanest.tv', 'tv.lumanest.tv', 'localhost', '127.0.0.1'].includes(location.hostname)) return;
  if (location.pathname.startsWith('/manage') || location.pathname.startsWith('/api/')) return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => {});
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installed = standalone();
  if (standalone() || location.pathname.startsWith('/checkout') || location.pathname.startsWith('/renew/return') || location.pathname.startsWith('/renew/cancel')) return;
  const DISMISSED = 'lumanest-install-dismissed', VIEWS = 'lumanest-install-views';
  let dismissed = false, views = 0;
  try {dismissed = localStorage.getItem(DISMISSED) === '1';} catch {}
  if (dismissed) return;
  try {views = (Number(localStorage.getItem(VIEWS)) || 0) + 1; localStorage.setItem(VIEWS, String(views));} catch {}
  // Narrow screens get a small bottom banner from the second page view; wider screens only use a header slot the page offers.
  const banner = window.matchMedia('(max-width: 700px)').matches;
  const slot = banner ? null : document.querySelector('[data-pwa-install-slot]');
  if (banner ? views < 2 : !slot) return;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/pwa-install.css';
  document.head.appendChild(style);
  const wrapper = document.createElement('div'); wrapper.id = 'lumanest-install'; wrapper.className = banner ? 'lumanest-install-banner' : 'lumanest-install-inline';
  const panel = document.createElement('section'); panel.id = 'lumanest-install-dialog'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'lumanest-install-title');
  const heading = document.createElement('h2'); heading.id = 'lumanest-install-title'; heading.textContent = 'LumaNest, one tap away';
  const instructions = document.createElement('p');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Got it';
  panel.append(heading, instructions, close);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'lumanest-install-button'; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', panel.id);
  button.textContent = banner ? 'Install' : 'Install app';
  if (banner) {
    wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'Install LumaNest');
    const message = document.createElement('p'); message.className = 'lumanest-install-text'; message.textContent = 'Add LumaNest to your home screen';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'lumanest-install-dismiss'; dismiss.setAttribute('aria-label', 'Hide install banner'); dismiss.textContent = '×';
    dismiss.addEventListener('click', () => {dismissed = true; setHidden(true); try {localStorage.setItem(DISMISSED, '1');} catch {}});
    wrapper.append(panel, message, button, dismiss);
    document.body.appendChild(wrapper);
  } else {
    wrapper.append(panel, button);
    slot.appendChild(wrapper);
  }
  const root = document.documentElement;
  function setHidden(value) {
    wrapper.hidden = value;
    if (!banner) return;
    root?.classList?.toggle('lumanest-install-open', !value);
    // Match the space reserved under the page to the last footer, so it never shows as a contrasting strip.
    const footers = document.querySelectorAll?.('footer');
    const last = footers && footers[footers.length - 1];
    try {root?.style?.setProperty('--lumanest-install-fill', last ? getComputedStyle(last).backgroundColor : 'transparent');} catch {}
  }
  setHidden(false);
  let prompt = null;
  const hideHelp = () => {panel.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus();};
  close.addEventListener('click', hideHelp);
  wrapper.addEventListener('keydown', event => {if (event.key === 'Escape') hideHelp();});
  window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); prompt = event;});
  window.addEventListener('appinstalled', () => {installed = true; prompt = null; setHidden(true);});
  document.addEventListener('fullscreenchange', () => {setHidden(Boolean(document.fullscreenElement) || standalone() || installed || dismissed);});
  button.addEventListener('click', async () => {
    if (prompt) {
      const pending = prompt; prompt = null; button.disabled = true;
      try {await pending.prompt(); const choice = await pending.userChoice; if (choice.outcome === 'accepted') {installed = true; setHidden(true);}} catch {} finally {button.disabled = false;}
      return;
    }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    instructions.textContent = ios ? 'In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App if shown, and tap Add.' : 'Open your browser menu and choose Install LumaNest TV, Install app, or Add to Home Screen. On Mac, Safari also offers File → Add to Dock. If your browser has no install option, use Chrome, Edge, or Safari.';
    panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) close.focus();
  });
})();
