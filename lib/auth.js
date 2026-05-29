'use strict';

const basicAuth = require('express-basic-auth');
const logger = require('./logger');

/**
 * Returns an express-basic-auth middleware if both BASIC_AUTH_USER and
 * BASIC_AUTH_PASS are set in the environment. Returns null otherwise — the
 * caller should skip mounting it and rely on network-level access control
 * (e.g. Cloudflare Access) instead.
 */
const USER_RE = /^[a-zA-Z0-9._@-]+$/;

function buildAuth() {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  if (!user || user.trim() === '' || !pass || pass.trim() === '') {
    return null;
  }

  if (!USER_RE.test(user)) {
    throw new Error(`BASIC_AUTH_USER contains unsafe characters: ${user}`);
  }

  return basicAuth({
    users: { [user]: pass },
    challenge: true,
    realm: 'ccfleet',
    unauthorizedResponse: (req) => {
      logger.warn(
        {
          event: 'auth_failure',
          ip: req.ip,
          path: req.path,
          method: req.method,
        },
        'basic auth rejected',
      );
      return { error: 'unauthorized' };
    },
  });
}

module.exports = { buildAuth };
