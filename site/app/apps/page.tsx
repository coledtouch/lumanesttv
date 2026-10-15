import './apps.css';
import Setup from './setup';
import {settings} from '../../lib/mybunny';
import {DEFAULT_PORTAL} from '../site';
import {SiteFooter, SiteHeader} from '../site-chrome';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'TV setup | LumaNest TV', description: 'Device-specific setup for Android TV, Samsung, LG and your web browser.'};

export default function Apps() {
  const portal = settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL;
  const support = settings().SUPPORT_EMAIL || 'support@lumanest.tv';
  return <>
    <SiteHeader portal={portal} current="/apps"/>
    <main className="setup-page" id="main-content"><p className="eyebrow">LET’S GET YOUR TV CONNECTED</p><h1>What are you<br/><em>watching on?</em></h1><p className="setup-intro">Choose your device for installation steps and login help. Use your line login from your customer hub to start watching.</p><Setup portal={portal} support={support}/></main>
    <SiteFooter portal={portal} support={support}/>
  </>;
}
