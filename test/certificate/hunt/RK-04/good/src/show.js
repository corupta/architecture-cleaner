/** @import { User } from './modules/user/user' */

/** @param {User} user @param {import('./modules/user/user').User} other */
function show(user, other) { return user.name + other.name; }
module.exports = { show };
