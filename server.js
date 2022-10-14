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

import amazonPayments from './workers/amazonPayments.js';
import applePayments from './libs/applePayments.js';
import googlePayments from './libs/googlePayments.js';
import mobilePayments from './workers/mobilePayments';
import amazonGroupPlanPayments from './workers/amazonGroupPlanPayments.js';

import userSubscriptionReminders from './workers/subscriptionsReminders/userReminders.js';
import amazonReminders from './libs/subscriptionsReminders/amazon.js';
import appleReminders from './libs/subscriptionsReminders/apple.js';
import googleReminders from './libs/subscriptionsReminders/google.js';
import paypalReminders from './libs/subscriptionsReminders/paypal.js';
import stripeReminders from './libs/subscriptionsReminders/stripe.js';

import groupSubscriptionReminders from './workers/subscriptionsReminders/groupReminders.js';
import stripeGroupsReminders from './libs/subscriptionsReminders/stripeGroups.js';
import amazonGroupsReminders from './libs/subscriptionsReminders/amazonGroups.js';

import expirationReminders from './workers/subscriptionsReminders/expiration.js';
import { notifyAdmins } from './libs/notifyAdmins.js';


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
  // This is the path to the directory containing iap-sandbox/iap-live files
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
  if (redisURL.auth !== null) {
    [, redisOpts.auth] = redisURL.auth.split(':');
  }
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
const paymentQueue = Queue('Payments', redisOpts, queueOpts);
paymentQueue.process('amazonPayments', amazonPayments(db));
paymentQueue.process('applePayments', mobilePayments('Apple', applePayments, db));
paymentQueue.process('googlePayments', mobilePayments('Google', googlePayments, db));
paymentQueue.process('amazonGroupPlanPayments', amazonGroupPlanPayments(db));
const remindersQueue = Queue('Reminders', redisOpts, queueOpts);
remindersQueue.process('applePaymentsReminders', userSubscriptionReminders(comQueue, 'Apple', appleReminders, db, BASE_URL));
remindersQueue.process('googlePaymentsReminders', userSubscriptionReminders(comQueue, 'Google', googleReminders, db, BASE_URL));
remindersQueue.process('amazonPaymentsReminders', userSubscriptionReminders(comQueue, 'Amazon Payments', amazonReminders, db, BASE_URL));
remindersQueue.process('stripeReminders', userSubscriptionReminders(comQueue, 'Stripe', stripeReminders, db, BASE_URL));
remindersQueue.process('paypalReminders', userSubscriptionReminders(comQueue, 'Paypal', paypalReminders, db, BASE_URL));
remindersQueue.process('stripeGroupsReminders', groupSubscriptionReminders(comQueue, 'Stripe', stripeGroupsReminders, db, BASE_URL));
remindersQueue.process('amazonGroupsReminders', groupSubscriptionReminders(comQueue, 'Amazon Payments', amazonGroupsReminders, db, BASE_URL));
remindersQueue.process('expirationReminders', expirationReminders(comQueue, db, BASE_URL));

const queues = [
  comQueue,
  paymentQueue,
  remindersQueue,
];

queues.forEach(queue => {
  queue.on('active', job => {
    job.log('Starting Job');
  });
  queue.on('completed', job => {
    job.log('Run Completed');
  });
  queue.on('failed', (job, error) => {
    job.log('Error while processing', inspect(error, { depth: null, showHidden: true }));

    if (queue !== comQueue) {
      notifyAdmins(job, `💥 There was an error with the following job: ${job.name}\n${error}`, 0)
    }
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
  let status = 'green';
  let totalFailed = 0;
  const statuses = (await Promise.all(queues.map(async queue => {
    const failed = await queue.getFailedCount();
    totalFailed += failed;
    return {
      queue: queue.name,
      repeating: (await queue.getRepeatableJobs()).length,
      failed,
    };
  })));
  if (totalFailed > 0 && totalFailed < 4) {
    status = 'yellow';
  } else if (totalFailed >= 4) {
    status = 'red';
  }
  res.json({
    status,
    queues: statuses,
  });
});

console.log(`Server listening on port ${nconf.get('PORT')}`);

comQueue.add('sendOnboardingEmails', {}, { repeat: { cron: '0 */1 * * *' } });

paymentQueue.add('applePayments', {}, { repeat: { cron: '5 */6 * * *' } });
paymentQueue.add('googlePayments', {}, { repeat: { cron: '10 */6 * * *' } });
paymentQueue.add('amazonPayments', {}, { repeat: { cron: '15 */6 * * *' } });

remindersQueue.add('applePaymentsReminders', {}, { repeat: { cron: '3 */12 * * *' } });
remindersQueue.add('googlePaymentsReminders', {}, { repeat: { cron: '6 */12 * * *' } });
remindersQueue.add('amazonPaymentsReminders', {}, { repeat: { cron: '9 */12 * * *' } });
remindersQueue.add('stripeReminders', {}, { repeat: { cron: '12 */12 * * *' } });
remindersQueue.add('paypalReminders', {}, { repeat: { cron: '15 */12 * * *' } });
remindersQueue.add('stripeGroupsReminders', {}, { repeat: { cron: '18 */12 * * *' } });
remindersQueue.add('amazonGroupsReminders', {}, { repeat: { cron: '21 */12 * * *' } });
remindersQueue.add('expirationReminders', {}, { repeat: { cron: '24 */12 * * *' } });
