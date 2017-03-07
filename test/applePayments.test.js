const iapModule = require('in-app-purchase');
const requestModule = require('request');
const monk = require('monk');
const nconf = require('nconf');
const moment = require('moment');
const applePayments = require('../libs/applePayments');

const db = monk(nconf.get('MONGODB_URL'));
const NUMBER_OF_USERS = 20;

function generateUsers (usersCollection, jobStartDate) {
  let usersToInsert = [];
  for (let i = 0; i < NUMBER_OF_USERS; i += 1) {
    usersToInsert.push({
      purchased: { plan: {
        paymentMethod: 'Apple',
        dateTerminated: null,
        planId: 'basic_3mo',
        nextPaymentProcessing: jobStartDate.toDate(),
      } },
    });
  }

  return usersCollection.insert(usersToInsert);
}

describe('ApplePayments', () => {
  let users, userIds;
  let jobStartDate, nextCheckDate;
  let iapValidateStub, requestGetStub;
  let usersCollection = db.get('users', { castIds: false });

  beforeEach(() => {
    jobStartDate = moment.utc();
    nextCheckDate = jobStartDate.clone().add({days: 7});

    iapValidateStub = sinon.stub(applePayments, 'iapValidate').returnsPromise().resolves({});
    sinon.stub(iapModule, 'isValidated').returns(true);

    requestGetStub = sinon.stub(requestModule, 'get')
      .yields(null, {statusCode: 200}, '');

    sinon.stub(iapModule, 'getPurchaseData')
      .returns([{expirationDate: jobStartDate.clone().add({day: 8}).toDate()}]);

    return generateUsers(usersCollection, jobStartDate).then(doc => {
      users = doc;
      userIds = [];
      for (let index in users) {
        let user = users[index];
        userIds.push(user._id);
      }
    });
  });

  afterEach(() => {
    usersCollection.remove({ _id: { $in: userIds } });
    sinon.restore(applePayments.iapValidate);
    sinon.restore(iapModule.validate);
    sinon.restore(iapModule.isValidated);
    sinon.restore(iapModule.getPurchaseData);
    sinon.restore(requestModule.get);
  });

  it('processes all users', () => {
    return applePayments.findAffectedUsers(usersCollection, null, jobStartDate, nextCheckDate).then(() => {
      expect(iapValidateStub.callCount).equals(NUMBER_OF_USERS);
      expect(requestGetStub.callCount).equals(0);
      return usersCollection.find({ _id: { $in: userIds } }, {
        fields: ['_id', 'purchased.plan'],
      });
    }).then(foundUsers => {
      for (let index in foundUsers) {
        let user = foundUsers[index];
        expect(nextCheckDate.isSame(moment(user.purchased.plan.nextPaymentProcessing), 'day')).equals(true);
      }
    });
  });

  it('cancels ended subscription', () => {
    let user = users[0];
    sinon.restore(iapModule.getPurchaseData);
    sinon.stub(iapModule, 'getPurchaseData')
      .returns([{expirationDate: jobStartDate.clone().subtract({day: 1}).toDate()}]);

    return applePayments.processUser(usersCollection, user, jobStartDate, nextCheckDate).then(() => {
      expect(iapValidateStub.callCount).equals(1);
      expect(requestGetStub.callCount).equals(1);
    });
  });

  it('should not check terminated subscriptions', () => {
    return usersCollection.update(
      {_id: users[0]._id},
      {$set: {'purchased.plan.dateTerminated': moment.utc()}},
      {castIds: false}
    ).then(() => {
      return applePayments.findAffectedUsers(usersCollection, null, jobStartDate, nextCheckDate);
    }).then(() => {
      expect(iapValidateStub.callCount).equals(NUMBER_OF_USERS - 1);
      expect(requestGetStub.callCount).equals(0);
    });
  });

  it('should set earlier check date for ending subscriptions', () => {
    let user = users[0];
    let expectedDate = jobStartDate.clone().add({day: 1});

    sinon.restore(iapModule.getPurchaseData);
    sinon.stub(iapModule, 'getPurchaseData')
      .returns([{expirationDate: expectedDate.toDate()}]);

    return applePayments.processUser(usersCollection, user, jobStartDate, nextCheckDate).then(() => {
      expect(iapValidateStub.callCount).equals(1);
      return usersCollection.find({ _id: user._id }, {
        fields: ['_id', 'purchased.plan'],
      });
    }).then(foundUsers => {
      for (let index in foundUsers) {
        expect(expectedDate.isSame(moment(foundUsers[index].purchased.plan.nextPaymentProcessing), 'day')).equals(true);
      }
    });
  });
});
