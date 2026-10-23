import '../trial.css';
import TrialStatus from './trial-status';
import {settings} from '../../../lib/mybunny';
import {DEFAULT_PORTAL} from '../../site';

export const dynamic = 'force-dynamic';
// A private page: its link carries the request's secret token in the fragment, so it is never indexed and sends no referrer.
export const metadata = {title: 'Your free trial | LumaNest TV', robots: {index: false, follow: false}, referrer: 'no-referrer'};

export default function TrialStatusPage() {
  return <TrialStatus portal={settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL} support={settings().SUPPORT_EMAIL || 'support@lumanest.tv'}/>;
}
