var async = require('async');
var uuid = require('uuid');
var moment = require('moment');
var request = require('request');

var amazonPayment = require('../libs/amazonPayments');

var db, queue, habitrpgUsers, jobStartDate, habitGroups;

var plan = {
  price: 3,
  quantity: 3,
};
var pageLimit = 10;

var SUBSCRIPTION_CANCEL_URL = 'https://habitica.com/amazon/subscribe/cancel';

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

function cancelSubscription(group)
{
  habitrpgUsers.findOne({ _id: group.leader }, { castIds: false })
    .then(function (user) {

      request({
        url: SUBSCRIPTION_CANCEL_URL = '?groupId=' + group._id,
        method: 'GET',
        qs: {
          noRedirect: 'true',
          _id: user._id,
          apiToken: user.apiToken
        }
      }, function(error, response, body) {
        console.log('error cancelling', error, body);
      });
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
      cancelSubscription(group);
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
    console.log(err);
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
    chargeGroup(group);
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
    fields: ['_id', 'purchased.plan', 'memberCount', 'leader']
  })
  .then(processGroupsWithAmazonPayment)
  .catch(function (err) {
    console.log(err);
  });
}

//@TODO: Constructor?
function setUp(dbInc, queueInc)
{
  db = dbInc;
  queue = queueInc;

  jobStartDate = moment.utc();
  isLastDayOfMonth = jobStartDate.daysInMonth() === jobStartDate.date();
  oneMonthAgo = moment.utc(jobStartDate).subtract(1, 'months');
  if (isLastDayOfMonth) {
    // If last day of month, substract one month an go at last day of previous
    // So if it's Feb 28th, we go to January 31th
    oneMonthAgo = oneMonthAgo.date(oneMonthAgo.daysInMonth());
  }

  habitGroups = db.get('groups');
  habitrpgUsers = db.get('users');
  chargeAmazonGroups();
}

module.exports = {
  setUp: setUp,
  chargeAmazonGroups: chargeAmazonGroups,
  processGroupsWithAmazonPayment: processGroupsWithAmazonPayment,
  chargeGroup: chargeGroup,
  cancelSubscription: cancelSubscription,
};
