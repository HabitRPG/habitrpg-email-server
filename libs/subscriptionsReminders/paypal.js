import moment from 'moment';
import util from 'util';
import paypalSDK from 'paypal-rest-sdk';
import nconf from 'nconf';
import { getToData, getPersonalVariables } from '../email.js';
import { blocks } from '../subscriptions.js';

const BILLING_AGREEMENT_TO_SKIP = nconf.get('PAYPAL_BILLING_AGREEMENT_TO_SKIP');

const USERS_BATCH = 1; // because paypal has an aggressive rate limiting

const paypal = {};
paypal.getBillingAgreement = util.promisify(paypalSDK.billingAgreement.get.bind(paypalSDK.billingAgreement));

const api = {};

api.scheduleNextCheckForUser = function scheduleNextCheckForUser (habitrpgUsers, user) {
  return habitrpgUsers.update(
    {
      _id: user._id,
    },
    {
      $set: {
        'purchased.plan.lastReminderDate': moment().toDate(),
      },
    },
  );
};

api.sendEmailReminder = function sendEmailReminder (user, plan, queue, baseUrl, habitrpgUsers) {
  return new Promise((resolve, reject) => {
    const toData = getToData(user);
    const personalVariables = getPersonalVariables(toData);
    personalVariables[0].vars.push({
      name: 'SUBSCRIPTION_PRICE',
      content: plan.price,
    });

    if (
      user.preferences.emailNotifications.unsubscribeFromAll !== true
      && user.preferences.emailNotifications.subscriptionReminders !== false
    ) {
      queue.create('email', {
        emailType: 'subscription-renewal',
        to: [toData],
        // Manually pass BASE_URL as emails are sent from here and not from the main server
        variables: [{ name: 'BASE_URL', content: baseUrl }],
        personalVariables,
      })
        .priority('high')
        .attempts(5)
        .backoff({ type: 'fixed', delay: 30 * 60 * 1000 }) // try again after 30 minutes
        .save(err => {
          if (err) return reject(err);
          return resolve();
        });
    } else {
      resolve();
    }
  }).then(() => api.scheduleNextCheckForUser(habitrpgUsers, user));
};

api.processUser = function processUser (habitrpgUsers, user, queue, baseUrl, jobStartDate) {
  const plan = blocks[user.purchased.plan.planId];

  // Users with free subscriptions
  if (user.purchased.plan.customerId === 'habitrpg') return false;

  // Skip a billing agreement currently unavailable for processing due to a Paypal bug
  if (BILLING_AGREEMENT_TO_SKIP && user.purchased.plan.customerId === BILLING_AGREEMENT_TO_SKIP) return false;

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User ${user._id}`);
  }

  const billingAgreementId = user.purchased.plan.customerId;

  // console.log('billing agreement id', billingAgreementId, 'for user', user._id, user.auth.local.username);
  return paypal.getBillingAgreement(billingAgreementId).then(billingAgreement => {
    /* EXAMPLE DATA (omissed stuff we don't care about)
        DOCS at https://developer.paypal.com/docs/api/payments.billing-agreements/v1/#billing-agreements_get
        {
      "id": "I-1TJ3GAGG82Y9",
      "state": "Active",
      "start_date": "2016-12-23T08:00:00Z",
      "agreement_details": {
        "outstanding_balance": {
          "currency": "USD",
          "value": "0.00"
        },
        "cycles_remaining": "2",
        "cycles_completed": "0",
        "next_billing_date": "2017-01-23T08:00:00Z",
        "last_payment_date": "2016-12-23T08:00:00Z",
        "last_payment_amount": {
          "currency": "USD",
          "value": "0.40"
        },
        "final_payment_date": "2017-09-23T08:00:00Z",
        "failed_payment_count": "0"
      }
    }
    */

    // console.log('subscription data', billingAgreement);
    if (billingAgreement.state !== 'active' && billingAgreement.state !== 'Active') {
      const err = new Error(`User ${user._id} with billing agreement ${billingAgreementId} does not have any active plan. See`);
      err.billingAgreement = billingAgreement;
      throw err;
      // console.log(`${user._id} with billing agreement ${billingAgreementId}`);
      // return;
    }

    const nextBillingDate = moment(new Date(billingAgreement.agreement_details.next_billing_date));

    const startDate = moment(jobStartDate.toDate()).add({
      days: 6,
      hours: 12,
    }).toDate();

    const endDate = moment(jobStartDate.toDate()).add({
      days: 7,
      hours: 12,
    }).toDate();

    // console.log(
    //  'Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate,
    //  'last billing date', moment(new Date(billingAgreement.agreement_details.last_payment_date)).toString(),
    //  'last amount paid', billingAgreement.agreement_details.last_payment_amount,
    //  'next date', nextBillingDate.toString());
    // console.log('Plan', plan);

    if (nextBillingDate.isAfter(startDate) && nextBillingDate.isBefore(endDate)) {
      // console.log('would send email!\n\n\n\n');
      return api.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
    }
    return false;
    // console.log('would not send email');
  }).catch(err => {
    // Catch and ignore errors due to having an account using Paypal sandbox mode
    if (
      err && err.httpStatusCode === 400
      && err.response.name === 'MERCHANT_ACCOUNT_DENIED'
      && err.response.message && err.response.message.indexOf('Profile ID is not valid for this account.  Please resubmit') !== -1) {
      console.log(`SANDBOX ${user._id} with billing agreement ${billingAgreementId}`);

    /* } else if (
      err && err.httpStatusCode === 400 &&
      err.response.name === 'INVALID_PROFILE_ID') {
      console.log(`INVALID ${user._id} with billing agreement ${billingAgreementId}`);
      return; */
    } else {
      console.log(`ERROR ${user._id} with billing agreement ${billingAgreementId}`);
      throw err;
    }
  });
};

const findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  const query = {
    'purchased.plan.paymentMethod': 'Paypal',
    'purchased.plan.dateTerminated': null,
    // Where lastReminderDate is not recent (25 days to be sure?) or doesn't exist
    $or: [{
      'purchased.plan.lastReminderDate': {
        $lte: moment(jobStartDate.toDate()).subtract(25, 'days').toDate(),
      },
    }, {
      'purchased.plan.lastReminderDate': null,
    }],
  };

  if (lastId) {
    query._id = {
      $gt: lastId,
    };
  }

  console.log('Run query', query);

  let usersFoundNumber;
  let newLastId;

  return habitrpgUsers.find(query, {
    sort: { _id: 1 },
    limit: USERS_BATCH,
    fields: ['_id', 'auth', 'profile', 'purchased.plan', 'preferences'],
  })
    .then(users => {
      console.log('Paypal Reminders: Found n users', users.length);
      usersFoundNumber = users.length;
      newLastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => api.processUser(habitrpgUsers, user, queue, baseUrl, jobStartDate)));
    }).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        return findAffectedUsers(habitrpgUsers, newLastId, jobStartDate, queue, baseUrl);
      }
      return true;
    });
};

export {
  findAffectedUsers,
};
