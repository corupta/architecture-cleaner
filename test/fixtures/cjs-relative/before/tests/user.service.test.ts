import { registerUser } from '../src/services/user.service'
import { placeOrder } from '../src/services/order.service'

describe('registerUser', () => {
  it('formats and validates', async () => {
    const format = await import('../src/lib/user-format')
    const user = registerUser('u1', ' Ada ')
    expect(format.formatUser(user)).toBe('Ada <member>')
    expect(placeOrder(user, 10).userId).toBe('u1')
  })
})