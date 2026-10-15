import Storefront from './storefront';
import {env} from 'cloudflare:workers';
export const dynamic='force-dynamic';
export default function Home(){const e=env as unknown as Record<string,string>;return <Storefront portal={e.CUSTOMER_PORTAL_URL||'https://tv.lumanest.tv'} ready={Boolean(e.PAYPAL_CLIENT_ID&&e.PAYPAL_CLIENT_SECRET&&e.MYBUNNY_API_KEY&&e.CUSTOMER_PORTAL_URL&&e.CHECKOUT_ENABLED==='true')} support={e.SUPPORT_EMAIL||'support@lumanest.tv'}/>}
