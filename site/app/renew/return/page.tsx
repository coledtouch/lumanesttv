import Confirmation from './confirmation';
import {settings} from '../../../lib/mybunny';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Auto-renew status | LumaNest TV', robots: {index: false, follow: false}, referrer: 'no-referrer'};

export default function AutoRenewReturn() {
  const config = settings();
  return <Confirmation support={config.SUPPORT_EMAIL || 'support@lumanest.tv'}/>;
}
