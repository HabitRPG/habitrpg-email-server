// @TODO Move the below to a global setup file
const chai = require('chai');
const sinon = require('sinon');
const iapModule = require('in-app-purchase');
const requestModule = require('request');
const sinonStubPromise = require('sinon-stub-promise');
sinonStubPromise(sinon);
const expect = chai.expect;
const kue = require('kue')
const monk = require('monk')
const nconf = require('nconf');

nconf
  .argv()
  .env()
  .file({ file: __dirname + '/../config.json' });

const db = monk(nconf.get('MONGODB_URL'));

const moment = require('moment');
const applePayments = require('../libs/applePayments');
const NUMBER_OF_USERS = 20;

function generateUsers (usersCollection, jobStartDate)
{
  let usersToInsert = [];
  for (let i = 0; i < NUMBER_OF_USERS; i += 1) {
    usersToInsert.push({
      purchased: { plan: {
        paymentMethod: 'Apple',
        dateTerminated: null,
        planId: "basic_3mo",
        nextPaymentProcessing: jobStartDate.toDate()
      } },
    });
  }

  return usersCollection.insert(usersToInsert);
};

describe('ApplePayments', () => {
  let users, userIds, usersCollection;
  let jobStartDate, nextCheckDate;

  let iapValidateStub, iapIsValidatedStub, iapGetPurchaseDataStub, requestGetStub;

  beforeEach(done => {
    jobStartDate = moment.utc();
    nextCheckDate = jobStartDate.clone().add({days: 7});

    iapValidateStub = sinon.stub(applePayments, 'iapValidate')
      .returnsPromise().resolves({});
    iapIsValidatedStub = sinon.stub(iapModule, 'isValidated')
      .returns(true);

    requestGetStub = sinon.stub(requestModule, 'get')
      .yields(null, null, '');

    iapGetPurchaseDataStub = sinon.stub(iapModule, 'getPurchaseData')
      .returns([{expirationDate: jobStartDate.clone().add({day: 8}).toDate()}]);

    usersCollection = db.get('users', { castIds: false });
    generateUsers(usersCollection, jobStartDate)
      .then (doc => {
        users = doc;
        userIds = [];
        for (let index in users) {
          let user = users[index];
          userIds.push(user._id);
        }
        done();
      });
  });

  afterEach(() => {
    usersCollection.remove({ _id : { $in: userIds } });
    sinon.restore(applePayments.iapValidate);
    sinon.restore(iapModule.validate);
    sinon.restore(iapModule.isValidated);
    sinon.restore(iapModule.getPurchaseData);
    sinon.restore(requestModule.get);
  });

  it('processes all users', done => {
    applePayments.findAffectedUsers(usersCollection, null, jobStartDate, nextCheckDate).
      then(() => {
      expect(iapValidateStub.callCount).equals(NUMBER_OF_USERS);
      expect(requestGetStub.callCount).equals(0);
      usersCollection.find({ _id : { $in: userIds } }, {
        fields: ['_id', 'purchased.plan'],
      })
        .then(foundUsers => {
          for (let index in foundUsers) {
            let user = foundUsers[index];
            expect(nextCheckDate.isSame(moment(user.purchased.plan.nextPaymentProcessing), 'day')).equals(true);
          }
          done();
        }).catch(err => {
        done(err);
      });
    }).catch(err => { // The processing errored, crash the job and log the error
      done(err);
    });
  });

  it('cancels ended subscription', () => {
    let user = users[0];
    sinon.restore(iapModule.getPurchaseData);
    iapGetPurchaseDataStub = sinon.stub(iapModule, 'getPurchaseData')
      .returns([{expirationDate: jobStartDate.clone().subtract({day: 1}).toDate()}]);
    applePayments.processUser(usersCollection, user, jobStartDate, nextCheckDate).
    then(() => {
      expect(iapValidateStub.callCount).equals(1);
      expect(requestGetStub.callCount).equals(1);
      done();
    }).catch(err => { // The processing errored, crash the job and log the error
      done(err);
    });
  });

  it('should not check terminated subscriptions', () => {
    usersCollection.update(
      {_id: users[0]._id},
      {$set: {'purchased.plan.dateTerminated': moment.utc()}},
      {castIds: false}
    ).then(() => {
      applePayments.findAffectedUsers(usersCollection, null, jobStartDate, nextCheckDate)
        .then(() => {
          expect(iapValidateStub.callCount).equals(NUMBER_OF_USERS-1);
          expect(requestGetStub.callCount).equals(0);
        });
    });
  });

  it('should set earlier check date for ending subscriptions', () => {
    let user = users[0];
    let expectedDate = jobStartDate.clone().add({day: 1});
    sinon.restore(iapModule.getPurchaseData);
    iapGetPurchaseDataStub = sinon.stub(iapModule, 'getPurchaseData')
      .returns([{expirationDate: expectedDate}]);
    applePayments.processUser(usersCollection, user, jobStartDate, nextCheckDate).
    then(() => {
      expect(iapValidateStub.callCount).equals(1);
      expect(requestGetStub.callCount).equals(1);
      usersCollection.find({ _id : { $in: userIds } }, {
        fields: ['_id', 'purchased.plan'],
      })
        .then(foundUsers => {
          for (let index in foundUsers) {
            let user = foundUsers[index];
            expect(expectedDate.isSame(moment(user.purchased.plan.nextPaymentProcessing), 'day')).equals(true);
          }
          done();
        }).catch(err => {
        done(err);
      });
    }).catch(err => { // The processing errored, crash the job and log the error
      done(err);
    });
  });
});