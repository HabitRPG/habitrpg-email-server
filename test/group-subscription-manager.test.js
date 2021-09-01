import { createQueue, Job } from 'kue';
import nconf from 'nconf';
import moment from 'moment';
import sinon from 'sinon';
import {
  expect,
} from 'chai';
import groupSubscriptionManager from '../libs/groupSubscriptionManager.js';
import amazonPayments from '../libs/amazonPayments.js';

const kueRedisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST'),
};

const queue = createQueue({
  disableSearch: true,
  redis: kueRedisOpts,
});

const NUMBER_OF_GROUPS = 20;

function generateGroups (groupsCollection) {
  const jobStartDate = moment.utc();
  const oneMonthAgo = moment.utc(jobStartDate).subtract(1, 'months');

  const groupsToInsert = [];
  for (let i = 0; i < NUMBER_OF_GROUPS; i += 1) {
    groupsToInsert.push({
      leader: '3102aaed-7e2f-4555-8152-3e9ea20af8c2',
      type: 'guild',
      name: `testing${i}`,
      purchased: {
        plan: {
          paymentMethod: 'Amazon Payments',
          dateTerminated: null,
          lastBillingDate: oneMonthAgo.toDate(),
        },
      },
      memberCount: 1,
    });
  }

  return groupsCollection.insert(groupsToInsert);
}

describe('GroupSubscriptionManager', () => {
  let groups;
  const groupsCollection = db.get('groups', { castIds: false });
  let authorizeOnBillingAgreementSpy;
  let requestSpy;
  const amazonResponse = {
    AuthorizationDetails: {
      AuthorizationStatus: {
        State: 'Open',
      },
    },
  };

  beforeEach(() => {
    authorizeOnBillingAgreementSpy = sinon.stub(amazonPayments, 'authorizeOnBillingAgreement');
    authorizeOnBillingAgreementSpy
      .resolves(amazonResponse);

    requestSpy = (data, callback) => {
      callback();
    };

    return generateGroups(groupsCollection)
      .then(docs => {
        groups = docs;
      });
  });

  afterEach(() => {
    groupsCollection.remove({});
    sinon.restore();
  });

  it('should schedule the next queue when finished', done => {
    const queueSpy = sinon.spy(Job.prototype, 'save');
    groupSubscriptionManager(db, queue, () => {
      expect(queueSpy.callCount).equals(1);
      done();
    }, amazonPayments, requestSpy);
  });

  it('should charge a group', done => {
    groupSubscriptionManager(db, queue, () => {
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      done();
    }, amazonPayments, requestSpy);
  });

  it('should not charge a group twice in the same month', done => {
    groupSubscriptionManager(db, queue, () => {
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      groupSubscriptionManager(db, queue, () => {
        expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
        done();
      }, amazonPayments, requestSpy);
    }, amazonPayments, requestSpy);
  });

  it('should not charge a terminated group', done => {
    groupsCollection.update(
      { _id: groups[0]._id },
      { $set: { 'purchased.plan.dateTerminated': moment.utc() } },
    ).then(() => {
      groupSubscriptionManager(db, queue, () => {
        expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS - 1);
        done();
      }, amazonPayments, requestSpy);
    });
  });

  it('should page groups', done => {
    const dbSpy = sinon.spy(db.collections.groups, 'find');

    groupSubscriptionManager(db, queue, () => {
      expect(dbSpy.callCount).equals(3);
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      db.collections.groups.find.restore();
      done();
    }, amazonPayments, requestSpy);
  });

  it('should cancel a subscription of amazon is Declined', done => {
    const dbSpy = sinon.stub(db.collections.users, 'findOne');
    dbSpy
      .resolves({});

    amazonResponse.AuthorizationDetails.AuthorizationStatus.State = 'Declined';
    authorizeOnBillingAgreementSpy
      .resolves(amazonResponse);

    groupSubscriptionManager(db, queue, () => {
      expect(dbSpy.callCount).equals(NUMBER_OF_GROUPS);
      db.collections.users.findOne.restore();
      done();
    }, amazonPayments, requestSpy);
  });
});
