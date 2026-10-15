import Confirmation from './confirmation';
import {settings} from '../../../lib/mybunny';
import {DEFAULT_PORTAL} from '../../site';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Payment status | LumaNest TV', robots: {index: false, follow: false}, referrer: 'no-referrer'};

export default function CheckoutReturn() {
  return <Confirmation portal={settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL} support={settings().SUPPORT_EMAIL || 'support@lumanest.tv'}/>;
}
