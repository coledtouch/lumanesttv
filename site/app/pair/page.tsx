import './pair.css';
import PairFlow from './pair-flow';
import {settings} from '../../lib/mybunny';
import {DEFAULT_PORTAL} from '../site';
import {SiteFooter, SiteHeader} from '../site-chrome';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Pair your TV | LumaNest TV', description: 'Connect the Tuner app on your TV to your LumaNest TV line by scanning the code on screen.', robots: {index: false}};

export default async function Pair({searchParams}: {searchParams: Promise<{code?: string | string[]}>}) {
  const portal = settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL;
  const support = settings().SUPPORT_EMAIL || 'support@lumanest.tv';
  const code = (await searchParams).code;
  return <>
    {/* No Plans, Renew or Customer hub links: TV apps from the App Store send customers here with a QR code. */}
    <SiteHeader portal={portal} current="/apps" purchases={false}/>
    <main className="pair-page" id="main-content"><PairFlow initialCode={typeof code === 'string' ? code.slice(0, 20) : ''}/></main>
    <SiteFooter portal={portal} support={support} purchases={false}/>
  </>;
}
