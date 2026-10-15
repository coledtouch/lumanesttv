import Renewal from './renewal';
import {settings} from '../../lib/mybunny';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Renew your subscription | LumaNest TV',
  description: 'Renew your existing LumaNest TV line with a one-time PayPal payment or choose optional automatic renewals.',
  robots: {index: false, follow: false},
};

export default function Renew() {
  const config = settings();
  return <Renewal portal={config.CUSTOMER_PORTAL_URL || 'https://portal.lumanest.tv'} support={config.SUPPORT_EMAIL || 'support@lumanest.tv'}/>;
}
