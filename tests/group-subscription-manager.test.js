// @TODO Move the below to a global setup file
var chai = require('chai');
var sinon = require('sinon');
var sinonStubPromise = require('sinon-stub-promise');
sinonStubPromise(sinon);
var expect = chai.expect;
var kue = require('kue'),
    monk = require('monk'),
    nconf = require('nconf');

nconf
  .argv()
  .env()
  .file({ file: __dirname + '/../config.json' });

var db = monk(nconf.get('MONGODB_URL'));

var kueRedisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST')
};

var queue = kue.createQueue({
  disableSearch: true,
  redis: kueRedisOpts
});

// @TODO Move the above to a global setup file

var moment = require('moment');
var groupSubscriptionManager = require('../libs/groupSubscriptionManager');
var amazonPayments = require('../libs/amazonPayments');
var NUMBER_OF_GROUPS = 20;

function generateGroups(groupsCollection)
{
  var jobStartDate = moment.utc();
  var oneMonthAgo = moment.utc(jobStartDate).subtract(1, 'months');

  var groupsToInsert = [];
  for (var i = 0; i < NUMBER_OF_GROUPS; i += 1) {
    groupsToInsert.push({
      leader: '3102aaed-7e2f-4555-8152-3e9ea20af8c2',
      type: 'guild',
      name: 'testing' + i,
      purchased: { plan: {
        paymentMethod: 'Amazon Payments',
        dateTerminated: null,
        lastBillingDate: oneMonthAgo.toDate(),
      } },
      memberCount: 1,
    });
  }

  return groupsCollection.insert(groupsToInsert);
};

describe('GroupSubscriptionManager', function () {
  var groups, groupsCollection;

  var authorizeOnBillingAgreementSpy;
  var amazonResponse = {
    AuthorizationDetails: {
      AuthorizationStatus: {
        State: 'Open',
      },
    },
  };

  beforeEach(function (done) {
    authorizeOnBillingAgreementSpy = sinon.stub(amazonPayments, 'authorizeOnBillingAgreement');
    authorizeOnBillingAgreementSpy
      .returnsPromise()
      .resolves(amazonResponse);

    groupsCollection = db.get('groups');
    generateGroups(groupsCollection)
      .then (function (doc) {
        groups = doc;
        done();
      });
  });

  afterEach(function() {
    groupsCollection.remove({});
    sinon.restore(amazonPayments.authorizeOnBillingAgreement);
  });

  it('should schedule the next queue when finished', function (done) {
    var queueSpy = sinon.spy(kue.Job.prototype, 'save');
    groupSubscriptionManager.init(db, queue, function () {
      expect(queueSpy.callCount).equals(1);
      done();
    }, amazonPayments);
  });

  it('should charge a group', function (done) {
    groupSubscriptionManager.init(db, queue, function () {
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      done();
    }, amazonPayments);
  });

  it('should not charge a group twice in the same month', function (done) {
    groupSubscriptionManager.init(db, queue, function () {
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      groupSubscriptionManager.init(db, queue, function () {
        expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
        done();
      }, amazonPayments);
    }, amazonPayments);
  });

  it('should not charge a terminated group', function (done) {
    groupsCollection.update(
      {_id: groups[0]._id},
      {$set: {'purchased.plan.dateTerminated': moment.utc()}},
      {castIds: false}
    ).then(function (result) {
      groupSubscriptionManager.init(db, queue, function () {
        expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS - 1);
        done();
      }, amazonPayments);
    });
  });

  it('should page groups', function (done) {
    var dbSpy = sinon.spy(db.collections.groups, 'find');

    groupSubscriptionManager.init(db, queue, function () {
      expect(dbSpy.callCount).equals(3);
      expect(authorizeOnBillingAgreementSpy.callCount).equals(NUMBER_OF_GROUPS);
      sinon.restore(db.collections.groups.find);
      done();
    }, amazonPayments);
  });

  it('should cancel a subscription of amazon is Declined', function (done) {
    var dbSpy = sinon.stub(db.collections.users, 'findOne');
    dbSpy
      .returnsPromise()
      .resolves({});

    amazonResponse.AuthorizationDetails.AuthorizationStatus.State = 'Declined';
    authorizeOnBillingAgreementSpy
      .returnsPromise()
      .resolves(amazonResponse);

    groupSubscriptionManager.init(db, queue, function () {
      expect(dbSpy.callCount).equals(NUMBER_OF_GROUPS);
      sinon.restore(db.collections.users.findOne);
      done();
    }, amazonPayments);
  });
});
