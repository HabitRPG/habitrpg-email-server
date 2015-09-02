var amazonPayments = require('amazon-payments');
var uuid = require('uuid');
var nconf = require('nconf');
var moment = require('moment');
var request = require('request');
var async = require('async');

// Defined later
var db, queue, habitrpgUsers;

// TODO fetch from api
var subscriptionBlocks = {
  basic_earned: {months:1, price:5},
  basic_3mo: {months:3, price:15},
  basic_6mo: {months:6, price:30},
  google_6mo: {months:6, price:24, discount:true, original:30},
  basic_12mo: {months:12, price:48}
};

var amzPayment = amazonPayments.connect({
  environment: amazonPayments.Environment[nconf.get('NODE_ENV') === 'production' ? 'Production' : 'Sandbox'],
  sellerId: nconf.get('AMAZON_PAYMENTS_SELLER_ID'),
  mwsAccessKey: nconf.get('AMAZON_PAYMENTS_MWS_KEY'),
  mwsSecretKey: nconf.get('AMAZON_PAYMENTS_MWS_SECRET'),
  clientId: nconf.get('AMAZON_PAYMENTS_CLIENT_ID')
});

var worker = function(job, done){
  habitrpgUsers = db.get('users');

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

        console.log('AMAZON PAYMENTS, found n users', docs.length, docs)

        // When there are no users to process, schedule next job & end this one
        if(docs.length === 0){
          queue.create('amazonPayments')
          .priority('critical')
          .delay(jobStartDate.add({hours: 1}).toDate() - new Date())
          .attempts(5)
          .save(function(err){
            return err ? done(err) : done();
          });

          return;
        }

        lastId = docs.length > 0 ? docs[docs.length - 1]._id : null;

        async.eachSeries(docs, function(user, cb){
          try{
            console.log('Processing', user._id);
            var plan = subscriptionBlocks[user.purchased.plan.planId];
            var lastBillingDate = moment.utc(user.purchased.plan.lastBillingDate);

            if(!plan){
              return cb(new Error('Plan ' + user.purchased.plan.planId + ' does not exists. User ' + user._id))
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
                console.log('returning because not this month')
                return cb();
              }
            }
            
            amzPayment.offAmazonPayments.authorizeOnBillingAgreement({
              AmazonBillingAgreementId: user.purchased.plan.customerId,
              AuthorizationReferenceId: uuid.v4().substring(0, 32),
              AuthorizationAmount: {
                CurrencyCode: 'USD',
                Amount: plan.price
              },
              SellerAuthorizationNote: 'Habitica Subscription Payment',
              TransactionTimeout: 0,
              CaptureNow: true,
              SellerNote: 'Habitica Subscription Payment',
              SellerOrderAttributes: {
                SellerOrderId: uuid.v4(),
                StoreName: 'Habitica'
              }
            }, function(err, amzRes){
              // TODO should expire only in case of failed payment
              // otherwise retry
              if(err || amzRes.AuthorizationDetails.AuthorizationStatus.State === 'Declined'){
                // Cancel the subscription on main server

                return request({
                  url: 'https://habitica.com/amazon/subscribe/cancel',
                  method: 'GET',
                  qs: {
                    noRedirect: 'true',
                    _id: user._id,
                    apiToken: user.apiToken
                  }
                }, function(error, response){
                  // FIXME do we want to send an error here? just at the beginning to check
                  if(!error && response.statusCode === 200){
                    return cb(err);
                  }

                  return cb(error);
                });

              }

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
            });

          }catch(e){
            //TODO mark subscription as expired?
            console.error(e, 'ERROR PROCESSING AMAZON PAYMENT for user ', user._id);
            cb(e);
          }
        }, function(err){
          if(err) return done(err);
          if(docs.length === 10){
            findAffectedUsers();
          }else{
            queue.create('amazonPayments')
            .priority('critical')
            .delay(jobStartDate.add({hours: 1}).toDate() - new Date())
            .attempts(5)
            .save(function(err){
              return err ? done(err) : done();
            });
          }
        });
    });
  }

  console.log('Start fetching subscriptions due with Amazon Payments.');
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

module.exports = function(parentQueue, parentDb){
  // Pass db and queue from parent module
  db = parentDb; 
  queue = parentQueue;
  
  return worker;
}
