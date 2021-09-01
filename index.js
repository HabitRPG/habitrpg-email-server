import nconf from 'nconf';
import kue from 'kue';
import express from 'express';
import monk from 'monk';
import { parse } from 'url';
import awsConfig from 'aws-sdk';
import { config as _config } from 'in-app-purchase';
import paypalConfigure from 'paypal-rest-sdk';

import basicAuthConnect from 'basic-auth-connect';
import email from './workers/email.js';

import sendBatchEmails from './workers/sendBatchEmails.js';
import sendOnboardingEmails from './workers/onboardingEmails.js';
// queue.process('sendWeeklyRecapEmails', require('./workers/sendWeeklyRecapEmails')(queue, db, BASE_URL));

import sendSpecialPushNotifications from './workers/sendSpecialPushNotifications.js';

import amazonPayments from './workers/amazonPayments.js';
import googlePayments from './workers/googlePayments.js';
import applePayments from './workers/applePayments.js';
import amazonGroupPlanPayments from './workers/amazonGroupPlanPayments.js';

import appleSubscriptionReminders from './workers/subscriptionsReminders/applePayments.js';
import googleSubscriptionReminders from './workers/subscriptionsReminders/googlePayments.js';
import amazonPaymentsReminders from './workers/subscriptionsReminders/amazon.js';
import stripeReminders from './workers/subscriptionsReminders/stripe.js';
import paypalReminders from './workers/subscriptionsReminders/paypal.js';

import stripeGroupsReminders from './workers/subscriptionsReminders/stripeGroups.js';
import amazonGroupsReminders from './workers/subscriptionsReminders/amazonGroups.js';

import expirationReminders from './workers/subscriptionsReminders/expiration.js';

nconf.argv()
  .env()
  .file({ file: './config.json' });

const app = express();

const DB_URL = nconf.get('NODE_ENV') === 'test' ? nconf.get('TEST_MONGODB_URL') : nconf.get('MONGODB_URL');
console.log(DB_URL);
const db = monk(DB_URL);

const BASE_URL = nconf.get('BASE_URL');

paypalConfigure.configure({
  mode: nconf.get('PAYPAL_MODE'), // sandbox or live
  client_id: nconf.get('PAYPAL_CLIENT_ID'), // eslint-disable-line camelcase
  client_secret: nconf.get('PAYPAL_CLIENT_SECRET'), // eslint-disable-line camelcase
});

awsConfig.config.update({
  accessKeyId: nconf.get('AWS_ACCESS_KEY'),
  secretAccessKey: nconf.get('AWS_SECRET_KEY'),
});

_config({
  verbose: false,
  // This is the path to the directory containing iap-sanbox/iap-live files
  googlePublicKeyPath: nconf.get('IAP_GOOGLE_KEYDIR'),
  googleAccToken: nconf.get('PLAY_API_ACCESS_TOKEN'),
  googleRefToken: nconf.get('PLAY_API_REFRESH_TOKEN'),
  googleClientID: nconf.get('PLAY_API_CLIENT_ID'),
  googleClientSecret: nconf.get('PLAY_API_CLIENT_SECRET'),
  applePassword: nconf.get('ITUNES_SHARED_SECRET'),
});

const kueRedisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST'),
};

if (nconf.get('NODE_ENV') === 'production') {
  const redisURL = parse(nconf.get('REDIS_URL'));
  [, kueRedisOpts.auth] = redisURL.auth.split(':');
  kueRedisOpts.host = redisURL.hostname;
  kueRedisOpts.port = redisURL.port;
}

const queue = kue.createQueue({
  disableSearch: true,
  redis: kueRedisOpts,
});
queue.process('email', 30, email);
queue.process('sendBatchEmails', sendBatchEmails(queue, db, BASE_URL));
queue.process('sendOnboardingEmails', sendOnboardingEmails(queue, db, BASE_URL));
queue.process('sendSpecialPushNotifications', sendSpecialPushNotifications(queue, db));
queue.process('amazonPayments', amazonPayments(queue, db));
queue.process('googlePayments', googlePayments(queue, db));
queue.process('applePayments', applePayments(queue, db));
queue.process('amazonGroupPlanPayments', amazonGroupPlanPayments(queue, db));
queue.process('applePaymentsReminders', appleSubscriptionReminders(queue, db, BASE_URL));
queue.process('googlePaymentsReminders', googleSubscriptionReminders(queue, db, BASE_URL));
queue.process('amazonPaymentsReminders', amazonPaymentsReminders(queue, db, BASE_URL));
queue.process('stripeReminders', stripeReminders(queue, db, BASE_URL));
queue.process('paypalReminders', paypalReminders(queue, db, BASE_URL));
queue.process('stripeGroupsReminders', stripeGroupsReminders(queue, db, BASE_URL));
queue.process('amazonGroupsReminders', amazonGroupsReminders(queue, db, BASE_URL));
queue.process('expirationReminders', expirationReminders(queue, db, BASE_URL));

queue.on('job complete', id => {
  kue.Job.get(id, (err, job) => {
    if (err) return;
    job.remove(err2 => {
      if (err2) throw err2;
    });
  });
});

queue.on('job failed', () => {
  /* const args = Array.prototype.slice.call(arguments);
  args.unshift('Error processing job.');
  try {
    console.error(...JSON.stringify(args));
  } catch (e) {
    console.error('Impossible to convert error to JSON', e);
  } */
});

queue.watchStuckJobs();

process.once('uncaughtException', err => {
  queue.shutdown(9500, err2 => {
    console.log('Kue is shutting down.', err, err2);
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  queue.shutdown(9500, err => {
    console.log('Kue is shutting down.', err || '');
    process.exit(0);
  });
});
app.use(basicAuthConnect(nconf.get('AUTH_USER'), nconf.get('AUTH_PASSWORD')));

app.use(kue.app);
app.listen(nconf.get('PORT'));

console.log(`Server listening on port ${nconf.get('PORT')}`);
