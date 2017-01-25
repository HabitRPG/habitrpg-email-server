const nconf = require('nconf');
const moment = require('moment');
const request = require('request');
const iap = require('in-app-purchase');
const subscriptions = require('../libs/subscriptions');
const USERS_BATCH = 10;
// Defined later
let db;
let queue;
let habitrpgUsers;

iap.config({
  // This is the path to the directory containing iap-sanbox/iap-live files
  googlePublicKeyPath: nconf.get('IAP_GOOGLE_KEYDIR'),
  googleAccToken: nconf.get('PLAY_API_ACCESS_TOKEN'),
  googleRefToken: nconf.get('PLAY_API_REFRESH_TOKEN'),
  googleClientID: nconf.get('PLAY_API_CLIENT_ID'),
  googleClientSecret: nconf.get('PLAY_API_CLIENT_SECRET'),
});

function processUser (user, jobStartDate, nextScheduledCheck) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
  }
  return new Promise((resolve, reject) => {
    iap.validate(iap.GOOGLE, user.purchased.plan.additionalData, (error, response) => {
      if (error) {
        return reject(error);
      }
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let subscription = purchaseDataList[0];
        if (subscription.expirationDate < jobStartDate) {
          request({
            url: `${nconf.get('BASE_URL')}/iap/android/subscribe/cancel`,
            method: 'GET',
            qs: {
              noRedirect: 'true',
              _id: user._id,
              apiToken: user.apiToken,
            },
          }, (habitError, habitResponse, body) => {
            if (!habitError && habitResponse.statusCode === 200) {
              return resolve();
            }

            reject(habitError || body); // if there's an error or response.statucCode !== 200
          });
        } else {
          let d = nextScheduledCheck;
          if (subscription.expirationDate < d) {
            d = subscription.expirationDate;
          }
          habitrpgUsers.update(
            {
              _id: user._id,
            },
            {
              $set: {
                'purchased.plan.nextPaymentProcessing': d,
                'purchased.plan.nextBillingDate': subscription.expirationDate,
              },
            }, e => {
              if (e) return reject(e);

              return resolve();
            });
        }
      }
    });
  });
}

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('googlePayments')
      .priority('critical')
      .delay(moment().add({hours: 6}).toDate() - new Date()) // schedule another job, 1 hour from now
      .attempts(5)
      .save(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
  });
}

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });

  let jobStartDate;
  let lastId;
  let nextScheduledCheck;

  function findAffectedUsers () {
    let query = {
      'purchased.plan.paymentMethod': 'Google',
      'purchased.plan.dateTerminated': null, // TODO use $type 10?

      'purchased.plan.nextPaymentProcessing': {
        $lte: jobStartDate.toDate(),
      },
    };

    if (lastId) {
      query._id = {
        $gt: lastId,
      };
    }

    console.log('Run query', query);

    let usersFoundNumber;

    return habitrpgUsers.find(query, {
      sort: {_id: 1},
      limit: USERS_BATCH,
      fields: ['_id', 'apiToken', 'purchased.plan'],
    })
      .then(users => {
        console.log('Google: Found n users', users.length);
        usersFoundNumber = users.length;
        lastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

        return Promise.all(users.map(user => {
          return processUser(user, jobStartDate, nextScheduledCheck);
        }));
      }).then(() => {
        if (usersFoundNumber === USERS_BATCH) {
          return findAffectedUsers();
        } else {
          return; // Finish the job
        }
      });
  }
  console.log('Start fetching subscriptions due with Google Payments.');
  jobStartDate = moment.utc();
  nextScheduledCheck = moment.utc().add({days: 2});

  iap.setup(error => {
    if (error) {
      done(error);
      return;
    }
    findAffectedUsers()
      .then(scheduleNextJob) // All users have been processed, schedule the next job
      .then(done)
      .catch(err => { // The processing errored, crash the job and log the error
        console.log('Error while sending onboarding emails.', err);
        done(err);
      });
  });
}
module.exports = function work (parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
};
