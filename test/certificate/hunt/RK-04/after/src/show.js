/** @import { User } from './user' */

/** @param {User} user @param {import('./user').User} other */
function show(user, other) { return user.name + other.name; }
module.exports = { show };
