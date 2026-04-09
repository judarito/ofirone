const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const sharedPath = path.resolve(__dirname, '../shared');
const config = getDefaultConfig(__dirname);

config.watchFolders = [...(config.watchFolders || []), sharedPath];

module.exports = config;
