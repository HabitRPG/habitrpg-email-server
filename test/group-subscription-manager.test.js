const kue = require('kue');
const monk = require('monk');
const nconf = require('nconf');
const moment = require('moment');
const groupSubscriptionManager = require('../libs/groupSubscriptionManager');
const amazonPayments = require('../libs/amazonPayments');

let db = monk(nconf.get('TEST_MONGODB_URL'));

let kueRedisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST'),
};

let queue = kue.createQueue({
  disableSearch: true,
  redis: kueRedisOpts,
});

const NUMBER_OF_GROUPS = 20;

function generateGroups (groupsCollection) {
  let jobStartDate = moment.utc();
  let oneMonthAgo = moment.utc(jobStartDate).subtract(1, 'months');

  let groupsToInsert = [];
  for (let i = 0; i < NUMBER_OF_GROUPS; i += 1) {
    groupsToInsert.push({
      leader: '3102aaed-7e2f-4555-8152-3e9ea20af8c2',
      type: 'guild',
      name: `testing${i}`,
      purchased: { plan: {
        paymentMethod: 'Amazon Payments',
        dateTerminated: null,
        lastBillingDate: oneMonthAgo.toDate(),
      } },
      memberCount: 1,
    });
  }

  return groupsCollection.insert(groupsToInsert);
}

describe('GroupSubscriptionManager', () => {
  let groups;
  let groupsCollection = db.get('groups', { castIds: false });
  let authorizeOnBillingAgreementSpy;
  let requestSpy;
  let amazonResponse = {
    AuthorizationDetails: {
      AuthorizationStatus: {
        State: 'Open',
      },
    },
  };

  beforeEach(() => {
    authorizeOnBillingAgreementSpy = sinon.stub(amazonPayments, 'authorizeOnBillingAgreement');
    authorizeOnBillingAgreementSpy
      .returnsPromise()
      .resolves(amazonResponse);

    requestSpy = (data, callback) => {
      callback();
    };

    return generateGroups(groupsCollection)
      .then((docs) => {
        groups = docs;
      });
  });

  afterEach(() => {
    groupsCollection.remove({});
    sinon.restore(amazonPayments.authorizeOnBillingAgreement);
  });

  it('should schedule the next queue when finished', (done) => {
    let queueSpy = sinon.spy(kue.Job.prototype, 'save');
    groupSubscriptionManager.init(db, queue, () => {
      expect(queueSpy.callCount).equals(1);
      done();
    }, amazonPayments, requestSpy);
  });

  it('should charge a group', (done) => {
    groupSubscriptionManager.init(db, queue, () => {
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      done();
    }, amazonPayments, requestSpy);
  });

  it('should not charge a group twice in the same month', (done) => {
    groupSubscriptionManager.init(db, queue, () => {
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      groupSubscriptionManager.init(db, queue, () => {
        expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
        done();
      }, amazonPayments, requestSpy);
    }, amazonPayments, requestSpy);
  });

  it('should not charge a terminated group', (done) => {
    groupsCollection.update(
      {_id: groups[0]._id},
      {$set: {'purchased.plan.dateTerminated': moment.utc()}}
    ).then(() => {
      groupSubscriptionManager.init(db, queue, () => {
        expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS - 1);
        done();
      }, amazonPayments, requestSpy);
    });
  });

  it('should page groups', (done) => {
    let dbSpy = sinon.spy(db.collections.groups, 'find');

    groupSubscriptionManager.init(db, queue, () => {
      expect(dbSpy.callCount).equals(3);
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      sinon.restore(db.collections.groups.find);
      done();
    }, amazonPayments, requestSpy);
  });

  it('should cancel a subscription of amazon is Declined', (done) => {
    let dbSpy = sinon.stub(db.collections.users, 'findOne');
    dbSpy
      .returnsPromise()
      .resolves({});

    amazonResponse.AuthorizationDetails.AuthorizationStatus.State = 'Declined';
    authorizeOnBillingAgreementSpy
      .returnsPromise()
      .resolves(amazonResponse);

    groupSubscriptionManager.init(db, queue, () => {
      expect(dbSpy.callCount).equals(NUMBER_OF_GROUPS);
      sinon.restore(db.collections.users.findOne);
      done();
    }, amazonPayments, requestSpy);
  });
});
