import { handlePublic } from '../../lib/public-api.mjs';
export const onRequest = ({ request, env }) => handlePublic(request, env);
