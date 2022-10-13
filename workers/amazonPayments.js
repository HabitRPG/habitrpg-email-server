import { connect, Environment } from 'amazon-payments';
import { v4 } from 'uuid';
import nconf from 'nconf';
import moment from 'moment';
import request from 'request';
import { eachSeries } from 'async';
import subscriptions from '../libs/subscriptions.js';
const BASE_URL = nconf.get('BASE_URL');

// Defined later
var db, queue, habitrpgUsers;

var amzPayment = connect({
  environment: Environment[nconf.get('NODE_ENV') === 'production' ? 'Production' : 'Sandbox'],
  sellerId: nconf.get('AMAZON_PAYMENTS_SELLER_ID'),
  mwsAccessKey: nconf.get('AMAZON_PAYMENTS_MWS_KEY'),
  mwsSecretKey: nconf.get('AMAZON_PAYMENTS_MWS_SECRET'),
  clientId: nconf.get('AMAZON_PAYMENTS_CLIENT_ID')
});

var worker = function(job, done){
  habitrpgUsers = db.get('users', { castIds: false });

  var jobStartDate, oneMonthAgo, isLastDayOfMonth;
  var lastId;

  var findAffectedUsers = function(){
    var query = {
      'purchased.plan.paymentMethod': 'Amazon Payments',
      'purchased.plan.dateTerminated': null, // TODO use $type 10?

      'purchased.plan.lastBillingDate': {
        $lte: oneMonthAgo.toDate()
      }
    };

    if(lastId){
      query._id = {
        $gt: lastId
      }
    }

    console.log('Run query', query);

    habitrpgUsers.find(query, {
      sort: {_id: 1},
      limit: 10,
      fields: ['_id', 'apiToken', 'purchased.plan']
    }, function(err, docs){
        if(err) return done(err);

        // When there are no users to process, schedule next job & end this one
        if(docs.length === 0){
          done();
          return;
        }

        lastId = docs.length > 0 ? docs[docs.length - 1]._id : null;

        eachSeries(docs, function(user, cb){
          try{
            // console.log('Processing', user._id);
            var plan = subscriptions.blocks[user.purchased.plan.planId];
            var lastBillingDate = moment.utc(user.purchased.plan.lastBillingDate);

            if(!plan){
              throw new Error('Plan ' + user.purchased.plan.planId + ' does not exist. User ' + user._id);
            }

            // For diff() to work we must adjust the number of days in case oneMonthAgo has less
            // days than lastBillingDate, just for more than 1 month plans
            // because for them it's already adjusted
            if(plan.months !== 1){
              if(oneMonthAgo.daysInMonth() === oneMonthAgo.date() &&
                lastBillingDate.daysInMonth() > oneMonthAgo.daysInMonth()) {

                  lastBillingDate.date(oneMonthAgo.date());

              }

              // We check plan.months - 1 because we're comparing with one month ago
              if(oneMonthAgo.diff(lastBillingDate, 'months') < (plan.months - 1)){
                // console.log('returning because not this month')
                return cb();
              }
            }

            amzPayment.offAmazonPayments.authorizeOnBillingAgreement({
              AmazonBillingAgreementId: user.purchased.plan.customerId,
              AuthorizationReferenceId: v4().substring(0, 32),
              AuthorizationAmount: {
                CurrencyCode: 'USD',
                Amount: plan.price
              },
              SellerAuthorizationNote: 'Habitica Subscription Payment',
              TransactionTimeout: 0,
              CaptureNow: true,
              SellerNote: 'Habitica Subscription Payment',
              SellerOrderAttributes: {
                SellerOrderId: v4(),
                StoreName: 'Habitica'
              }
            }, function(err, amzRes){
              // TODO should expire only in case of failed payment
              // otherwise retry
              if(err || amzRes.AuthorizationDetails.AuthorizationStatus.State === 'Declined'){
                // Cancel the subscription on main server

                console.log('Cancelling', user._id, user.purchased.plan.customerId, amzRes);
                request({
                  url: BASE_URL+'/amazon/subscribe/cancel',
                  method: 'GET',
                  qs: {
                    noRedirect: 'true',
                  },
                  headers: {
                    'x-api-user': user._id,
                    'x-api-key': user.apiToken,
                  },
                }, function(error, response, body){
                  console.log('error cancelling', error, body);
                  // FIXME do we want to send an error here? just at the beginning to check
                  if(!error && response.statusCode === 200){
                    return cb(error);
                  }

                  cb(error || body); // if there's an error or response.statucCode !== 200
                });
              } else {
                habitrpgUsers.update(
                  {
                    _id: user._id
                  },
                  {
                    $set: {
                      'purchased.plan.lastBillingDate': jobStartDate.toDate()
                    }
                  }, function(e){
                    if(e) return cb(e);

                    return cb();
                  });
              }
            });

          }catch(e){
            //TODO mark subscription as expired?
            console.error(e, 'ERROR PROCESSING AMAZON PAYMENT for user ', user._id);
            cb(e);
          }
        }, function(err){
          console.log('terminating', err);
          if(err) return done(err);
          if(docs.length === 10){
            findAffectedUsers();
          }
        });
    });
  }

  jobStartDate = moment.utc();
  isLastDayOfMonth = jobStartDate.daysInMonth() === jobStartDate.date();

  oneMonthAgo = moment.utc(jobStartDate).subtract(1, 'months');

  if(isLastDayOfMonth){
    // If last day of month, substract one month an go at last day of previous
    // So if it's Feb 28th, we go to January 31th
    oneMonthAgo = oneMonthAgo.date(oneMonthAgo.daysInMonth());
  }

  findAffectedUsers();
}

export default function(parentQueue, parentDb){
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
}
