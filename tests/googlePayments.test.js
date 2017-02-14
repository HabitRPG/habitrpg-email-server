// @TODO Move the below to a global setup file
const chai = require('chai');
const sinon = require('sinon');
const iapModule = require('in-app-purchase');
const sinonStubPromise = require('sinon-stub-promise');
sinonStubPromise(sinon);
const expect = chai.expect;
const kue = require('kue'),
  monk = require('monk'),
  nconf = require('nconf');

nconf
  .argv()
  .env()
  .file({ file: __dirname + '/../config.json' });

const db = monk(nconf.get('MONGODB_URL'));

const kueRedisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST')
};

const queue = kue.createQueue({
  disableSearch: true,
  redis: kueRedisOpts
});

// @TODO Move the above to a global setup file

const moment = require('moment');
const googlePayments = require('../libs/googlePayments');
const NUMBER_OF_USERS = 20;

function generateUsers (usersCollection, jobStartDate)
{
  console.log(jobStartDate.toDate());
  let usersToInsert = [];
  for (let i = 0; i < NUMBER_OF_USERS; i += 1) {
    usersToInsert.push({
      purchased: { plan: {
        paymentMethod: 'Google',
        dateTerminated: null,
        planId: "basic_3mo",
        nextPaymentProcessing: jobStartDate.toDate()
      } },
    });
  }

  return usersCollection.insert(usersToInsert);
};

describe('GooglePayments', function () {
  let users, usersCollection;

  let iapValidateStub, iapIsValidatedStub, iapGetPurchaseDataStub;

  beforeEach(function (done) {
    let jobStartDate = moment.utc();

    iapValidateStub = sinon.stub(googlePayments, 'iapValidate')
      .returnsPromise().resolves({});
    iapIsValidatedStub = sinon.stub(iapModule, 'isValidated')
      .returns(true);

    iapGetPurchaseDataStub = sinon.stub(iapModule, 'getPurchaseData')
      .returns([{expirationDate: jobStartDate.clone().add({day: 1}).toDate()}]);

    usersCollection = db.get('users');
    generateUsers(usersCollection, jobStartDate)
      .then (function (doc) {
        users = doc;
        done();
      });
  });

  afterEach(function() {
    usersCollection.remove({});
    sinon.restore(iapModule.validate);
    sinon.restore(iapModule.isValidated);
    sinon.restore(iapModule.ggetPurchaseData)
  });

  it('processes all users', function (done) {
    googlePayments.findAffectedUsers(usersCollection, null, moment.utc(), moment.utc().add({days: 7})).
      then(() => {
      expect(iapValidateStub.callCount).equals(NUMBER_OF_USERS);
      done();
    }).catch(err => { // The processing errored, crash the job and log the error
        done(err);
      });
  });
});
