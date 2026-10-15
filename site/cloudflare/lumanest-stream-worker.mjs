import {connect} from 'cloudflare:sockets';
import {createStreamRelay} from './lumanest-stream-relay.mjs';

export default createStreamRelay(connect);
