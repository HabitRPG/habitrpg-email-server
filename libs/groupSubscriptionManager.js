import { v4 } from 'uuid';
import moment from 'moment';

var db, queue, amazonPayment, request, done, habitrpgUsers, jobStartDate, habitGroups, isLastDayOfMonth, oneMonthAgo;

var paymentDescription = 'Group Subscription Payment';

var plan = {
  price: 3,
  quantity: 3,
};
var pageLimit = 10;

var SUBSCRIPTION_CANCEL_URL = 'https://habitica.com/amazon/subscribe/cancel';

function cancelSubscription(group)
{
  return new Promise(function (fulfill, reject){
    habitrpgUsers.findOne({ _id: group.leader }, { castIds: false, fields: ['_id', 'apiToken'] })
      .then(function (user) {
        request({
          url: SUBSCRIPTION_CANCEL_URL,
          method: 'GET',
          qs: {
            noRedirect: 'true',
            groupId: group._id,
          },
          headers: {
            'x-api-user': user._id,
            'x-api-key': user.apiToken,
          },
        }, function(error, response, body) {
          console.log('error cancelling', error, body);
          if (error) reject(error);
          else fulfill(response);
        });
      });
  });
}

function chargeGroup (group)
{
  var price = plan.price * (plan.quantity + group.memberCount - 1);

  return amazonPayment.authorizeOnBillingAgreement({
    AmazonBillingAgreementId: group.purchased.plan.customerId,
    AuthorizationReferenceId: v4().substring(0, 32),
    AuthorizationAmount: {
      CurrencyCode: 'USD',
      Amount: price,
    },
    SellerAuthorizationNote: paymentDescription,
    TransactionTimeout: 0,
    CaptureNow: true,
    SellerNote: paymentDescription,
    SellerOrderAttributes: {
      SellerOrderId: v4(),
      StoreName: 'Habitica'
    }
  })
  .then(function(response) {
    // TODO should expire only in case of failed payment
    // otherwise retry
    if (response.AuthorizationDetails.AuthorizationStatus.State === 'Declined') {
      console.log('Cancelling', group._id, group.purchased.plan.customerId, response);
      return cancelSubscription(group);
    }

    return habitGroups.update(
      { _id: group._id },
      { $set: { 'purchased.plan.lastBillingDate': jobStartDate.toDate() } },
      { castIds: false }
    );
  })
  .catch((err) => {
    console.log('Cancelling', group._id, group.purchased.plan.customerId, err);
    return cancelSubscription(group);
  });
}

function processGroupsWithAmazonPayment(groups)
{
  if (groups.length === 0) {
    return;
  }

  var groupPaymentPromises = groups.map(function(group) {
     return chargeGroup(group);
  });

  Promise.all(groupPaymentPromises)
    .then(function () {
      if (groups.length === pageLimit) {
        var lastGroup = groups[groups.length - 1];
        chargeAmazonGroups(lastGroup._id);
      }
    })
    .catch(function (err) {
      done(err);
      console.log(err);
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
function init(dbInc, queueInc, doneInc, amazonPaymentInc, requestInc)
{
  db = dbInc;
  queue = queueInc;
  done = doneInc;
  amazonPayment = amazonPaymentInc;
  request = requestInc;

  jobStartDate = moment.utc();
  isLastDayOfMonth = jobStartDate.daysInMonth() === jobStartDate.date();
  oneMonthAgo = moment.utc(jobStartDate).subtract(1, 'months');
  if (isLastDayOfMonth) {
    // If last day of month, substract one month an go at last day of previous
    // So if it's Feb 28th, we go to January 31th
    oneMonthAgo = oneMonthAgo.date(oneMonthAgo.daysInMonth());
  }

  habitGroups = db.get('groups', { castIds: false });
  habitrpgUsers = db.get('users', { castIds: false });
  chargeAmazonGroups();
}

export default init;
