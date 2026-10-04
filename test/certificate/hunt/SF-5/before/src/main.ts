import withExt from './config/data.json';
const noExt = require('./config/data');
export const main = [withExt.name, noExt.name];
