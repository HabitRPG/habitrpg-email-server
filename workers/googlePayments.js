let nconf = require('nconf');
let moment = require('moment');
let request = require('request');
let async = require('async');
let iap = require('in-app-purchase');

// Defined later
let db;
let queue;
let habitrpgUsers;
/* eslint-disable camelcase */

// TODO fetch from api
let subscriptionBlocks = {
  basic_earned: {months: 1, price: 5},
  basic_3mo: {months: 3, price: 15},
  basic_6mo: {months: 6, price: 30},
  google_6mo: {months: 6, price: 24, discount: true, original: 30},
  basic_12mo: {months: 12, price: 48},
};
/* eslint-enable camelcase */

iap.config({
  // This is the path to the directory containing iap-sanbox/iap-live files
  googlePublicKeyPath: nconf.get('IAP_GOOGLE_KEYDIR'),
  googleAccToken: nconf.get('PLAY_API_ACCESS_TOKEN'),
  googleRefToken: nconf.get('PLAY_API_REFRESH_TOKEN'),
  googleClientID: nconf.get('PLAY_API_CLIENT_ID'),
  googleClientSecret: nconf.get('PLAY_API_CLIENT_SECRET'),
});

function processUser (user, cb, jobStartDate, nextScheduledCheck) {
  try {
    let plan = subscriptionBlocks[user.purchased.plan.planId];

    if (!plan) {
      throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
    }

    iap.validate(iap.GOOGLE, user.purchased.plan.additionalData, (error, response) => {
      if (error) {
        return cb(error);
      }
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let subscription = purchaseDataList[0];
        if (subscription.expirationDate < jobStartDate) {
          request({
            url: `${nconf.get('HABITICA_URL')}/iap/android/subscribe/cancel`,
            method: 'GET',
            qs: {
              noRedirect: 'true',
              _id: user._id,
              apiToken: user.apiToken,
            },
          }, (habitError, habitResponse, body) => {
            if (!habitError && habitResponse.statusCode === 200) {
              return cb(habitError);
            }

            cb(habitError || body); // if there's an error or response.statucCode !== 200
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
              if (e) return cb(e);

              return cb();
            });
        }
      }
    });
  } catch (e) {
    // TODO mark subscription as expired?
    console.error(e, 'ERROR PROCESSING GOOGLE PAYMENT for user ', user._id);
    cb(e);
  }
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

    habitrpgUsers.find(query, {
      sort: {_id: 1},
      limit: 10,
      fields: ['_id', 'apiToken', 'purchased.plan'],
    }, (err, docs) => {
      if (err) return done(err);

      console.log('GOOGLE PAYMENTS, found n users', docs.length);

      // When there are no users to process, schedule next job & end this one
      if (docs.length === 0) {
        queue.create('googlePayments')
          .priority('critical')
          .delay(jobStartDate.add({hours: 1}).toDate() - new Date())
          .attempts(5)
          .save(queueErr => {
            return queueErr ? done(queueErr) : done();
          });

        return;
      }

      lastId = docs.length > 0 ? docs[docs.length - 1]._id : null;

      async.eachSeries(docs, (user, cb) => {
        processUser(user, cb, jobStartDate, nextScheduledCheck);
      }, eachSeriesError => {
        console.log('terminating', eachSeriesError);
        if (eachSeriesError) return done(eachSeriesError);
        if (docs.length === 10) {
          findAffectedUsers();
        } else {
          queue.create('googlePayments')
            .priority('critical')
            .delay(jobStartDate.add({hours: 1}).toDate() - new Date())
            .attempts(5)
            .save(queueError => {
              return queueError ? done(queueError) : done();
            });
        }
      });
    });
  }
  console.log('Start fetching subscriptions due with Google Payments.');
  jobStartDate = moment.utc();
  nextScheduledCheck = moment.utc().add({days: 2});

  iap.setup(error => {
    if (error) {
      done(error);
    }
    findAffectedUsers();
  });
}
module.exports = function work (parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
};
