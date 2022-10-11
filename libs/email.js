import { encrypt } from '../utils.js';

export function getToData (user) {
  let email;
  let name;

  // Code taken from habitrpg/src/controllers/payments.js
  if (user.auth.local && user.auth.local.email) {
    email = user.auth.local.email;
    name = user.auth.local.username;
  } else if (user.auth.facebook && user.auth.facebook.emails && user.auth.facebook.emails[0] && user.auth.facebook.emails[0].value) {
    email = user.auth.facebook.emails[0].value;
    name = user.auth.local.username;
  } else if (user.auth.google && user.auth.google.emails && user.auth.google.emails[0] && user.auth.google.emails[0].value) {
    email = user.auth.google.emails[0].value;
    name = user.auth.local.username;
  } else if (user.auth.apple && user.auth.apple.emails && user.auth.apple.emails[0] && user.auth.apple.emails[0].value) {
    email = user.auth.apple.emails[0].value;
    name = user.auth.local.username;
  }

  return { email, name, _id: user._id };
}

export function getPersonalVariables (toData) {
  return [{
    rcpt: toData.email,
    vars: [
      {
        name: 'RECIPIENT_NAME',
        content: toData.name,
      },
      {
        name: 'RECIPIENT_UNSUB_URL',
        content: `/email/unsubscribe?code=${encrypt(JSON.stringify({
          _id: toData._id,
          email: toData.email,
        }))}`,
      },
    ],
  }];
}
