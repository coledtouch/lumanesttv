import Confirmation from './confirmation';
import {settings} from '../../../lib/mybunny';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Payment status | LumaNest TV'};

export default function CheckoutReturn() {
  return <Confirmation portal={settings().CUSTOMER_PORTAL_URL || 'https://portal.lumanest.tv'} support={settings().SUPPORT_EMAIL || 'support@lumanest.tv'}/>;
}
