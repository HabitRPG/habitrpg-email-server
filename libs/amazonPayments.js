import nconf from 'nconf';
import { connect, Environment } from 'amazon-payments';
import bluebird from 'bluebird';

// TODO better handling of errors

var IS_PROD = nconf.get('NODE_ENV') === 'production';

var amzPayment = connect({
  environment: Environment[IS_PROD ? 'Production' : 'Sandbox'],
  sellerId: nconf.get('AMAZON_PAYMENTS_SELLER_ID'),
  mwsAccessKey: nconf.get('AMAZON_PAYMENTS_MWS_KEY'),
  mwsSecretKey: nconf.get('AMAZON_PAYMENTS_MWS_SECRET'),
  clientId: nconf.get('AMAZON_PAYMENTS_CLIENT_ID')
});

var getTokenInfo = bluebird.promisify(amzPayment.api.getTokenInfo, {context: amzPayment.api});
var createOrderReferenceId = bluebird.promisify(amzPayment.offAmazonPayments.createOrderReferenceForId, {context: amzPayment.offAmazonPayments});
var setOrderReferenceDetails = bluebird.promisify(amzPayment.offAmazonPayments.setOrderReferenceDetails, {context: amzPayment.offAmazonPayments});
var confirmOrderReference = bluebird.promisify(amzPayment.offAmazonPayments.confirmOrderReference, {context: amzPayment.offAmazonPayments});
var closeOrderReference = bluebird.promisify(amzPayment.offAmazonPayments.closeOrderReference, {context: amzPayment.offAmazonPayments});
var setBillingAgreementDetails = bluebird.promisify(amzPayment.offAmazonPayments.setBillingAgreementDetails, {context: amzPayment.offAmazonPayments});
var getBillingAgreementDetails = bluebird.promisify(amzPayment.offAmazonPayments.getBillingAgreementDetails, {context: amzPayment.offAmazonPayments});
var confirmBillingAgreement = bluebird.promisify(amzPayment.offAmazonPayments.confirmBillingAgreement, {context: amzPayment.offAmazonPayments});
var closeBillingAgreement = bluebird.promisify(amzPayment.offAmazonPayments.closeBillingAgreement, {context: amzPayment.offAmazonPayments});

var authorizeOnBillingAgreement = (inputSet) => {
  return new Promise((resolve, reject) => {
    amzPayment.offAmazonPayments.authorizeOnBillingAgreement(inputSet, (err, response) => {
      if (err) return reject(err);
      if (response.AuthorizationDetails.AuthorizationStatus.State === 'Declined') return reject();
      return resolve(response);
    });
  });
};

var authorize = (inputSet) => {
  return new Promise((resolve, reject) => {
    amzPayment.offAmazonPayments.authorize(inputSet, (err, response) => {
      if (err) return reject(err);
      if (response.AuthorizationDetails.AuthorizationStatus.State === 'Declined') return reject();
      return resolve(response);
    });
  });
};

export default {
  getTokenInfo,
  createOrderReferenceId,
  setOrderReferenceDetails,
  confirmOrderReference,
  closeOrderReference,
  confirmBillingAgreement,
  getBillingAgreementDetails,
  setBillingAgreementDetails,
  closeBillingAgreement,
  authorizeOnBillingAgreement,
  authorize,
};
