const utils = require('../utils');

module.exports.getToData = function getToData (user) {
  let email;
  let name;

  // Code taken from habitrpg/src/controllers/payments.js
  if (user.auth.local) {
    email = user.auth.local.email;
    name = user.profile.name || user.auth.local.username;
  } else if (user.auth.facebook && user.auth.facebook.emails && user.auth.facebook.emails[0] && user.auth.facebook.emails[0].value) {
    email = user.auth.facebook.emails[0].value;
    name = user.profile.name || user.auth.facebook.displayName || user.auth.facebook.username;
  } else if (user.auth.google && user.auth.google.emails && user.auth.google.emails[0] && user.auth.google.emails[0].value) {
    email = user.auth.google.emails[0].value;
    name = user.profile.name || user.auth.google.displayName || user.auth.google.username;
  }

  return {email, name, _id: user._id};
};

module.exports.getPersonalVariables = function getPersonalVariables (toData) {
  return [{
    rcpt: toData.email,
    vars: [
      {
        name: 'RECIPIENT_NAME',
        content: toData.name,
      },
      {
        name: 'RECIPIENT_UNSUB_URL',
        content: `/email/unsubscribe?code=${utils.encrypt(JSON.stringify({
          _id: toData._id,
          email: toData.email,
        }))}`,
      },
    ],
  }];
};
