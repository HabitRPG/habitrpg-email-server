/* eslint-disable no-undef */
/* eslint-disable global-require */
/* eslint-disable no-process-env */

const nconf = require('nconf');
const sinonStubPromise = require('sinon-stub-promise');

//------------------------------
// Global modules
//------------------------------
global.chai = require('chai');
global.expect = chai.expect;
global.sinon = require('sinon');
sinonStubPromise(global.sinon);
global.sandbox = sinon.sandbox.create();
process.env.NODE_ENV = 'test';

nconf
  .argv()
  .env()
  .file({ file: `${__dirname  }/../../config.json` });
