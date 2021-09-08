/* eslint-disable global-require, no-process-env, import/no-commonjs */
require('@babel/register'); // eslint-disable-line import/no-extraneous-dependencies
require("babel-polyfill");

const nconf = require('nconf');

nconf.argv()
  .env()
  .file({ file: './config.json' });
  
module.exports = require('./server.js');