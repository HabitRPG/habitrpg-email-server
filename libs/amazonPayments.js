var nconf = require('nconf');
var amazonPayments = require('amazon-payments');
var Bluebird = require('bluebird');

// TODO better handling of errors

var IS_PROD = nconf.get('NODE_ENV') === 'production';

var amzPayment = amazonPayments.connect({
  environment: amazonPayments.Environment[IS_PROD ? 'Production' : 'Sandbox'],
  sellerId: nconf.get('AMAZON_PAYMENTS:SELLER_ID'),
  mwsAccessKey: nconf.get('AMAZON_PAYMENTS:MWS_KEY'),
  mwsSecretKey: nconf.get('AMAZON_PAYMENTS:MWS_SECRET'),
  clientId: nconf.get('AMAZON_PAYMENTS:CLIENT_ID'),
});

var getTokenInfo = Bluebird.promisify(amzPayment.api.getTokenInfo, {context: amzPayment.api});
var createOrderReferenceId = Bluebird.promisify(amzPayment.offAmazonPayments.createOrderReferenceForId, {context: amzPayment.offAmazonPayments});
var setOrderReferenceDetails = Bluebird.promisify(amzPayment.offAmazonPayments.setOrderReferenceDetails, {context: amzPayment.offAmazonPayments});
var confirmOrderReference = Bluebird.promisify(amzPayment.offAmazonPayments.confirmOrderReference, {context: amzPayment.offAmazonPayments});
var closeOrderReference = Bluebird.promisify(amzPayment.offAmazonPayments.closeOrderReference, {context: amzPayment.offAmazonPayments});
var setBillingAgreementDetails = Bluebird.promisify(amzPayment.offAmazonPayments.setBillingAgreementDetails, {context: amzPayment.offAmazonPayments});
var getBillingAgreementDetails = Bluebird.promisify(amzPayment.offAmazonPayments.getBillingAgreementDetails, {context: amzPayment.offAmazonPayments});
var confirmBillingAgreement = Bluebird.promisify(amzPayment.offAmazonPayments.confirmBillingAgreement, {context: amzPayment.offAmazonPayments});
var closeBillingAgreement = Bluebird.promisify(amzPayment.offAmazonPayments.closeBillingAgreement, {context: amzPayment.offAmazonPayments});

var authorizeOnBillingAgreement = (inputSet) => {
  return new Promise((resolve, reject) => {
    amzPayment.offAmazonPayments.authorizeOnBillingAgreement(inputSet, (err, response) => {
      if (err) return reject(err);
      if (response.AuthorizationDetails.AuthorizationStatus.State === 'Declined') return reject());
      return resolve(response);
    });
  });
};

var authorize = (inputSet) => {
  return new Promise((resolve, reject) => {
    amzPayment.offAmazonPayments.authorize(inputSet, (err, response) => {
      if (err) return reject(err);
      if (response.AuthorizationDetails.AuthorizationStatus.State === 'Declined') return reject());
      return resolve(response);
    });
  });
};

module.exports = {
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
