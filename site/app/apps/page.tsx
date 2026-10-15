import Setup from './setup';
import {settings} from '../../lib/mybunny';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'TV setup | LumaNest TV', description: 'Device-specific setup for Android TV, Samsung, LG and your web browser.'};

export default function Apps() {
  const portal = settings().CUSTOMER_PORTAL_URL || 'https://portal.lumanest.tv';
  const support = settings().SUPPORT_EMAIL || 'support@lumanest.tv';
  return <>
    <a className="skip-link" href="#setup-main">Skip to device setup</a>
    <header className="site-header"><a href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width="204" height="64"/></a><nav aria-label="Main navigation"><a href="/#plans">Plans</a><a href="/renew">Renew</a><a href="/watch">Watch now</a><a className="nav-cta" href={portal}>Customer sign in <span aria-hidden="true">↗</span></a></nav></header>
    <main className="setup-page" id="setup-main"><p className="eyebrow">LET’S GET YOUR TV CONNECTED</p><h1>What are you<br/><em>watching on?</em></h1><p className="setup-intro">Choose your device for installation steps and login help. Use your line login from your customer hub to start watching.</p><Setup portal={portal} support={support}/></main>
    <footer><a href="/">LumaNest TV</a><a href="/renew">Renew subscription</a><a href="/watch">Watch in your browser</a><a href={'mailto:' + support}>Contact support</a></footer>
  </>;
}
