const kue = require('kue');
const express = require('express');
const monk = require('monk');
const url = require('url');
const nconf = require('nconf');
const AWS = require('aws-sdk');

nconf
  .argv()
  .env()
  .file({ file: `${__dirname  }/config.json` });

let app = express();

let db = monk(nconf.get('MONGODB_URL'));
db.options.multi = true;

const BASE_URL = 'https://habitica.com';

AWS.config.update({
  accessKeyId: nconf.get('AWS_ACCESS_KEY'),
  secretAccessKey: nconf.get('AWS_SECRET_KEY'),
});

let kueRedisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST'),
};

if (nconf.get('NODE_ENV') === 'production') {
  let redisURL = url.parse(nconf.get('REDIS_URL'));
  kueRedisOpts.auth = redisURL.auth.split(':')[1];
  kueRedisOpts.host = redisURL.hostname;
  kueRedisOpts.port = redisURL.port;
}

let queue = kue.createQueue({
  disableSearch: true,
  redis: kueRedisOpts,
});

queue.process('email', 30, require('./workers/email'));

queue.process('sendBatchEmails', require('./workers/sendBatchEmails')(queue, db, BASE_URL));
queue.process('sendOnboardingEmails', require('./workers/onboardingEmails')(queue, db, BASE_URL));
// queue.process('sendWeeklyRecapEmails', require('./workers/sendWeeklyRecapEmails')(queue, db, BASE_URL));

queue.process('sendSpecialPushNotifications', require('./workers/sendSpecialPushNotifications')(queue, db));

queue.process('amazonPayments', require('./workers/amazonPayments')(queue, db));
queue.process('googlePayments', require('./workers/googlePayments')(queue, db));
queue.process('amazonGroupPlanPayments', require('./workers/amazonGroupPlanPayments')(queue, db));

queue.on('job complete', (id) => {
  kue.Job.get(id, (err, job) => {
    if (err) return;
    job.remove((err2) => {
      if (err2) throw err2;
    });
  });
});

queue.on('job failed', () => {
  let args = Array.prototype.slice.call(arguments);
  args.unshift('Error processing job.');
  try {
    console.error(...JSON.stringify(args));
  } catch (e) {
    console.error('Impossible to convert error to JSON', e);
  }
});

queue.watchStuckJobs();

process.once('uncaughtException', (err) => {
  queue.shutdown(9500, (err2) => {
    console.log('Kue is shutting down.', err, err2);
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  queue.shutdown(9500, (err) => {
    console.log('Kue is shutting down.', err || '');
    process.exit(0);
  });
});

app.use(require('basic-auth-connect')(nconf.get('AUTH_USER'), nconf.get('AUTH_PASSWORD')));
app.use(kue.app);
app.listen(nconf.get('PORT'));

console.log(`Server listening on port ${  nconf.get('PORT')}`);
