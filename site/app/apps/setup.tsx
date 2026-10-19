'use client';

import {useEffect, useRef, useState} from 'react';
import {tuner} from '../../lib/tuner';

const devices = [
  ['android', 'Android / Google TV', 'Google TV, Android TV and Fire TV'],
  ['samsung', 'Samsung TV', 'App temporarily unavailable. Try the web player in your TV’s browser.'],
  ['lg', 'LG TV', 'webOS · Install from a computer, with guided steps'],
  ['roku', 'Roku', 'Roku TV and players · Install from a computer, with guided steps'],
  ['browser', 'Computer / browser', 'Watch in your browser. No installation needed.'],
];

const roku = {version: '1.0.2', file: '/downloads/tuner-roku-1.0.2.zip'};

const glyph = {fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round'} as const;
function DeviceGlyph({id}: {id: string}) {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...glyph}>{id === 'android'
    ? <><rect x="2.5" y="8.5" width="14" height="7" rx="2"/><path d="M16.5 10.5h3.5v3h-3.5M6 12h.01"/></>
    : id === 'browser' ? <><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01"/></>
    : <><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>}</svg>;
}

function detectDevice() {
  const agent = navigator.userAgent;
  if (/Tizen/i.test(agent)) return 'samsung';
  if (/Web0S|webOS/i.test(agent)) return 'lg';
  if (/Android|AFT/.test(agent)) return 'android';
  return 'browser';
}

