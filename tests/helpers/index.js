/* eslint-disable no-undef */
/* eslint-disable global-require */
/* eslint-disable no-process-env */

//------------------------------
// Global modules
//------------------------------
global.chai = require('chai');
chai.use(require('sinon-chai'));
global.expect = chai.expect;
global.sinon = require('sinon');
let sinonStubPromise = require('sinon-stub-promise');
sinonStubPromise(global.sinon);
global.sandbox = sinon.sandbox.create();

nconf
  .argv()
  .env()
  .file({ file: `${__dirname  }/../../config.json` });
