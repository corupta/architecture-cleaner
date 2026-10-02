import { buildApp } from './app'
import type { User } from './modules/user/index'
import * as usersByAlias from '@app/modules/user'
import * as usersByBaseUrl from 'src/modules/user'

const app = buildApp()
const created: User = app.controller.create({ name: 'Ada Lovelace' }).user

export const sameController = usersByAlias.UserController === usersByBaseUrl.UserController
export const summary = created.slug + ' via ' + String(app.routeCount) + ' routes'
