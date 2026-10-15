import Player from './player';import {settings} from '../../lib/mybunny';import {DEFAULT_PORTAL} from '../site';
export const dynamic='force-dynamic';
export const metadata={title:'Watch | LumaNest TV',description:'Sign in with your LumaNest TV line login to watch live channels, movies and series in your browser.'};
export default function Watch(){return <Player portal={settings().CUSTOMER_PORTAL_URL||DEFAULT_PORTAL} support={settings().SUPPORT_EMAIL||'support@lumanest.tv'}/>}
