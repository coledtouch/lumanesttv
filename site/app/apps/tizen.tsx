export default function Tizen({support}: {support: string}) {
  return <section className="tizen-download" id="samsung">
    <p className="eyebrow">SAMSUNG SMART TV · TIZEN OS</p>
    <h2>Tuner for Samsung.</h2>
    <p>The Tuner download for Samsung TVs is temporarily unavailable.</p>
    <p>You can watch in your computer’s browser, or use the line login from your customer hub with an IPTV player you already have.</p>
    <div className="actions"><a className="button primary" href="/watch">Open webplayer ↗</a><a className="button secondary" href={'mailto:' + support + '?subject=Samsung%20TV%20setup'}>Contact setup support ↗</a></div>
  </section>;
}
