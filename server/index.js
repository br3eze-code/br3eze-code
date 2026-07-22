/**
 * Cloud Functions entry point (firebase.json -> functions.source = "server").
 * Wraps the plain Express app exported by server.js -- requiring server.js
 * here does NOT start its raw HTTP listener or WebSocket gateway (guarded
 * behind `require.main === module` in server.js); Cloud Functions handles
 * the actual HTTP listener itself.
 *
 * firebase.json's hosting rewrite ("/api/**" -> function "api") expects the
 * exported function to be named "api".
 */
import functions from 'firebase-functions';
import { app } from './server.js';

export const api = functions.https.onRequest(app);
