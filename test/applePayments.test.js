import iapModule from 'in-app-purchase';
import requestModule from 'request';

import sinon from 'sinon';
import {
  expect,
} from 'chai';
import moment from 'moment';
import applePayments from '../libs/applePayments.js';

const NUMBER_OF_USERS = 20;

function generateUsers (usersCollection, jobStartDate) {
  const usersToInsert = [];
  for (let i = 0; i < NUMBER_OF_USERS; i += 1) {
    usersToInsert.push({
      auth: { blocked: false },
      purchased: {
        plan: {
          paymentMethod: 'Apple',
          dateTerminated: null,
          planId: 'basic_3mo',
          nextPaymentProcessing: jobStartDate.toDate(),
        },
      },
    });
  }

  return usersCollection.insert(usersToInsert);
}

describe('ApplePayments', () => {
  let users; let
    userIds;
  let jobStartDate; let
    nextCheckDate;
  let iapValidateStub;
  let requestGetStub;

  beforeEach(() => {
    jobStartDate = moment.utc();
    nextCheckDate = jobStartDate.clone().add({ days: 7 });

    iapValidateStub = sinon.stub(iapModule, 'validate').resolves({});
    sinon.stub(iapModule, 'isValidated').returns(true);

    requestGetStub = sinon.stub(requestModule, 'get')
      .yields(null, { statusCode: 200 }, '');

    sinon.stub(iapModule, 'getPurchaseData')
      .returns([{ expirationDate: jobStartDate.clone().add({ day: 8 }).toDate() }]);

    return generateUsers(usersCollection, jobStartDate).then(doc => {
      users = doc;
      userIds = [];
      for (const index in users) {
        if (Object.prototype.hasOwnProperty.call(users, index)) {
          const user = users[index];
          userIds.push(user._id);
        }
      }
    });
  });

  afterEach(() => {
    usersCollection.remove({ _id: { $in: userIds } });
    sinon.restore();
  });

  it('processes all users', () => applePayments.findAffectedUsers(usersCollection, null, jobStartDate, nextCheckDate).then(() => {
    expect(iapValidateStub.callCount).equals(NUMBER_OF_USERS);
    expect(requestGetStub.callCount).equals(0);
    return usersCollection.find({ _id: { $in: userIds } }, {
      fields: ['_id', 'purchased.plan'],
    });
  }).then(foundUsers => {
    for (const index in foundUsers) {
      if (Object.prototype.hasOwnProperty.call(foundUsers, index)) {
        const user = foundUsers[index];
        expect(nextCheckDate.isSame(moment(user.purchased.plan.nextPaymentProcessing), 'day')).equals(true);
      }
    }
  }));

  it('cancels ended subscription', () => {
    const user = users[0];
    iapModule.getPurchaseData.restore();
    sinon.stub(iapModule, 'getPurchaseData')
      .returns([{ expirationDate: jobStartDate.clone().subtract({ day: 1 }).toDate() }]);

    return applePayments.processUser(usersCollection, user, jobStartDate, nextCheckDate).then(() => {
      // expect(iapValidateStub.callCount).equals(1);
      expect(requestGetStub.callCount).equals(1);
    });
  });

  it('should not check terminated subscriptions', () => usersCollection.update(
    { _id: users[0]._id },
    { $set: { 'purchased.plan.dateTerminated': moment.utc() } },
    { castIds: false },
  ).then(() => applePayments.findAffectedUsers(usersCollection, null, jobStartDate, nextCheckDate)).then(() => {
    // expect(iapValidateStub.callCount).equals(NUMBER_OF_USERS - 1);
    expect(requestGetStub.callCount).equals(0);
  }));

  it('should set earlier check date for ending subscriptions', () => {
    const user = users[0];
    const expectedDate = jobStartDate.clone().add({ day: 1 });

    iapModule.getPurchaseData.restore();
    sinon.stub(iapModule, 'getPurchaseData')
      .returns([{ expirationDate: expectedDate.toDate() }]);

    return applePayments.processUser(usersCollection, user, jobStartDate, nextCheckDate).then(() => usersCollection.find({ _id: user._id }, {
      fields: ['_id', 'purchased.plan'],
    })).then(foundUsers => {
      for (const index in foundUsers) {
        if (Object.prototype.hasOwnProperty.call(foundUsers, index)) {
          expect(expectedDate.isSame(moment(foundUsers[index].purchased.plan.nextPaymentProcessing), 'day')).equals(true);
        }
      }
    });
  });
});
