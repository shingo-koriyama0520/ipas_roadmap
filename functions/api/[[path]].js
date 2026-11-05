import { handle } from '../../lib/api.mjs';
export const onRequest = ({ request, env }) => handle(request, env);
