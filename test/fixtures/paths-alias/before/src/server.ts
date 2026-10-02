import { buildApp } from './app'
import type { User } from './users/index'
import * as usersByAlias from '@app/users'
import * as usersByBaseUrl from 'src/users'

const app = buildApp()
const created: User = app.controller.create({ name: 'Ada Lovelace' }).user

export const sameController = usersByAlias.UserController === usersByBaseUrl.UserController
export const summary = created.slug + ' via ' + String(app.routeCount) + ' routes'
