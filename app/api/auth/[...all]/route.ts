import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/adapters/auth';

export const { GET, POST } = toNextJsHandler(auth);
