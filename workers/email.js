/* 
  READ ME FIRST!

  This code was initially written to work with Mandrill.com API
  Now we've migrated to Sparkpost.com and its API.

  The input data sent from the website remained the same.
  So we process the data to make it suitable for Sparkpost.

*/

var fs = require('fs'),
    nconf = require('nconf');
    Sparkpost = require('sparkpost'),
    _ = require('lodash');

var sparkpostClient = new Sparkpost(nconf.get('SPARKPOST_API_KEY'));

var standardReplyTo = nconf.get('STANDARD_REPLY_TO_ADDR');
var orgsReplyTo = nconf.get('ORGS_REPLY_TO_ADDR');
var blacklistedBaseUrls = nconf.get('BLACKLISTED_BASE_URLS');

// A simple map that link an email type to its key stored in
// user.preferences.emailNotifications[key]
var mapEmailsToPreferences = {
  'new-pm': 'newPM',
  'kicked-from-guild': 'kickedGroup',
  'kicked-from-party': 'kickedGroup',
  'won-challenge': 'wonChallenge',
  'gifted-gems': 'giftedGems',
  'gifted-subscription': 'giftedSubscription',
  'invited-party': 'invitedParty',
  'invited-guild': 'invitedGuild',
  'quest-started': 'questStarted',
  'invite-boss-quest': 'invitedQuest',
  'invite-collection-quest': 'invitedQuest',
  //'reminder-to-login': 'remindersToLogin',
  '1-day-email': 'importantAnnouncements',
  '3-days-recapture': 'importantAnnouncements',
  '10-days-recapture': 'importantAnnouncements',
  '1-month-recapture': 'importantAnnouncements',
  'weekly-recap': 'weeklyRecaps'
};

module.exports = function(job, done){
  var replyToAddress = standardReplyTo; // For beta and production

  if(!job.data.variables) job.data.variables = [];
  if(!job.data.personalVariables) job.data.personalVariables = [];
  var baseUrlI = _.findIndex(job.data.variables, {name: 'BASE_URL'});
  var baseUrl;

  if(baseUrlI === -1){
    job.data.variables.push({name: 'BASE_URL', content: 'https://habitica.com'});
    baseUrl = job.data.variables[job.data.variables.length - 1];
  }else{
    baseUrl = job.data.variables[baseUrlI];
  } 

  // Exclude some base urls, falling back to the main site
  if(blacklistedBaseUrls.indexOf(baseUrl.content) !== -1){
    baseUrl.content = 'https://habitica.com';
  }

  if(baseUrl && baseUrl.content){
    baseUrl = baseUrl.content;
    if(['https://beta.habitrpg.com', 'https://habitrpg.com', 'https://habititca.com'].indexOf(baseUrl) == -1){
      replyToAddress = orgsReplyTo; // For org plans
    }

    job.data.variables.push({
      name: 'EMAIL_SETTINGS_URL',
      content: '/#/options/settings/notifications'
    }, {
      name: 'UNSUB_EMAIL_TYPE_URL',
      content: '/#/options/settings/notifications?unsubFrom=' + mapEmailsToPreferences[job.data.emailType]
    });
  }

  var replyToAddressVar = _.find(job.data.variables, {name: 'REPLY_TO_ADDRESS'});

  if(replyToAddressVar && replyToAddressVar.content){
    replyToAddress = replyToAddressVar.content;
  };

  // If it's an object there is only one email to send, otherwise
  // the same one to multiple users

  var toArr = job.data.to.email ? [job.data.to] : job.data.to;
  toArr = toArr.map(function (item) {
    return {
      address: {
        email: item.email,
        name: item.name,
      }
    };
  });

  // Mandrill -> Sparkpost migration
  // Variables are stored in a map {varName: varContent}
  // varName MUST be lowercase
  var globalSubstitutionData = {};

  job.data.personalVariables.forEach(function (item) {
    var toUser = toArr.find(function (user) {
      return user.address && user.address.email === item.rcpt;
    });

    if (toUser) {
      toUser.substitution_data = {};

      if (item.vars) {
        item.vars.forEach(function (variable) {
          if (variable.name) toUser.substitution_data[variable.name.toLowerCase()] = variable.content;
        });
      }
    }
  });

  job.data.variables.forEach(function (item) {
    if (item.name) globalSubstitutionData[item.name.toLowerCase()] = item.content;
  });

  sparkpostClient.transmissions.send({
    transmissionBody: {
      options: {
        open_tracking: true,
        click_tracking: true,
        transactional: true,
      },
      campaign_id: job.data.emailType,
      content: {
        template_id: job.data.emailType, // template_name === tag === emailType
      },
      substitution_data: globalSubstitutionData,
      recipients: toArr,
    },
  }, function(err, result){
    if (err) {
      done(err);
    } else {
      done(null, result);
    }
  });
};