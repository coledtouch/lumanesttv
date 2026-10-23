import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { triggers } from './routes/triggers.js';

// Root app for the endpoints devvit.json points at. This app has no menu items, forms or public API.
const app = new Hono();
const internal = new Hono();

internal.route('/triggers', triggers);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
