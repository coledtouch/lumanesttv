'use client';

import {useEffect, useRef, useState} from 'react';
import {tuner} from '../../lib/tuner';

const devices = [
  ['android', 'Android / Google TV', 'Google TV, Android TV and Fire TV'],
  ['samsung', 'Samsung TV', 'Tuner download temporarily unavailable'],
  ['lg', 'LG TV', 'webOS · PC and developer installation required'],
  ['browser', 'Computer / browser', 'Watch in your browser. No installation needed.'],
];

export default function Setup({portal, support}: {portal: string; support: string}) {
  const [device, setDevice] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const moveToInstructions = useRef(false);

  useEffect(() => {
    function readHash() {
      const id = window.location.hash.slice(1);
      if (devices.some(item => item[0] === id)) setDevice(id);
    }
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
    setDevice(id);
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + id);
  }

  const deviceName = devices.find(item => item[0] === device)?.[1];
  return <>
    <div className="device-grid" ref={pickerRef} role="group" aria-label="Choose your device">{devices.map(([id, title, description]) => <button type="button" className={'device-card ' + (device === id ? 'active' : '')} key={id} aria-pressed={device === id} aria-controls="setup-instructions" onClick={() => chooseDevice(id)}><span aria-hidden="true">{id === 'lg' ? 'LG' : id === 'samsung' ? 'S' : id === 'android' ? 'TV' : '▶'}</span><strong>{title}</strong><small>{description}</small></button>)}</div>
    <p className="sr-only" role="status">{device ? deviceName + ' instructions are ready below.' : 'Choose your device to see its setup instructions.'}</p>
    {device ? <section id="setup-instructions" className="setup-panel" aria-labelledby="setup-title">
      <div className="setup-panel-heading"><p className="eyebrow">SETUP FOR {deviceName?.toUpperCase()}</p><button type="button" className="setup-change-device" onClick={() => {const active = pickerRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]'); active?.focus(); pickerRef.current?.scrollIntoView({block: 'center'});}}>Change device ↑</button></div>
      {device === 'browser' ? <><h2 id="setup-title" ref={headingRef} tabIndex={-1}>Sign in. Start watching.</h2><p>Use the <strong>line username and line password</strong> from your customer hub’s TV/app setup details. These can be different from your email account login.</p><a className="button primary" href="/watch">Open webplayer <span aria-hidden="true">↗</span></a>{portal && <p><a className="setup-inline-link" href={portal}>Find my line login in the customer hub <span aria-hidden="true">↗</span></a></p>}</> : device === 'samsung' ? <>
        <h2 id="setup-title" ref={headingRef} tabIndex={-1}>Samsung setup.</h2>
        <p>The Tuner download for Samsung TVs is temporarily unavailable.</p>
        <p>You can watch in your computer’s browser, or connect an IPTV player you already use with the server address and line login in your customer hub.</p>
        <div className="actions"><a className="button primary" href="/watch">Open webplayer <span aria-hidden="true">↗</span></a>{portal && <a className="button secondary" href={portal}>Open my customer hub <span aria-hidden="true">↗</span></a>}</div>
        <p>Contact setup support for help choosing a way to watch on your TV.</p>
      </> : <>
        <h2 id="setup-title" ref={headingRef} tabIndex={-1}>Three steps to your TV.</h2>
        <ol className="setup-steps">
          <li><div><h3>Install Tuner</h3>{device === 'android' ? <><p>Download using Downloader on your TV, or send the file with Send Files to TV. Open the APK and follow the installation prompts.</p><a className="button primary" href={'/api/tuner?version=' + tuner.version} download>Download Android app <span aria-hidden="true">↓</span></a><small>Version {tuner.version} · Android 6.0+ · {(tuner.bytes / (1024 * 1024)).toFixed(1)} MB</small><p>If you installed an earlier Tuner build, add your playlist and line login again in this version.</p></> : <><p>Install LG’s Developer Mode app from your TV’s app store. Sign in with your LG developer account and enable Dev Mode Status. Use a PC on the same network to install Tuner.</p><a className="button primary" href="/downloads/tv.lumanest.tuner_1.0.1_all.ipk" download>Download LG app <span aria-hidden="true">↓</span></a><small>Version 1.0.1 · webOS IPK · Developer installation</small></>}</div></li>
          <li><div><h3>Find your line login</h3><p>Open your subscription’s TV/app setup details in your customer hub. Use the <strong>line login</strong> shown there; your email account password can be different.</p>{portal ? <a className="button secondary" href={portal}>Open my customer hub <span aria-hidden="true">↗</span></a> : <a className="button secondary" href={'mailto:' + support}>Get help with my line login <span aria-hidden="true">↗</span></a>}</div></li>
          <li><div><h3>Connect & watch</h3>{device === 'android' ? <p>In Tuner, choose <strong>M3U URL</strong> and paste the playlist URL from your hub. If your hub provides an Xtream server, you can also use <strong>Xtream Codes</strong> with your line username and password.</p> : <p>Open Tuner and add a playlist. Enter the <strong>server address, line username and line password</strong> from your setup details, or use your M3U URL. Choose Live TV, Movies or Series.</p>}<p>Keep your playlist and password private. Watching uses one of your plan’s screens.</p></div></li>
        </ol>
      </>}
      {device === 'lg' && <details><summary>LG developer installation steps <span aria-hidden="true">+</span></summary><p>Install the official webOS CLI. In the TV’s Developer Mode app, enable Key Server. Use <code>ares-setup-device</code> to add your TV (its IP, port 9922, user prisoner). Run <code>ares-novacom --device myTV --getkey</code> and enter the passphrase from the TV.</p><pre>ares-install --device myTV tv.lumanest.tuner_1.0.1_all.ipk{'\n'}ares-launch --device myTV tv.lumanest.tuner</pre><p>Keep the Developer Mode session active; LG removes developer apps when it expires. This LG build supports single-stream playback and needs testing on your TV. If you installed an earlier Tuner build, add your playlist and line login again in this version.</p><a className="setup-inline-link" href="https://webostv.developer.lge.com/develop/getting-started/developer-mode-app" target="_blank" rel="noreferrer">LG’s official setup guide <span aria-hidden="true">↗</span></a></details>}
      <div className="setup-help"><h3>Need a hand?</h3><p>Tell us your TV brand and model, and where you got stuck.</p><a href={'mailto:' + support + '?subject=TV%20setup%20help'}>Contact setup support <span aria-hidden="true">↗</span></a></div>
    </section> : <p id="setup-instructions" className="setup-prompt">Choose a device above. Your installation steps and login help will appear here.</p>}
    <p className="setup-account-note"><strong>Already have a subscription?</strong> Your customer hub holds your line login and setup details. {portal ? <a href={portal}>Open customer hub <span aria-hidden="true">↗</span></a> : <a href={'mailto:' + support}>Contact support <span aria-hidden="true">↗</span></a>} Need more time? <a href="/renew">Renew online or manage auto-renew <span aria-hidden="true">↗</span></a>.</p>
  </>;
}
