import Confirmation from './confirmation';
import {settings} from '../../../lib/mybunny';
import {DEFAULT_PORTAL} from '../../site';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Auto-renew status | LumaNest TV', robots: {index: false, follow: false}, referrer: 'no-referrer'};

export default function AutoRenewReturn() {
  const config = settings();
  return <Confirmation portal={config.CUSTOMER_PORTAL_URL || DEFAULT_PORTAL} support={config.SUPPORT_EMAIL || 'support@lumanest.tv'}/>;
}
