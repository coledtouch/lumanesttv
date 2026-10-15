(() => {
  if (!window.isSecureContext || document.getElementById('lumanest-install')) return;
  if (!['lumanest.tv', 'portal.lumanest.tv', 'tv.lumanest.tv', 'localhost', '127.0.0.1'].includes(location.hostname)) return;
  if (location.pathname.startsWith('/manage') || location.pathname.startsWith('/api/')) return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => {});
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installed = standalone();
  if (standalone()) return;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/pwa-install.css';
  document.head.appendChild(style);
  const wrapper = document.createElement('div'); wrapper.id = 'lumanest-install';
  const panel = document.createElement('section'); panel.id = 'lumanest-install-dialog'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'lumanest-install-title');
  const heading = document.createElement('h2'); heading.id = 'lumanest-install-title'; heading.textContent = 'LumaNest, one tap away';
  const instructions = document.createElement('p');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Got it';
  panel.append(heading, instructions, close);
  const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', panel.id);
  button.textContent = '↓ Install app'; wrapper.append(panel, button);
  const header = document.querySelector('header');
  if (header) header.insertAdjacentElement('afterend', wrapper);
  else document.body.prepend(wrapper);
  let prompt = null;
  const hideHelp = () => {panel.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus();};
  close.addEventListener('click', hideHelp);
  wrapper.addEventListener('keydown', event => {if (event.key === 'Escape') hideHelp();});
  window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); prompt = event;});
  window.addEventListener('appinstalled', () => {installed = true; prompt = null; wrapper.hidden = true;});
  document.addEventListener('fullscreenchange', () => {wrapper.hidden = Boolean(document.fullscreenElement) || standalone() || installed;});
  button.addEventListener('click', async () => {
    if (prompt) {
      const pending = prompt; prompt = null; button.disabled = true;
      try {await pending.prompt(); const choice = await pending.userChoice; if (choice.outcome === 'accepted') {installed = true; wrapper.hidden = true;}} catch {} finally {button.disabled = false;}
      return;
    }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    instructions.textContent = ios ? 'In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App if shown, and tap Add.' : 'Open your browser menu and choose Install LumaNest TV, Install app, or Add to Home Screen. On Mac, Safari also offers File → Add to Dock. If your browser has no install option, use Chrome, Edge, or Safari.';
    panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) close.focus();
  });
})();
