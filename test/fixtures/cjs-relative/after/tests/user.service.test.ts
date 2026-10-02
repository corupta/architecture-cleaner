import { registerUser } from '../src/modules/user/user.service'
import { placeOrder } from '../src/services/order.service'

describe('registerUser', () => {
  it('formats and validates', async () => {
    const format = await import('../src/modules/user/user-format')
    const user = registerUser('u1', ' Ada ')
    expect(format.formatUser(user)).toBe('Ada <member>')
    expect(placeOrder(user, 10).userId).toBe('u1')
  })
})