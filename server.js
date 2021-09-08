import nconf from 'nconf';
import Queue from 'bull';
import express from 'express';
import bodyParser from 'body-parser';
import monk from 'monk';
import { parse } from 'url';
import awsConfig from 'aws-sdk';
import { config as _config } from 'in-app-purchase';
import paypalConfigure from 'paypal-rest-sdk';

import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter.js';
import { ExpressAdapter } from '@bull-board/express';

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

const DB_URL = nconf.get('NODE_ENV') === 'test' ? nconf.get('TEST_MONGODB_URL') : nconf.get('MONGODB_URL');
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

const redisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST'),
};

if (nconf.get('NODE_ENV') === 'production') {
  const redisURL = parse(nconf.get('REDIS_URL'));
  [, redisOpts.auth] = redisURL.auth.split(':');
  redisOpts.host = redisURL.hostname;
  redisOpts.port = redisURL.port;
}

const queueOpts = {
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 30 * 60 * 1000,
    },
  },
};

const comQueue = Queue('Communication', redisOpts, queueOpts);
comQueue.process('email', 30, email);
comQueue.process('sendBatchEmails', sendBatchEmails(comQueue, db, BASE_URL));
comQueue.process('sendOnboardingEmails', sendOnboardingEmails(comQueue, db, BASE_URL));
comQueue.process('sendSpecialPushNotifications', sendSpecialPushNotifications(comQueue, db));
const paymentQueue = Queue('Payments', redisOpts, queueOpts);
paymentQueue.process('amazonPayments', amazonPayments(paymentQueue, db));
paymentQueue.process('googlePayments', googlePayments(paymentQueue, db));
paymentQueue.process('applePayments', applePayments(paymentQueue, db));
paymentQueue.process('amazonGroupPlanPayments', amazonGroupPlanPayments(paymentQueue, db));
const remindersQueue = Queue('Reminders', redisOpts, queueOpts);
remindersQueue.process('applePaymentsReminders', appleSubscriptionReminders(remindersQueue, db, BASE_URL));
remindersQueue.process('googlePaymentsReminders', googleSubscriptionReminders(remindersQueue, db, BASE_URL));
remindersQueue.process('amazonPaymentsReminders', amazonPaymentsReminders(remindersQueue, db, BASE_URL));
remindersQueue.process('stripeReminders', stripeReminders(remindersQueue, db, BASE_URL));
remindersQueue.process('paypalReminders', paypalReminders(remindersQueue, db, BASE_URL));
remindersQueue.process('stripeGroupsReminders', stripeGroupsReminders(remindersQueue, db, BASE_URL));
remindersQueue.process('amazonGroupsReminders', amazonGroupsReminders(remindersQueue, db, BASE_URL));
remindersQueue.process('expirationReminders', expirationReminders(remindersQueue, db, BASE_URL));

const queues = [
  comQueue,
  paymentQueue,
  remindersQueue,
];

queues.forEach(queue => {
  queue.on('completed', job => {
    job.remove();
  });
  queue.on('failed', (job, error) => {
    console.log(error);
    /* const args = Array.prototype.slice.call(arguments);
    args.unshift('Error processing job.');
    try {
      console.error(...JSON.stringify(args));
    } catch (e) {
      console.error('Impossible to convert error to JSON', e);
    } */
  });
});

process.once('uncaughtException', err => {
  console.log(err);
  comQueue.close().then(() => paymentQueue.close()).then(() => remindersQueue.close()).then(() => {
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  comQueue.close().then(() => paymentQueue.close()).then(() => remindersQueue.close()).then(() => {
    process.exit(0);
  });
});

const serverAdapter = new ExpressAdapter();

createBullBoard({
  queues: queues.map(queue => new BullAdapter(queue)),
  serverAdapter,
});

const expressApp = express();

expressApp.use(serverAdapter.getRouter());
expressApp.use(basicAuthConnect(nconf.get('AUTH_USER'), nconf.get('AUTH_PASSWORD')));
expressApp.listen(nconf.get('PORT'));
const jsonParser = bodyParser.json();
expressApp.post('/job', jsonParser, async (req, res) => {
  const job = await comQueue.add(
    req.body.type,
    req.body.data,
  );
  res.json({ id: job.id });
});

expressApp.get('/health', jsonParser, async (req, res) => {
  let status = "green"
  const statuses = (await Promise.all(queues.map( async queue => {
    return {
      queue: queue.name,
      repeating: (await queue.getRepeatableJobs()).length,
      failed: await queue.getFailedCount()
    }
  })))
  res.json({
    status,
    queues: statuses
  })
});

console.log(`Server listening on port ${nconf.get('PORT')}`);

comQueue.add('sendOnboardingEmails', {}, { repeat: { cron: '0 */1 * * *' } });

paymentQueue.add('applePayments', {}, { repeat: { cron: '0 */6 * * *' } });
paymentQueue.add('googlePayments', {}, { repeat: { cron: '0 */6 * * *' } });
paymentQueue.add('amazonPayments', {}, { repeat: { cron: '0 */6 * * *' } });

remindersQueue.add('applePaymentsReminders', {}, { repeat: { cron: '0 */12 * * *' } });
remindersQueue.add('googlePaymentsReminders', {}, { repeat: { cron: '0 */12 * * *' } });
remindersQueue.add('amazonPaymentsReminders', {}, { repeat: { cron: '0 */12 * * *' } });
remindersQueue.add('stripeReminders', {}, { repeat: { cron: '0 */12 * * *' } });
remindersQueue.add('paypalReminders', {}, { repeat: { cron: '0 */12 * * *' } });
remindersQueue.add('stripeGroupsReminders', {}, { repeat: { cron: '0 */12 * * *' } });
remindersQueue.add('amazonGroupsReminders', {}, { repeat: { cron: '0 */12 * * *' } });
remindersQueue.add('expirationReminders', {}, { repeat: { cron: '0 */12 * * *' } });
