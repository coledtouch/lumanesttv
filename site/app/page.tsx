import Storefront from './storefront';
import {env} from 'cloudflare:workers';
import {plans, periods} from '../lib/plans';
import {DEFAULT_PORTAL, SITE_URL, openGraph} from './site';
export const dynamic='force-dynamic';
export const metadata={alternates:{canonical:'/'},openGraph:{...openGraph,url:'/'}};
const structuredData=JSON.stringify([
  {'@context':'https://schema.org','@type':'Organization',name:'LumaNest TV',url:SITE_URL,logo:SITE_URL+'/pwa/icon-512.png'},
  {'@context':'https://schema.org','@type':'Product',name:'LumaNest TV subscription',description:'Live channels, movies and series for 1–4 simultaneous screens.',brand:{'@type':'Brand',name:'LumaNest TV'},image:SITE_URL+'/og-image.png',offers:plans.flatMap(plan=>periods.map((months,index)=>({'@type':'Offer',name:plan.name+' · '+months+' months',price:plan.prices[index],priceCurrency:'USD',url:SITE_URL+'/#plans'})))},
]).replace(/</g,'\\u003c');
export default function Home(){const e=env as unknown as Record<string,string>;return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:structuredData}}/><Storefront portal={e.CUSTOMER_PORTAL_URL||DEFAULT_PORTAL} ready={Boolean(e.PAYPAL_CLIENT_ID&&e.PAYPAL_CLIENT_SECRET&&e.MYBUNNY_API_KEY&&e.CUSTOMER_PORTAL_URL&&e.CHECKOUT_ENABLED==='true')} support={e.SUPPORT_EMAIL||'support@lumanest.tv'}/></>}