export default function Setup({portal, support}: {portal: string; support: string}) {
  const [device, setDevice] = useState('browser');
  const [suggested, setSuggested] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const moveToInstructions = useRef(false);

  useEffect(() => {
    function readHash() {
      const id = window.location.hash.slice(1);
      if (devices.some(item => item[0] === id)) {setDevice(id); setSuggested(false);}
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the device comes from location.hash or the user agent, which only exist after hydration
    if (!devices.some(item => item[0] === window.location.hash.slice(1))) {setDevice(detectDevice()); setSuggested(true);}
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  useEffect(() => {
    if (!moveToInstructions.current) return;
    moveToInstructions.current = false;
    headingRef.current?.focus({preventScroll: true});
    headingRef.current?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
  }, [device]);

  function chooseDevice(id: string) {
    if (id === device) {
      headingRef.current?.focus({preventScroll: true});
      headingRef.current?.scrollIntoView({block: 'start'});
      return;
    }
    moveToInstructions.current = true;
    setDevice(id); setSuggested(false);
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + id);
  }

  const deviceName = devices.find(item => item[0] === device)?.[1];
  return <>
    <div className="device-grid" ref={pickerRef} role="group" aria-label="Choose your device">{devices.map(([id, title, description]) => <button type="button" className={'device-card' + (device === id ? ' active' : '') + (id === 'samsung' ? ' soon' : '')} key={id} aria-pressed={device === id} aria-controls="setup-instructions" onClick={() => chooseDevice(id)}><span aria-hidden="true"><DeviceGlyph id={id}/></span><strong>{title}{id === 'samsung' && <em className="device-soon">Temporarily unavailable</em>}</strong><small>{description}</small></button>)}</div>
    {suggested && <p className="setup-suggested">We picked <strong>{deviceName}</strong> based on this device. Choose another any time.</p>}
    <p className="sr-only" role="status">{device ? deviceName + ' instructions are ready below.' : 'Choose your device to see its setup instructions.'}</p>
    {device ? <section id="setup-instructions" className="setup-panel" aria-labelledby="setup-title">
      <div className="setup-panel-heading"><p className="eyebrow">SETUP FOR {deviceName?.toUpperCase()}</p><button type="button" className="setup-change-device" onClick={() => {const active = pickerRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]'); active?.focus(); pickerRef.current?.scrollIntoView({block: 'center'});}}>Change device ↑</button></div>
      {device === 'browser' ? <><h2 id="setup-title" ref={headingRef} tabIndex={-1}>Sign in. Start watching.</h2><p>Use the <strong>line username and line password</strong> from your customer hub’s TV/app setup details. These can be different from your email account login.</p><a className="button primary" href="/watch">Open the web player <span aria-hidden="true">↗</span></a>{portal && <p><a className="setup-inline-link" href={portal}>Find my line login in the customer hub <span aria-hidden="true">↗</span></a></p>}</> : device === 'samsung' ? <>
        <h2 id="setup-title" ref={headingRef} tabIndex={-1}>Samsung app temporarily unavailable.</h2>
        <p>The Tuner download for Samsung TVs is temporarily unavailable. <strong>In the meantime, try your TV’s web browser:</strong> open the web player and sign in with your line login. If it doesn’t play there, a computer or phone browser works too.</p>
        <p>Already use an IPTV player? Connect it with the server address and line login in your customer hub.</p>
        <div className="actions"><a className="button primary" href="/watch">Open the web player <span aria-hidden="true">↗</span></a>{portal && <a className="button secondary" href={portal}>Open my customer hub <span aria-hidden="true">↗</span></a>}</div>
        <p>Contact setup support for help choosing a way to watch on your TV.</p>
      </> : <>
        <h2 id="setup-title" ref={headingRef} tabIndex={-1}>Three steps to your TV.</h2>
        <ol className="setup-steps">
          <li><div><h3>Install Tuner</h3>{device === 'android' ? <><p>Download using Downloader on your TV, or send the file with Send Files to TV. Open the APK and follow the installation prompts.</p><a className="button primary" href={'/api/tuner?version=' + tuner.version} download>Download Android app <span aria-hidden="true">↓</span></a><small>Version {tuner.version} · Android 6.0+ · {(tuner.bytes / (1024 * 1024)).toFixed(1)} MB</small><p>If you installed an earlier Tuner build, add your playlist and line login again in this version.</p></> : device === 'roku' ? <><p>Turn on your Roku’s developer installer: on the Roku remote press <strong>Home ×3, Up ×2, Right, Left, Right, Left, Right</strong>, enable the installer and choose a web server password. The Roku restarts. Then, on a computer on the same Wi-Fi, open the address shown on the TV, sign in as <code>rokudev</code> with that password, upload the Tuner file and choose <strong>Install</strong>.</p><a className="button primary" href={roku.file} download>Download Roku app <span aria-hidden="true">↓</span></a><small>Version {roku.version} · Roku app ZIP · Developer installation</small></> : <><p>Install LG’s Developer Mode app from your TV’s app store. Sign in with your LG developer account and enable Dev Mode Status. Use a PC on the same network to install Tuner.</p><a className="button primary" href="/downloads/tv.lumanest.tuner_1.0.5_all.ipk" download>Download LG app <span aria-hidden="true">↓</span></a><small>Version 1.0.4 · webOS IPK · Developer installation</small></>}</div></li>
          <li><div><h3>Find your line login</h3><p>Open your subscription’s TV/app setup details in your customer hub. Use the <strong>line login</strong> shown there; your email account password can be different.</p>{portal ? <a className="button secondary" href={portal}>Open my customer hub <span aria-hidden="true">↗</span></a> : <a className="button secondary" href={'mailto:' + support}>Get help with my line login <span aria-hidden="true">↗</span></a>}</div></li>
          <li><div><h3>Pair with your phone</h3><p>Open Tuner. {device === 'android' || device === 'roku' ? 'The first screen shows a QR code.' : <>Choose <strong>Pair with your phone</strong> at the top of the screen.</>} Scan the code with your phone’s camera, sign in with your <strong>line login</strong> and tap <strong>Connect my TV</strong>. Tuner sets itself up and loads your channels. No typing with the remote.</p><p>No camera? Go to <a className="setup-inline-link" href="/pair">lumanest.tv/pair</a> and enter the 8-letter code from your TV. {device === 'roku' ? <>The Roku app sets up by pairing only, so there’s nothing to type with the remote.</> : <>Prefer to type it in? </>}{device === 'roku' ? null : device === 'android' ? <>Choose <strong>M3U URL</strong> and paste the playlist URL from your hub.</> : <>Enter the <strong>server address, line username and line password</strong> from your setup details, or use your M3U URL.</>}</p><p>Keep your playlist and password private. Watching uses one of your plan’s screens.</p></div></li>
        </ol>
      </>}
      {device === 'lg' && <details><summary>LG developer installation steps <span aria-hidden="true">+</span></summary><p>Install the official webOS CLI. In the TV’s Developer Mode app, enable Key Server. Use <code>ares-setup-device</code> to add your TV (its IP, port 9922, user prisoner). Run <code>ares-novacom --device myTV --getkey</code> and enter the passphrase from the TV.</p><pre>ares-install --device myTV tv.lumanest.tuner_1.0.5_all.ipk{'\n'}ares-launch --device myTV tv.lumanest.tuner</pre><p>Keep the Developer Mode session active; LG removes developer apps when it expires. This LG build supports single-stream playback and needs testing on your TV. If you installed an earlier Tuner build, add your playlist and line login again in this version.</p><a className="setup-inline-link" href="https://webostv.developer.lge.com/develop/getting-started/developer-mode-app" target="_blank" rel="noreferrer">LG’s official setup guide <span aria-hidden="true">↗</span></a></details>}
      {device === 'roku' && <details><summary>Roku developer installation steps <span aria-hidden="true">+</span></summary><p>The button sequence opens Roku’s Developer Settings screen. Choose <strong>Enable installer and restart</strong>, accept the license and set a web server password. After the restart, the TV shows an address such as <code>http://192.168.1.20</code>. Open it in a browser on a computer on the same network, sign in with user <code>rokudev</code> and your password, choose <strong>Upload</strong>, pick the downloaded ZIP (leave it zipped) and choose <strong>Install with zip</strong>. Tuner opens on the TV and shows its pairing code.</p><p>A Roku holds one developer app at a time; installing another replaces it. Tuner stays installed until you replace it or turn off developer mode. This Roku build needs testing on your TV.</p><a className="setup-inline-link" href="https://developer.roku.com/docs/developer-program/getting-started/developer-setup.md" target="_blank" rel="noreferrer">Roku’s official setup guide <span aria-hidden="true">↗</span></a></details>}
      <div className="setup-help"><h3>Need a hand?</h3><p>Tell us your TV brand and model, and where you got stuck.</p><a href={'mailto:' + support + '?subject=TV%20setup%20help'}>Contact setup support <span aria-hidden="true">↗</span></a></div>
    </section> : null}
    <p className="setup-account-note"><strong>Already have a subscription?</strong> Your customer hub holds your line login and setup details. {portal ? <a href={portal}>Open customer hub <span aria-hidden="true">↗</span></a> : <a href={'mailto:' + support}>Contact support <span aria-hidden="true">↗</span></a>} Need more time? <a href="/renew">Renew online or manage auto-renew <span aria-hidden="true">↗</span></a>.</p>
  </>;
}
