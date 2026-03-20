const fs = require('fs');
const path = require('path');

const appJson = require('./app.json');

function findFirstExistingPath(candidates) {
  return candidates.find((candidate) => fs.existsSync(path.join(__dirname, candidate))) || null;
}

module.exports = () => {
  const baseConfig = appJson.expo || {};
  const androidGoogleServicesFile = findFirstExistingPath([
    'google-services.json',
    path.join('android', 'app', 'google-services.json'),
  ]);
  const iosGoogleServicesFile = findFirstExistingPath([
    'GoogleService-Info.plist',
    path.join('ios', 'app', 'GoogleService-Info.plist'),
  ]);

  return {
    ...baseConfig,
    android: {
      ...(baseConfig.android || {}),
      ...(androidGoogleServicesFile ? { googleServicesFile: `./${androidGoogleServicesFile.replace(/\\/g, '/')}` } : {}),
    },
    ios: {
      ...(baseConfig.ios || {}),
      ...(iosGoogleServicesFile ? { googleServicesFile: `./${iosGoogleServicesFile.replace(/\\/g, '/')}` } : {}),
    },
  };
};
