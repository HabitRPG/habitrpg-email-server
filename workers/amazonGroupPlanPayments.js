var nconf = require('nconf');
var monk = require('monk');

nconf
  .argv()
  .env()
  .file({ file: __dirname + '/../config.json' });

var db = monk(nconf.get('MONGODB_URL'));
// @TODO: Remove above

var async = require('async');
var uuid = require('uuid');
var moment = require('moment');
var ObjectId = require('mongodb').ObjectID;
var amazonPayment = require('../libs/amazonPayments');

var plan = {
  price: 3,
  quantity: 3,
};
var pageLimit = 10;

var db, queue, habitrpgUsers, jobStartDate;

function scheduleNextQueue()
{
  queue.create('amazonGroupPlanPayments')
  .priority('critical')
  .delay(jobStartDate.add({hours: 1}).toDate() - new Date())
  .attempts(5)
  .save(function(err){
    return err ? done(err) : done();
  });
}

function cancelSubscription()
{
  // Cancel the subscription on main server
  console.log('Cancelling', user._id, user.purchased.plan.customerId, amzRes);
  request({
    url: 'https://habitica.com/amazon/subscribe/cancel',
    method: 'GET',
    qs: {
      noRedirect: 'true',
      _id: user._id,
      apiToken: user.apiToken
    }
  }, function(error, response, body){
    console.log('error cancelling', error, body);
    // FIXME do we want to send an error here? just at the beginning to check
    if(!error && response.statusCode === 200){
      return cb(error);
    }

    cb(error || body); // if there's an error or response.statucCode !== 200
  });
}

function chargeGroup (group)
{
  var price = plan.price * (plan.quantity + group.memberCount - 1);

  amazonPayment.authorizeOnBillingAgreement({
    AmazonBillingAgreementId: group.purchased.plan.customerId,
    AuthorizationReferenceId: uuid.v4().substring(0, 32),
    AuthorizationAmount: {
      CurrencyCode: 'USD',
      Amount: price,
    },
    SellerAuthorizationNote: 'Habitica Subscription Payment',
    TransactionTimeout: 0,
    CaptureNow: true,
    SellerNote: 'Habitica Subscription Payment',
    SellerOrderAttributes: {
      SellerOrderId: uuid.v4(),
      StoreName: 'Habitica'
    }
  })
  .then(function(response) {
    // TODO should expire only in case of failed payment
    // otherwise retry

    if (response.AuthorizationDetails.AuthorizationStatus.State === 'Declined') {
      cancelSubscription();
      return;
    }

    return habitGroups.update(
      { _id: group._id },
      { $set: { 'purchased.plan.lastBillingDate': jobStartDate.toDate() } },
      { castIds: false }
    );
  })
  .then(function (result) {
    console.log(result);
  })
  .catch(function (err) {
    console.log("sdf", err);
    //@TODO: Check for cancel error
    //  cancelSubscription()
  });
}

function processGroupsWithAmazonPayment(groups)
{
  if (groups.length === 0) {
    scheduleNextQueue();
    return;
  }

  async.eachSeries(groups, function iteratee(group, callback) {
    console.log(group.purchased.plan.lastBillingDate)
    chargeGroup(group, callback);
    callback();
  }, function done() {
    if (groups.length === pageLimit) {
      var lastGroup = groups[groups.length - 1];
      chargeAmazonGroups(lastGroup._id);
    } else {
      scheduleNextQueue();
    }
  });
};

function chargeAmazonGroups(lastId)
{
  var query = {
    'purchased.plan.paymentMethod': 'Amazon Payments',
    'purchased.plan.dateTerminated': null, // TODO use $type 10?,
    'purchased.plan.lastBillingDate': {
      $lte: oneMonthAgo.toDate()
    },
  };

  if (lastId) {
    query._id = {
      $gt: lastId
    }
  }

  habitGroups.find(query, {
    sort: {_id: 1},
    limit: pageLimit,
    fields: ['_id', 'purchased.plan', 'memberCount']
  })
  .then(processGroupsWithAmazonPayment)
  .catch(function (err) {
    console.log(err);
  });
}

var worker = function(job, done)
{
  jobStartDate = moment.utc();
  isLastDayOfMonth = jobStartDate.daysInMonth() === jobStartDate.date();
  oneMonthAgo = moment.utc(jobStartDate).subtract(1, 'months');
  if (isLastDayOfMonth) {
    // If last day of month, substract one month an go at last day of previous
    // So if it's Feb 28th, we go to January 31th
    oneMonthAgo = oneMonthAgo.date(oneMonthAgo.daysInMonth());
  }

  habitGroups = db.get('groups');
  chargeAmazonGroups();
  done();
}

worker(null, function () {
  console.log("Done")
});

module.exports = function(parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
}
