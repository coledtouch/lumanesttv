import Player from './player';import {settings} from '../../lib/mybunny';
export const dynamic='force-dynamic';
export const metadata={title:'Watch — LumaNest TV'};
export default function Watch(){return <Player portal={settings().CUSTOMER_PORTAL_URL||'https://portal.lumanest.tv'} support={settings().SUPPORT_EMAIL||'support@lumanest.tv'}/>}
