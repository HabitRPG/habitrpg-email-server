/* eslint-disable no-undef */
/* eslint-disable global-require */
/* eslint-disable no-process-env */

import monk from 'monk';
import nconf from 'nconf';
import chai from 'chai';
import sinon from 'sinon';
//------------------------------
// Global modules
//------------------------------
global.chai = chai;

global.expect = chai.expect;

global.sinon = sinon;
process.env.NODE_ENV = 'test';

nconf.argv()
  .env()
  .file({ file: './config.json' });

global.db = monk(nconf.get('TEST_MONGODB_URL'));
global.usersCollection = db.get('users', { castIds: false });
