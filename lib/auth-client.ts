'use client';

import { createAuthClient } from 'better-auth/react';
import { magicLinkClient, phoneNumberClient } from 'better-auth/client/plugins';

// No explicit baseURL: the client issues same-origin requests to
// /api/auth/* by default, which is all this app ever needs.
export const authClient = createAuthClient({
  plugins: [phoneNumberClient(), magicLinkClient()],
});
