'use strict';

const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(appRoot, '..', '..');
const distRoot = path.join(projectRoot, 'dist');

module.exports = Object.freeze({
  appRoot,
  projectRoot,
  distRoot,
  personalProduct: path.join(distRoot, 'chaoxing-force-play.user.js'),
  openProduct: path.join(distRoot, 'chaoxing-force-play.open.user.js'),
  latestProduct: path.join(distRoot, 'chaoxing-force-play-latest.user.js'),
});
