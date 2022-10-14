import moment from 'moment';
import util from 'util';
import paypalSDK from 'paypal-rest-sdk';
import nconf from 'nconf';
import { blocks } from '../subscriptions.js';

const BILLING_AGREEMENT_TO_SKIP = nconf.get('PAYPAL_BILLING_AGREEMENT_TO_SKIP');

const paypal = {};
paypal.getBillingAgreement = util.promisify(paypalSDK.billingAgreement.get.bind(paypalSDK.billingAgreement));

function processUser (habitrpgUsers, job, user, queue, baseUrl, jobStartDate) {
  const plan = blocks[user.purchased.plan.planId];

  // Users with free subscriptions
  if (user.purchased.plan.customerId === 'habitrpg') return false;

  // Skip a billing agreement currently unavailable for processing due to a Paypal bug
  if (BILLING_AGREEMENT_TO_SKIP && user.purchased.plan.customerId === BILLING_AGREEMENT_TO_SKIP) return false;

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exist. User ${user._id}`);
  }

  const billingAgreementId = user.purchased.plan.customerId;

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

    if (billingAgreement.state !== 'active' && billingAgreement.state !== 'Active') {
      const err = new Error(`User ${user._id} with billing agreement ${billingAgreementId} does not have any active plan. See`);
      err.billingAgreement = billingAgreement;
      throw err;
    }

    const nextBillingDate = moment(new Date(billingAgreement.agreement_details.next_billing_date));

    if (common.isInReminderRange(jobStartDate, nextBillingDate)) {
      return api.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
    }
    return false;
  }).catch(err => {
    // Catch and ignore errors due to having an account using Paypal sandbox mode
    if (
      err && err.httpStatusCode === 400
      && err.response.name === 'MERCHANT_ACCOUNT_DENIED'
      && err.response.message && err.response.message.indexOf('Profile ID is not valid for this account.  Please resubmit') !== -1) {
      console.log(`SANDBOX ${user._id} with billing agreement ${billingAgreementId}`);
    } else {
      console.log(`ERROR ${user._id} with billing agreement ${billingAgreementId}`);
      throw err;
    }
  });
};

export {
  processUser,
};
